import crypto from "node:crypto";

import {
  GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION,
  genericWorkCoreJoinDigest,
  verifyGenericWorkCoreJoinDigestSignature,
} from "./genericWorkCoreJoin.js";

// This module deliberately owns only the provider-neutral authority and
// reconciliation contracts. Provider clients live behind server-owned
// adapters; neither a caller-supplied URL, token nor outcome is accepted as
// evidence here.
export const OWNER_AUTHORITY_ENVELOPE_SCHEMA_VERSION = "owner_authority_envelope_v1";
export const AUTHORITY_PROOF_SCHEMA_VERSION = "authority_proof_v1";
export const OWNER_MANUAL_EFFECT_RECONCILIATION_SCHEMA_VERSION =
  "owner_manual_effect_reconciliation_v1";
export const OWNER_MANUAL_EFFECT_ADAPTER_OBSERVATION_SCHEMA_VERSION =
  "owner_manual_effect_adapter_observation_v1";
export const OWNER_MANUAL_EFFECT_POST_VERIFICATION_SCHEMA_VERSION =
  "owner_manual_effect_post_verification_v1";
export const OWNER_MANUAL_EFFECT_WORK_BINDING_SCHEMA_VERSION =
  "owner_manual_effect_work_binding_v1";

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OWNER_FINGERPRINT = /^osf_[a-f0-9]{64}$/;
const MAX_ENVELOPE_TTL_MS = 30 * 60_000;
const MIN_ENVELOPE_TTL_MS = 60_000;
const MAX_POST_VERIFICATION_AGE_MS = 5 * 60_000;

const BREAK_GLASS_ADAPTER = "nyra_core";
const BREAK_GLASS_EFFECTS = new Set([
  "nyra_core.self_repair.commit",
  "nyra_core.self_repair.push_branch",
  "nyra_core.self_repair.draft_pr",
]);
const ABSOLUTE_DENY_EFFECTS = new Set([
  "github.release",
  "render.promote",
  "render.rollback",
  "secrets.read",
  "secrets.export",
  "credential.exfiltrate",
  "git.force_push",
  "git.delete_ref",
  "git.tag",
  "host.policy.override",
  "provider.api.call",
  "provider.agent.spawn",
  "owner_authority_envelope.issue",
  "owner_authority_envelope.revoke",
  "host_native.delegation.issue",
]);

function fail(code) {
  throw new Error(code);
}

function clone(value) {
  return structuredClone(value);
}

function plainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, fields, code) {
  if (!plainRecord(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code);
  }
}

function text(value, code, maximum = 1_000) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) fail(code);
  return normalized;
}

function id(value, code) {
  const normalized = text(value, code, 128);
  if (!ID.test(normalized)) fail(code);
  return normalized;
}

function resourceId(value, code) {
  const normalized = text(value, code, 255);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,254}$/.test(normalized)) fail(code);
  return normalized;
}

function digest(value, code) {
  const normalized = text(value, code, 64).toLowerCase();
  if (!SHA256.test(normalized)) fail(code);
  return normalized;
}

function timestamp(value, code) {
  const normalized = text(value, code, 40);
  if (!ISO.test(normalized) || new Date(normalized).toISOString() !== normalized) fail(code);
  const millis = Date.parse(normalized);
  if (!Number.isFinite(millis)) fail(code);
  return millis;
}

function iso(value) {
  return new Date(value).toISOString();
}

function nowMillis(now) {
  const result = Number(typeof now === "function" ? now() : Date.now());
  if (!Number.isFinite(result)) fail("owner_authority_clock_invalid");
  return result;
}

function stableIdentifiers(values, code, maximum = 32) {
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum) fail(code);
  const normalized = values.map((entry) => id(entry, code));
  const unique = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  if (unique.length !== normalized.length) fail(code);
  return unique;
}

function stableDigests(values, code, maximum = 32) {
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum) fail(code);
  const normalized = values.map((entry) => digest(entry, code));
  const unique = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  if (unique.length !== normalized.length) fail(code);
  return unique;
}

function stableResources(values, code, maximum = 32) {
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum) fail(code);
  const normalized = values.map((entry) => resourceId(entry, code));
  const unique = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  if (unique.length !== normalized.length) fail(code);
  return unique;
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function normalizedScope(value, mode) {
  exactKeys(value, [
    "adapter_ids",
    "effect_reference_digests",
    "effect_types",
    "resource_ids",
  ], "owner_authority_scope_invalid");
  const scope = {
    adapter_ids: stableIdentifiers(value.adapter_ids, "owner_authority_scope_invalid", 8),
    effect_types: stableIdentifiers(value.effect_types, "owner_authority_scope_invalid", 16),
    resource_ids: stableResources(value.resource_ids, "owner_authority_scope_invalid", 32),
    effect_reference_digests: stableDigests(
      value.effect_reference_digests,
      "owner_authority_scope_invalid",
      32,
    ),
  };
  if (scope.adapter_ids.some((entry) => entry.includes("*")) ||
      scope.effect_types.some((entry) => entry.includes("*")) ||
      scope.resource_ids.some((entry) => entry.includes("*"))) {
    fail("owner_authority_scope_wildcard_denied");
  }
  if (mode === "OWNER_BREAK_GLASS") {
    if (!sameStrings(scope.adapter_ids, [BREAK_GLASS_ADAPTER]) ||
        scope.effect_types.length !== 1 || scope.resource_ids.length !== 1 ||
        scope.effect_reference_digests.length !== 1 ||
        scope.effect_types.some((entry) => !BREAK_GLASS_EFFECTS.has(entry)) ||
        scope.resource_ids.some((entry) => !entry.startsWith("nyra_core:"))) {
      fail("owner_break_glass_scope_invalid");
    }
  }
  return scope;
}

function normalizedEffectCeiling(value, scope, mode) {
  const ceiling = stableIdentifiers(value, "owner_authority_effect_ceiling_invalid", 16);
  if (ceiling.some((entry) => !scope.effect_types.includes(entry)) ||
      ceiling.some((entry) => ABSOLUTE_DENY_EFFECTS.has(entry))) {
    fail("owner_authority_effect_ceiling_invalid");
  }
  if (mode === "OWNER_BREAK_GLASS" &&
      (!sameStrings(ceiling, scope.effect_types) ||
      ceiling.some((entry) => !BREAK_GLASS_EFFECTS.has(entry)))) {
    fail("owner_break_glass_effect_ceiling_invalid");
  }
  return ceiling;
}

function scopeIsSubset(scope, allowedScope) {
  return scope.adapter_ids.every((entry) => allowedScope.adapter_ids.includes(entry)) &&
    scope.effect_types.every((entry) => allowedScope.effect_types.includes(entry)) &&
    scope.resource_ids.every((entry) => allowedScope.resource_ids.includes(entry)) &&
    scope.effect_reference_digests.every((entry) =>
      allowedScope.effect_reference_digests.includes(entry));
}

function normalizedWorkBindingTuple(value, code) {
  exactKeys(value, [
    "adapter_id",
    "effect_reference_digest",
    "effect_type",
    "resource_id",
  ], code);
  return {
    adapter_id: id(value.adapter_id, code),
    effect_type: id(value.effect_type, code),
    resource_id: resourceId(value.resource_id, code),
    effect_reference_digest: digest(value.effect_reference_digest, code),
  };
}

function normalizedWorkBinding(value, expected, nowValue) {
  exactKeys(value, [
    "allowed_effect_tuples",
    "binding_digest",
    "current_version",
    "intent_anchor_digest",
    "mode",
    "provider_execution",
    "repository",
    "schema_version",
    "source",
    "tenant_id",
    "trusted",
    "verified_at",
    "work_id",
    "work_status",
    "work_updated_at",
  ], "owner_manual_effect_work_scope_invalid");
  const tenantId = id(value.tenant_id, "owner_manual_effect_work_scope_invalid");
  const workId = id(value.work_id, "owner_manual_effect_work_scope_invalid");
  const intentDigest = digest(
    value.intent_anchor_digest,
    "owner_manual_effect_work_scope_invalid",
  );
  if (
    value.schema_version !== OWNER_MANUAL_EFFECT_WORK_BINDING_SCHEMA_VERSION ||
    value.trusted !== true ||
    value.source !== "mcp_work_continuity_v2" ||
    value.provider_execution !== false ||
    !["OWNER_MANUAL", "OWNER_BREAK_GLASS"].includes(value.mode) ||
    !["active", "verified", "release_ready"].includes(value.work_status) ||
    !Number.isSafeInteger(value.current_version) || value.current_version < 1 ||
    tenantId !== expected.tenant_id ||
    workId !== expected.work_id ||
    intentDigest !== expected.intent_anchor_digest ||
    value.mode !== expected.mode
  ) fail("owner_manual_effect_work_scope_binding_invalid");
  const repository = resourceId(value.repository, "owner_manual_effect_work_scope_invalid");
  const verifiedAt = timestamp(value.verified_at, "owner_manual_effect_work_scope_invalid");
  const workUpdatedAt = timestamp(value.work_updated_at, "owner_manual_effect_work_scope_invalid");
  if (
    verifiedAt > nowValue + 30_000 || nowValue - verifiedAt > MAX_POST_VERIFICATION_AGE_MS ||
    workUpdatedAt > verifiedAt + 30_000
  ) fail("owner_manual_effect_work_scope_invalid");
  if (!Array.isArray(value.allowed_effect_tuples) ||
      value.allowed_effect_tuples.length < 1 || value.allowed_effect_tuples.length > 32) {
    fail("owner_manual_effect_work_scope_invalid");
  }
  const tuples = value.allowed_effect_tuples
    .map((entry) => normalizedWorkBindingTuple(entry, "owner_manual_effect_work_scope_invalid"))
    .sort((left, right) => genericWorkCoreJoinDigest(left).localeCompare(
      genericWorkCoreJoinDigest(right),
    ));
  if (tuples.some((entry, index) => index > 0 &&
    genericWorkCoreJoinDigest(entry) === genericWorkCoreJoinDigest(tuples[index - 1]))) {
    fail("owner_manual_effect_work_scope_invalid");
  }
  const allowedScope = {
    adapter_ids: [...new Set(tuples.map((entry) => entry.adapter_id))].sort(),
    effect_types: [...new Set(tuples.map((entry) => entry.effect_type))].sort(),
    resource_ids: [...new Set(tuples.map((entry) => entry.resource_id))].sort(),
    effect_reference_digests: [...new Set(
      tuples.map((entry) => entry.effect_reference_digest),
    )].sort(),
  };
  normalizedScope(allowedScope, value.mode);
  const unsigned = {
    schema_version: OWNER_MANUAL_EFFECT_WORK_BINDING_SCHEMA_VERSION,
    source: value.source,
    tenant_id: tenantId,
    work_id: workId,
    intent_anchor_digest: intentDigest,
    mode: value.mode,
    work_status: value.work_status,
    current_version: value.current_version,
    work_updated_at: iso(workUpdatedAt),
    repository,
    provider_execution: false,
    allowed_effect_tuples: tuples,
  };
  if (value.binding_digest !== genericWorkCoreJoinDigest(unsigned)) {
    fail("owner_manual_effect_work_scope_invalid");
  }
  return {
    ...unsigned,
    // Provenance is conveyed by the server-only MCP-to-Core binding. It is
    // intentionally outside the digest, but must survive persistence so a
    // later validation cannot silently weaken the source requirement.
    trusted: true,
    verified_at: iso(verifiedAt),
    binding_digest: value.binding_digest,
    allowed_scope: allowedScope,
  };
}

function bindingAllowsTuple(binding, selector) {
  return binding.allowed_effect_tuples.some((entry) =>
    entry.adapter_id === selector.adapter_id &&
    entry.effect_type === selector.effect_type &&
    entry.resource_id === selector.resource_id &&
    entry.effect_reference_digest === selector.effect_reference_digest);
}

// An effect reference is the immutable identity of a manually performed
// effect.  Envelopes are intentionally short-lived and single-use, but an
// owner must not be able to issue a fresh envelope to reconcile the same
// provider-neutral effect again (including from another Work).
function manualEffectInstanceClaimKey({
  tenant_id,
  adapter_id,
  effect_type,
  resource_id,
  effect_reference_digest,
} = {}) {
  return genericWorkCoreJoinDigest({
    schema_version: "owner_manual_effect_instance_claim_v1",
    tenant_id,
    adapter_id,
    effect_type,
    resource_id,
    effect_reference_digest,
  });
}

function normalizedOwnerConfirmation(value, purpose) {
  exactKeys(value, [
    "confirmation_reference",
    "consent_nonce",
    "owner_subject_fingerprint",
    "purpose",
    "request_binding_hash",
    "request_bound",
    "verified",
  ], "owner_authority_confirmation_invalid");
  const fingerprint = text(
    value.owner_subject_fingerprint,
    "owner_authority_confirmation_invalid",
    100,
  ).toLowerCase();
  if (value.verified !== true || value.request_bound !== true ||
      !OWNER_FINGERPRINT.test(fingerprint) || value.purpose !== purpose) {
    fail("owner_authority_confirmation_invalid");
  }
  const normalized = {
    owner_subject_fingerprint: fingerprint,
    consent_nonce: text(value.consent_nonce, "owner_authority_confirmation_invalid", 300),
    confirmation_reference: text(
      value.confirmation_reference,
      "owner_authority_confirmation_invalid",
      1_000,
    ),
    purpose,
    request_binding_hash: digest(
      value.request_binding_hash,
      "owner_authority_confirmation_invalid",
    ),
  };
  return {
    ...normalized,
    confirmation_digest: genericWorkCoreJoinDigest(normalized),
  };
}

function adapterFromRegistry(adapters, adapterId) {
  const adapter = adapters?.[adapterId];
  if (!adapter || adapter.trusted !== true || typeof adapter.reconcile !== "function") {
    fail("owner_manual_effect_adapter_unavailable");
  }
  return adapter;
}

function normalizedAdapterObservation(value, expected, nowValue, notBefore) {
  exactKeys(value, [
    "adapter_id",
    "effect_reference_digest",
    "effect_type",
    "evidence_digest",
    "external_side_effect",
    "observed_at",
    "outcome",
    "post_verification",
    "provider_execution",
    "resource_id",
    "schema_version",
    "trusted",
  ], "owner_manual_effect_adapter_observation_invalid");
  if (value.schema_version !== OWNER_MANUAL_EFFECT_ADAPTER_OBSERVATION_SCHEMA_VERSION ||
      value.trusted !== true || value.adapter_id !== expected.adapter_id ||
      value.effect_type !== expected.effect_type || value.resource_id !== expected.resource_id ||
      value.effect_reference_digest !== expected.effect_reference_digest ||
      value.outcome !== "VERIFIED_SUCCESS" || value.provider_execution !== false ||
      value.external_side_effect !== false) {
    fail("owner_manual_effect_adapter_observation_invalid");
  }
  const observedAt = timestamp(value.observed_at, "owner_manual_effect_adapter_observation_invalid");
  if (
    observedAt < notBefore ||
    observedAt > nowValue + 60_000 ||
    nowValue - observedAt > MAX_POST_VERIFICATION_AGE_MS
  ) fail("owner_manual_effect_adapter_observation_invalid");
  const evidenceDigest = digest(value.evidence_digest, "owner_manual_effect_adapter_observation_invalid");
  const post = value.post_verification;
  exactKeys(post, [
    "evidence_digest",
    "result_digest",
    "schema_version",
    "verified",
    "verified_at",
    "verifier_id",
  ], "owner_manual_effect_post_verification_invalid");
  if (post.schema_version !== OWNER_MANUAL_EFFECT_POST_VERIFICATION_SCHEMA_VERSION ||
      post.verified !== true || post.evidence_digest !== evidenceDigest ||
      timestamp(post.verified_at, "owner_manual_effect_post_verification_invalid") < observedAt ||
      timestamp(post.verified_at, "owner_manual_effect_post_verification_invalid") < notBefore ||
      timestamp(post.verified_at, "owner_manual_effect_post_verification_invalid") > nowValue + 60_000 ||
      nowValue - timestamp(post.verified_at, "owner_manual_effect_post_verification_invalid") >
        MAX_POST_VERIFICATION_AGE_MS) {
    fail("owner_manual_effect_post_verification_invalid");
  }
  return {
    ...clone(value),
    evidence_digest: evidenceDigest,
    post_verification: {
      ...clone(post),
      verifier_id: id(post.verifier_id, "owner_manual_effect_post_verification_invalid"),
      result_digest: digest(post.result_digest, "owner_manual_effect_post_verification_invalid"),
    },
  };
}

function authorityProofUnsigned({
  proof_type,
  proof_id,
  key_id,
  tenant_id,
  work_id,
  intent_anchor_digest,
  authority_envelope_id,
  authority_envelope_digest,
  reconciliation_id = null,
  reconciliation_digest = null,
  owner_subject_fingerprint,
  scope_digest,
  effect_ceiling_digest,
  work_binding_digest,
  mode,
  break_glass_reason_digest,
  revocation_epoch,
  issued_at,
  expires_at,
  closure_authorized,
  post_verification_digest = null,
} = {}) {
  return {
    schema_version: AUTHORITY_PROOF_SCHEMA_VERSION,
    authority: "universal_core",
    proof_type: id(proof_type, "authority_proof_invalid"),
    proof_id: id(proof_id, "authority_proof_invalid"),
    signature_domain: GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION,
    signature_algorithm: "ed25519",
    key_id: id(key_id, "authority_proof_invalid"),
    tenant_id: id(tenant_id, "authority_proof_invalid"),
    work_id: id(work_id, "authority_proof_invalid"),
    intent_anchor_digest: digest(intent_anchor_digest, "authority_proof_invalid"),
    authority_envelope_id: id(authority_envelope_id, "authority_proof_invalid"),
    authority_envelope_digest: digest(authority_envelope_digest, "authority_proof_invalid"),
    reconciliation_id: reconciliation_id === null ? null : id(reconciliation_id, "authority_proof_invalid"),
    reconciliation_digest: reconciliation_digest === null ? null : digest(reconciliation_digest, "authority_proof_invalid"),
    owner_subject_fingerprint: text(owner_subject_fingerprint, "authority_proof_invalid", 100).toLowerCase(),
    scope_digest: digest(scope_digest, "authority_proof_invalid"),
    effect_ceiling_digest: digest(effect_ceiling_digest, "authority_proof_invalid"),
    work_binding_digest: digest(work_binding_digest, "authority_proof_invalid"),
    mode: ["OWNER_MANUAL", "OWNER_BREAK_GLASS"].includes(mode)
      ? mode : fail("authority_proof_invalid"),
    break_glass_reason_digest: break_glass_reason_digest === null
      ? null
      : digest(break_glass_reason_digest, "authority_proof_invalid"),
    revocation_epoch: Number(revocation_epoch),
    issued_at: iso(timestamp(issued_at, "authority_proof_invalid")),
    expires_at: iso(timestamp(expires_at, "authority_proof_invalid")),
    closure_authorized: closure_authorized === true,
    post_verification_digest: post_verification_digest === null
      ? null
      : digest(post_verification_digest, "authority_proof_invalid"),
    execution_authorized: false,
    provider_execution: false,
    host_policy_override: false,
    ticket_issued: false,
    retrospective_ticket_issued: false,
  };
}

function authorityProofValid(proof, signer, nowValue, expected = {}) {
  const fields = [
    "authority", "authority_envelope_digest", "authority_envelope_id",
    "closure_authorized", "effect_ceiling_digest", "execution_authorized",
    "expires_at", "host_policy_override", "intent_anchor_digest", "issued_at",
    "key_id", "mode", "break_glass_reason_digest", "owner_subject_fingerprint", "post_verification_digest",
    "proof_digest", "proof_id", "proof_type", "provider_execution",
    "reconciliation_digest", "reconciliation_id", "retrospective_ticket_issued",
    "revocation_epoch", "schema_version", "scope_digest", "signature",
    "signature_algorithm", "signature_domain", "tenant_id", "ticket_issued",
    "work_binding_digest", "work_id",
  ];
  exactKeys(proof, fields, "authority_proof_invalid");
  const { signature, proof_digest, ...unsigned } = proof;
  if (proof.schema_version !== AUTHORITY_PROOF_SCHEMA_VERSION ||
      proof.authority !== "universal_core" ||
      proof.signature_domain !== GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION ||
      proof.signature_algorithm !== "ed25519" || proof.key_id !== signer.key_id ||
      proof.execution_authorized !== false || proof.provider_execution !== false ||
      proof.host_policy_override !== false || proof.ticket_issued !== false ||
      proof.retrospective_ticket_issued !== false ||
      (proof.mode === "OWNER_BREAK_GLASS") !== Boolean(proof.break_glass_reason_digest) ||
      !Number.isSafeInteger(proof.revocation_epoch) || proof.revocation_epoch < 0 ||
      proof_digest !== genericWorkCoreJoinDigest(unsigned) ||
      timestamp(proof.issued_at, "authority_proof_invalid") > nowValue + 60_000 ||
      timestamp(proof.expires_at, "authority_proof_invalid") <= nowValue ||
      timestamp(proof.issued_at, "authority_proof_invalid") >=
        timestamp(proof.expires_at, "authority_proof_invalid")) {
    fail("authority_proof_invalid");
  }
  try {
    verifyGenericWorkCoreJoinDigestSignature({
      digest: proof_digest,
      signature,
      publicKey: signer.public_key,
    });
  } catch {
    fail("authority_proof_signature_invalid");
  }
  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined && proof[key] !== value) fail("authority_proof_binding_invalid");
  }
  return clone(proof);
}

function envelopeUnsigned({
  envelope_id,
  tenant_id,
  work_id,
  intent_anchor_digest,
  mode,
  owner_subject_fingerprint,
  owner_confirmation_digest,
  scope,
  scope_digest,
  effect_ceiling,
  effect_ceiling_digest,
  work_binding,
  work_binding_digest,
  break_glass_reason_digest,
  issued_at,
  expires_at,
} = {}) {
  return {
    schema_version: OWNER_AUTHORITY_ENVELOPE_SCHEMA_VERSION,
    envelope_id: id(envelope_id, "owner_authority_envelope_invalid"),
    tenant_id: id(tenant_id, "owner_authority_envelope_invalid"),
    work_id: id(work_id, "owner_authority_envelope_invalid"),
    intent_anchor_digest: digest(intent_anchor_digest, "owner_authority_envelope_invalid"),
    mode,
    owner_subject_fingerprint: text(owner_subject_fingerprint, "owner_authority_envelope_invalid", 100).toLowerCase(),
    owner_confirmation_digest: digest(owner_confirmation_digest, "owner_authority_envelope_invalid"),
    scope: clone(scope),
    scope_digest: digest(scope_digest, "owner_authority_envelope_invalid"),
    effect_ceiling: [...effect_ceiling],
    effect_ceiling_digest: digest(effect_ceiling_digest, "owner_authority_envelope_invalid"),
    work_binding: clone(work_binding),
    work_binding_digest: digest(work_binding_digest, "owner_authority_envelope_invalid"),
    break_glass_reason_digest: break_glass_reason_digest === null
      ? null
      : digest(break_glass_reason_digest, "owner_authority_envelope_invalid"),
    issued_at: iso(timestamp(issued_at, "owner_authority_envelope_invalid")),
    not_before: iso(timestamp(issued_at, "owner_authority_envelope_invalid")),
    expires_at: iso(timestamp(expires_at, "owner_authority_envelope_invalid")),
    execution_authorized: false,
    provider_execution: false,
    host_policy_override: false,
    ticket_issued: false,
  };
}

function envelopeValid(record, signer, nowValue) {
  const envelope = record?.envelope;
  const proof = envelope?.authority_proof;
  const unsigned = clone(envelope);
  delete unsigned.envelope_digest;
  delete unsigned.authority_proof;
  if (!plainRecord(envelope) || envelope.schema_version !== OWNER_AUTHORITY_ENVELOPE_SCHEMA_VERSION ||
      !["OWNER_MANUAL", "OWNER_BREAK_GLASS"].includes(envelope.mode) ||
      envelope.envelope_digest !== genericWorkCoreJoinDigest(unsigned) ||
      record.state !== "active" || Number(record.usage_count) !== 0 ||
      Number(record.revocation_epoch) !== 0 || envelope.execution_authorized !== false ||
      envelope.provider_execution !== false || envelope.host_policy_override !== false ||
      envelope.ticket_issued !== false || !OWNER_FINGERPRINT.test(String(envelope.owner_subject_fingerprint || "")) ||
      timestamp(envelope.not_before, "owner_authority_envelope_invalid") > nowValue ||
      timestamp(envelope.expires_at, "owner_authority_envelope_invalid") <= nowValue) {
    fail("owner_authority_envelope_invalid");
  }
  const scope = normalizedScope(envelope.scope, envelope.mode);
  const ceiling = normalizedEffectCeiling(envelope.effect_ceiling, scope, envelope.mode);
  const workBinding = normalizedWorkBinding(envelope.work_binding, {
    tenant_id: envelope.tenant_id,
    work_id: envelope.work_id,
    intent_anchor_digest: envelope.intent_anchor_digest,
    mode: envelope.mode,
  }, nowValue);
  if (envelope.scope_digest !== genericWorkCoreJoinDigest(scope) ||
      envelope.effect_ceiling_digest !== genericWorkCoreJoinDigest(ceiling) ||
      envelope.work_binding_digest !== workBinding.binding_digest ||
      !scopeIsSubset(scope, workBinding.allowed_scope)) {
    fail("owner_authority_envelope_invalid");
  }
  if ((envelope.mode === "OWNER_BREAK_GLASS") !== Boolean(envelope.break_glass_reason_digest)) {
    fail("owner_authority_envelope_invalid");
  }
  authorityProofValid(proof, signer, nowValue, {
    proof_type: "owner_authority_envelope",
    tenant_id: envelope.tenant_id,
    work_id: envelope.work_id,
    intent_anchor_digest: envelope.intent_anchor_digest,
    authority_envelope_id: envelope.envelope_id,
    authority_envelope_digest: envelope.envelope_digest,
    owner_subject_fingerprint: envelope.owner_subject_fingerprint,
    scope_digest: envelope.scope_digest,
    effect_ceiling_digest: envelope.effect_ceiling_digest,
    work_binding_digest: envelope.work_binding_digest,
    mode: envelope.mode,
    break_glass_reason_digest: envelope.break_glass_reason_digest,
    revocation_epoch: record.revocation_epoch,
    closure_authorized: false,
    reconciliation_id: null,
    reconciliation_digest: null,
    post_verification_digest: null,
  });
  return { scope, ceiling, workBinding };
}

function appendAudit(state, event) {
  const tenantId = id(event.tenant_id, "owner_authority_audit_invalid");
  if (!plainRecord(state.owner_authority_audit)) state.owner_authority_audit = {};
  const entries = Object.values(state.owner_authority_audit)
    .filter((entry) => entry?.tenant_id === tenantId)
    .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
  const sequence = (entries.at(-1)?.sequence || 0) + 1;
  const unsigned = {
    schema_version: "owner_authority_audit_v1",
    audit_id: `oaa_${genericWorkCoreJoinDigest({ tenant_id: tenantId, sequence, event }).slice(0, 40)}`,
    sequence,
    tenant_id: tenantId,
    work_id: id(event.work_id, "owner_authority_audit_invalid"),
    operation: id(event.operation, "owner_authority_audit_invalid"),
    authority_envelope_id: event.authority_envelope_id === null
      ? null : id(event.authority_envelope_id, "owner_authority_audit_invalid"),
    reconciliation_id: event.reconciliation_id === null
      ? null : id(event.reconciliation_id, "owner_authority_audit_invalid"),
    owner_subject_fingerprint: text(
      event.owner_subject_fingerprint,
      "owner_authority_audit_invalid",
      100,
    ).toLowerCase(),
    event_digest: digest(event.event_digest, "owner_authority_audit_invalid"),
    recorded_at: event.recorded_at,
  };
  const audit = { ...unsigned, audit_digest: genericWorkCoreJoinDigest(unsigned) };
  state.owner_authority_audit[audit.audit_id] = audit;
  return clone(audit);
}

function idempotencyRecord(state, tenantId, operation, key, requestDigest) {
  const idempotencyKey = `${tenantId}\u0000${operation}\u0000${key}`;
  const current = state.owner_authority_idempotency?.[idempotencyKey];
  if (!current) return { idempotencyKey, replay: null };
  if (current.request_digest !== requestDigest) fail("owner_authority_idempotency_conflict");
  return { idempotencyKey, replay: clone(current.result) };
}

function saveIdempotency(state, idempotencyKey, requestDigest, result) {
  if (!plainRecord(state.owner_authority_idempotency)) state.owner_authority_idempotency = {};
  state.owner_authority_idempotency[idempotencyKey] = {
    request_digest: requestDigest,
    result: clone(result),
  };
  return result;
}

function assertionNonceKey(tenantId, confirmation) {
  return `${tenantId}\u0000${confirmation.owner_subject_fingerprint}\u0000${confirmation.consent_nonce}`;
}

// The OAuth assertion is request-bound at the HTTP boundary.  Preserve that
// one-time property durably across *every* authority action, while allowing a
// retry of the exact idempotent request after a transient adapter failure.
function consumeOwnerConfirmation(state, tenantId, confirmation, operation, requestDigest, consumedAt) {
  if (!plainRecord(state.owner_authority_confirmation_nonces)) {
    state.owner_authority_confirmation_nonces = {};
  }
  const nonceKey = assertionNonceKey(tenantId, confirmation);
  const consumed = state.owner_authority_confirmation_nonces[nonceKey];
  if (consumed && (
    consumed.request_digest !== requestDigest ||
    consumed.operation !== operation ||
    consumed.purpose !== confirmation.purpose
  )) {
    fail("owner_authority_confirmation_replayed");
  }
  if (!consumed) {
    state.owner_authority_confirmation_nonces[nonceKey] = {
      request_digest: requestDigest,
      operation,
      purpose: confirmation.purpose,
      consumed_at: consumedAt,
    };
  }
}

// A closure is an authorization for already-observed evidence, not a way to
// revive it. Recheck the persisted independent observation immediately before
// signing the first closure proof. Exact idempotent retries return their
// existing proof earlier in `authorizeClosure`, so recovery never weakens the
// freshness gate for a new authorization.
function requireFreshClosurePostVerification(raw, reconciliation, nowValue) {
  const observation = raw?.observation;
  if (!plainRecord(observation) || !plainRecord(observation.post_verification)) {
    fail("owner_manual_effect_closure_post_verification_invalid");
  }
  const post = observation.post_verification;
  let observedAt;
  let reconciledAt;
  let verifiedAt;
  try {
    observedAt = timestamp(
      reconciliation.observed_at,
      "owner_manual_effect_closure_post_verification_invalid",
    );
    reconciledAt = timestamp(
      reconciliation.reconciled_at,
      "owner_manual_effect_closure_post_verification_invalid",
    );
    verifiedAt = timestamp(
      post.verified_at,
      "owner_manual_effect_closure_post_verification_invalid",
    );
  } catch {
    fail("owner_manual_effect_closure_post_verification_invalid");
  }
  if (
    observation.schema_version !== OWNER_MANUAL_EFFECT_ADAPTER_OBSERVATION_SCHEMA_VERSION ||
    observation.trusted !== true || observation.outcome !== "VERIFIED_SUCCESS" ||
    observation.provider_execution !== false || observation.external_side_effect !== false ||
    observation.adapter_id !== reconciliation.adapter_id ||
    observation.effect_type !== reconciliation.effect_type ||
    observation.resource_id !== reconciliation.resource_id ||
    observation.effect_reference_digest !== reconciliation.effect_reference_digest ||
    observation.observed_at !== reconciliation.observed_at ||
    post.schema_version !== OWNER_MANUAL_EFFECT_POST_VERIFICATION_SCHEMA_VERSION ||
    post.verified !== true || post.evidence_digest !== observation.evidence_digest ||
    genericWorkCoreJoinDigest(observation) !== reconciliation.observation_digest ||
    genericWorkCoreJoinDigest(post) !== reconciliation.post_verification_digest ||
    observedAt > reconciledAt || verifiedAt < observedAt ||
    observedAt > nowValue + 60_000 || reconciledAt > nowValue + 60_000 ||
    verifiedAt > nowValue + 60_000
  ) {
    fail("owner_manual_effect_closure_post_verification_invalid");
  }
  if (
    nowValue - observedAt > MAX_POST_VERIFICATION_AGE_MS ||
    nowValue - reconciledAt > MAX_POST_VERIFICATION_AGE_MS ||
    nowValue - verifiedAt > MAX_POST_VERIFICATION_AGE_MS
  ) {
    fail("owner_manual_effect_closure_post_verification_stale");
  }
}

function requireAuthorityStore(store, requireDurableStore) {
  if (!store || typeof store.readState !== "function" || typeof store.mutate !== "function") {
    fail("owner_authority_store_unavailable");
  }
  if (requireDurableStore === true && store.restart_durable !== true) {
    fail("owner_authority_durable_store_required");
  }
  if (requireDurableStore === true && store.distributed !== true) {
    fail("owner_authority_distributed_store_required");
  }
}

function signedProof(unsigned, signer) {
  const proofDigest = genericWorkCoreJoinDigest(unsigned);
  return Promise.resolve(signer.signDigest(proofDigest)).then((signature) => {
    try {
      verifyGenericWorkCoreJoinDigestSignature({
        digest: proofDigest,
        signature,
        publicKey: signer.public_key,
      });
    } catch {
      fail("authority_proof_signature_invalid");
    }
    return { ...unsigned, proof_digest: proofDigest, signature };
  });
}

function normalizedSigner(signer) {
  if (!signer || signer.algorithm !== "Ed25519" || typeof signer.signDigest !== "function" ||
      !signer.public_key || !ID.test(String(signer.key_id || ""))) {
    fail("owner_authority_proof_signer_unavailable");
  }
  return signer;
}

/**
 * Durable, provider-neutral Manual Effect Reconciliation service.
 *
 * It is intentionally evidence-only: it never emits an action ticket and a
 * break-glass envelope never authorizes merge, deploy or a provider call.
 */
export function createOwnerManualEffectReconciliation({
  store,
  signer: suppliedSigner,
  adapters = {},
  now = () => Date.now(),
  idFactory = () => crypto.randomBytes(16).toString("hex"),
  requireDurableStore = false,
} = {}) {
  requireAuthorityStore(store, requireDurableStore);
  const signer = normalizedSigner(suppliedSigner);

  function makeId(prefix, seed) {
    const candidate = String(idFactory?.() || "").replace(/[^A-Za-z0-9._:-]/g, "");
    return `${prefix}_${(candidate || genericWorkCoreJoinDigest(seed).slice(0, 40)).slice(0, 80)}`;
  }

  async function issueEnvelope(input = {}) {
    exactKeys(input, [
      "break_glass_reason_digest",
      "effect_ceiling",
      "idempotency_key",
      "intent_anchor_digest",
      "mode",
      "owner_confirmation",
      "scope",
      "tenant_id",
      "ttl_seconds",
      "work_binding",
      "work_id",
    ], "owner_authority_envelope_request_invalid");
    const tenantId = id(input.tenant_id, "owner_authority_envelope_request_invalid");
    const workId = id(input.work_id, "owner_authority_envelope_request_invalid");
    const intentDigest = digest(input.intent_anchor_digest, "owner_authority_envelope_request_invalid");
    const mode = input.mode;
    if (!["OWNER_MANUAL", "OWNER_BREAK_GLASS"].includes(mode)) {
      fail("owner_authority_mode_invalid");
    }
    const nowValue = nowMillis(now);
    const ttlMs = Number(input.ttl_seconds) * 1_000;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < MIN_ENVELOPE_TTL_MS || ttlMs > MAX_ENVELOPE_TTL_MS) {
      fail("owner_authority_ttl_invalid");
    }
    const scope = normalizedScope(input.scope, mode);
    const ceiling = normalizedEffectCeiling(input.effect_ceiling, scope, mode);
    const workBinding = normalizedWorkBinding(input.work_binding, {
      tenant_id: tenantId,
      work_id: workId,
      intent_anchor_digest: intentDigest,
      mode,
    }, nowValue);
    if (!scopeIsSubset(scope, workBinding.allowed_scope)) {
      fail("owner_manual_effect_work_scope_denied");
    }
    const breakGlassReason = mode === "OWNER_BREAK_GLASS"
      ? digest(input.break_glass_reason_digest, "owner_break_glass_reason_required")
      : input.break_glass_reason_digest === null ? null : fail("owner_break_glass_reason_unexpected");
    const confirmation = normalizedOwnerConfirmation(
      input.owner_confirmation,
      "host_native_owner_authority_envelope_issue",
    );
    const idempotencyKey = text(input.idempotency_key, "owner_authority_idempotency_key_required", 160);
    const requestMaterial = {
      tenant_id: tenantId,
      work_id: workId,
      intent_anchor_digest: intentDigest,
      mode,
      scope,
      effect_ceiling: ceiling,
      work_binding_digest: workBinding.binding_digest,
      break_glass_reason_digest: breakGlassReason,
      owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
      request_binding_hash: confirmation.request_binding_hash,
      ttl_seconds: Number(input.ttl_seconds),
      idempotency_key: idempotencyKey,
    };
    const requestDigest = genericWorkCoreJoinDigest(requestMaterial);
    const initial = store.readState();
    const prior = idempotencyRecord(initial, tenantId, "issue", idempotencyKey, requestDigest);
    if (prior.replay) return prior.replay;
    const issuedAt = iso(nowValue);
    const expiresAt = iso(nowValue + ttlMs);
    const envelopeId = makeId("oae", requestMaterial);
    const scopeDigest = genericWorkCoreJoinDigest(scope);
    const effectCeilingDigest = genericWorkCoreJoinDigest(ceiling);
    const unsignedEnvelope = envelopeUnsigned({
      envelope_id: envelopeId,
      tenant_id: tenantId,
      work_id: workId,
      intent_anchor_digest: intentDigest,
      mode,
      owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
      owner_confirmation_digest: confirmation.confirmation_digest,
      scope,
      scope_digest: scopeDigest,
      effect_ceiling: ceiling,
      effect_ceiling_digest: effectCeilingDigest,
      work_binding: Object.fromEntries(Object.entries(workBinding)
        .filter(([key]) => key !== "allowed_scope")),
      work_binding_digest: workBinding.binding_digest,
      break_glass_reason_digest: breakGlassReason,
      issued_at: issuedAt,
      expires_at: expiresAt,
    });
    const envelopeDigest = genericWorkCoreJoinDigest(unsignedEnvelope);
    const proof = await signedProof(authorityProofUnsigned({
      proof_type: "owner_authority_envelope",
      proof_id: makeId("oap", { envelope_id: envelopeId, proof_type: "envelope" }),
      key_id: signer.key_id,
      tenant_id: tenantId,
      work_id: workId,
      intent_anchor_digest: intentDigest,
      authority_envelope_id: envelopeId,
      authority_envelope_digest: envelopeDigest,
      owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
      scope_digest: scopeDigest,
      effect_ceiling_digest: effectCeilingDigest,
      work_binding_digest: workBinding.binding_digest,
      mode,
      break_glass_reason_digest: breakGlassReason,
      revocation_epoch: 0,
      issued_at: issuedAt,
      expires_at: expiresAt,
      closure_authorized: false,
    }), signer);
    const envelope = { ...unsignedEnvelope, envelope_digest: envelopeDigest, authority_proof: proof };
    return store.mutate((state) => {
      const descriptor = idempotencyRecord(state, tenantId, "issue", idempotencyKey, requestDigest);
      if (descriptor.replay) return descriptor.replay;
      if (!plainRecord(state.owner_authority_envelopes)) state.owner_authority_envelopes = {};
      consumeOwnerConfirmation(
        state, tenantId, confirmation, "issue", requestDigest, issuedAt,
      );
      const existing = state.owner_authority_envelopes[envelopeId];
      if (existing && existing.envelope?.envelope_digest !== envelopeDigest) {
        fail("owner_authority_envelope_conflict");
      }
      state.owner_authority_envelopes[envelopeId] = {
        envelope: clone(envelope),
        state: "active",
        usage_count: 0,
        revocation_epoch: 0,
      };
      const audit = appendAudit(state, {
        tenant_id: tenantId,
        work_id: workId,
        operation: "owner_authority_envelope_issue",
        authority_envelope_id: envelopeId,
        reconciliation_id: null,
        owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
        event_digest: envelopeDigest,
        recorded_at: issuedAt,
      });
      return saveIdempotency(state, descriptor.idempotencyKey, requestDigest, {
        envelope: clone(envelope),
        audit,
      });
    });
  }

  function readEnvelope(input = {}) {
    exactKeys(input, [
      "envelope_id",
      "owner_confirmation",
      "tenant_id",
    ], "owner_authority_envelope_read_invalid");
    const tenantId = id(input.tenant_id, "owner_authority_envelope_read_invalid");
    const envelopeId = id(input.envelope_id, "owner_authority_envelope_read_invalid");
    const confirmation = normalizedOwnerConfirmation(
      input.owner_confirmation,
      "host_native_owner_authority_envelope_read",
    );
    const record = store.readState().owner_authority_envelopes?.[envelopeId];
    if (!record) fail("owner_authority_envelope_not_found");
    if (record.envelope?.tenant_id !== tenantId) fail("cross_tenant_owner_authority_envelope_denied");
    if (record.envelope?.owner_subject_fingerprint !== confirmation.owner_subject_fingerprint) {
      fail("owner_authority_envelope_owner_mismatch");
    }
    return clone(record);
  }

  // Owner-scoped read used internally by the MCP closure bridge to obtain the
  // already-signed selector before it asks Work Continuity V2 to resolve a
  // fresh server-owned binding. It is not a general Work discovery API.
  function readManualEffectReconciliation(input = {}) {
    exactKeys(input, [
      "owner_confirmation",
      "reconciliation_id",
      "tenant_id",
    ], "owner_manual_effect_reconciliation_read_invalid");
    const tenantId = id(input.tenant_id, "owner_manual_effect_reconciliation_read_invalid");
    const reconciliationId = id(
      input.reconciliation_id,
      "owner_manual_effect_reconciliation_read_invalid",
    );
    const confirmation = normalizedOwnerConfirmation(
      input.owner_confirmation,
      "host_native_owner_manual_effect_reconciliation_read",
    );
    const record = store.readState().owner_manual_effect_reconciliations?.[reconciliationId];
    const reconciliation = record?.reconciliation;
    if (!reconciliation) fail("owner_manual_effect_reconciliation_not_found");
    if (reconciliation.tenant_id !== tenantId) {
      fail("cross_tenant_owner_manual_effect_reconciliation_denied");
    }
    if (reconciliation.owner_subject_fingerprint !== confirmation.owner_subject_fingerprint) {
      fail("owner_manual_effect_reconciliation_owner_mismatch");
    }
    return clone(record);
  }

  async function revokeEnvelope(input = {}) {
    exactKeys(input, [
      "envelope_id",
      "idempotency_key",
      "owner_confirmation",
      "tenant_id",
    ], "owner_authority_revoke_request_invalid");
    const tenantId = id(input.tenant_id, "owner_authority_revoke_request_invalid");
    const envelopeId = id(input.envelope_id, "owner_authority_revoke_request_invalid");
    const confirmation = normalizedOwnerConfirmation(
      input.owner_confirmation,
      "host_native_owner_authority_envelope_revoke",
    );
    const idempotencyKey = text(input.idempotency_key, "owner_authority_idempotency_key_required", 160);
    const requestDigest = genericWorkCoreJoinDigest({
      tenant_id: tenantId,
      envelope_id: envelopeId,
      owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
      request_binding_hash: confirmation.request_binding_hash,
      idempotency_key: idempotencyKey,
    });
    const initial = store.readState();
    const prior = idempotencyRecord(initial, tenantId, "revoke", idempotencyKey, requestDigest);
    if (prior.replay) return prior.replay;
    const nowValue = nowMillis(now);
    return store.mutate((state) => {
      const descriptor = idempotencyRecord(state, tenantId, "revoke", idempotencyKey, requestDigest);
      if (descriptor.replay) return descriptor.replay;
      const record = state.owner_authority_envelopes?.[envelopeId];
      const envelope = record?.envelope;
      if (!envelope) fail("owner_authority_envelope_not_found");
      if (envelope.tenant_id !== tenantId) fail("cross_tenant_owner_authority_envelope_denied");
      if (envelope.owner_subject_fingerprint !== confirmation.owner_subject_fingerprint) {
        fail("owner_authority_envelope_owner_mismatch");
      }
      // An envelope becomes terminal when reconciliation consumes it.  This
      // makes a signed closure proof non-raceable: revocation is available
      // while ACTIVE, but cannot be applied after a proof has been emitted.
      if (record.state !== "active" || Number(record.usage_count) !== 0) {
        fail("owner_authority_envelope_revocation_closed");
      }
      consumeOwnerConfirmation(
        state, tenantId, confirmation, "revoke", requestDigest, iso(nowValue),
      );
      if (record.revocation?.state === "revoked") {
        return saveIdempotency(state, descriptor.idempotencyKey, requestDigest, clone(record));
      }
      const revokedAt = iso(nowValue);
      const revocationUnsigned = {
        schema_version: "owner_authority_envelope_revocation_v1",
        envelope_id: envelopeId,
        tenant_id: tenantId,
        work_id: envelope.work_id,
        owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
        revocation_epoch: Number(record.revocation_epoch || 0) + 1,
        owner_confirmation_digest: confirmation.confirmation_digest,
        revoked_at: revokedAt,
      };
      const revocation = {
        ...revocationUnsigned,
        revocation_digest: genericWorkCoreJoinDigest(revocationUnsigned),
      };
      record.revocation = { state: "revoked", ...revocation };
      record.state = "revoked";
      record.revocation_epoch = revocation.revocation_epoch;
      const audit = appendAudit(state, {
        tenant_id: tenantId,
        work_id: envelope.work_id,
        operation: "owner_authority_envelope_revoke",
        authority_envelope_id: envelopeId,
        reconciliation_id: null,
        owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
        event_digest: revocation.revocation_digest,
        recorded_at: revokedAt,
      });
      return saveIdempotency(state, descriptor.idempotencyKey, requestDigest, {
        envelope: clone(envelope),
        revocation: clone(revocation),
        audit,
      });
    });
  }

  async function recordManualEffect(input = {}) {
    exactKeys(input, [
      "adapter_id",
      "effect_reference",
      "effect_type",
      "envelope_id",
      "idempotency_key",
      "intent_anchor_digest",
      "owner_confirmation",
      "resource_id",
      "tenant_id",
      "work_binding",
      "work_id",
    ], "owner_manual_effect_reconciliation_request_invalid");
    const tenantId = id(input.tenant_id, "owner_manual_effect_reconciliation_request_invalid");
    const workId = id(input.work_id, "owner_manual_effect_reconciliation_request_invalid");
    const intentDigest = digest(input.intent_anchor_digest, "owner_manual_effect_reconciliation_request_invalid");
    const envelopeId = id(input.envelope_id, "owner_manual_effect_reconciliation_request_invalid");
    const adapterId = id(input.adapter_id, "owner_manual_effect_reconciliation_request_invalid");
    const effectType = id(input.effect_type, "owner_manual_effect_reconciliation_request_invalid");
    const normalizedResourceId = resourceId(
      input.resource_id,
      "owner_manual_effect_reconciliation_request_invalid",
    );
    if (!plainRecord(input.effect_reference)) fail("owner_manual_effect_reference_invalid");
    const effectReference = clone(input.effect_reference);
    const effectReferenceDigest = genericWorkCoreJoinDigest(effectReference);
    const confirmation = normalizedOwnerConfirmation(
      input.owner_confirmation,
      "host_native_owner_manual_effect_reconcile",
    );
    const idempotencyKey = text(input.idempotency_key, "owner_authority_idempotency_key_required", 160);
    const nowValue = nowMillis(now);
    const initial = store.readState();
    const initialEnvelope = initial.owner_authority_envelopes?.[envelopeId]?.envelope;
    if (!initialEnvelope) fail("owner_authority_envelope_not_found");
    const workBinding = normalizedWorkBinding(input.work_binding, {
      tenant_id: tenantId,
      work_id: workId,
      intent_anchor_digest: intentDigest,
      mode: initialEnvelope.mode,
    }, nowValue);
    const requestMaterial = {
      tenant_id: tenantId,
      work_id: workId,
      intent_anchor_digest: intentDigest,
      envelope_id: envelopeId,
      adapter_id: adapterId,
      effect_type: effectType,
      resource_id: normalizedResourceId,
      effect_reference_digest: effectReferenceDigest,
      work_binding_digest: workBinding.binding_digest,
      owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
      request_binding_hash: confirmation.request_binding_hash,
      idempotency_key: idempotencyKey,
    };
    const requestDigest = genericWorkCoreJoinDigest(requestMaterial);
    const effectInstanceClaimKey = manualEffectInstanceClaimKey({
      tenant_id: tenantId,
      adapter_id: adapterId,
      effect_type: effectType,
      resource_id: normalizedResourceId,
      effect_reference_digest: effectReferenceDigest,
    });
    const prior = idempotencyRecord(initial, tenantId, "reconcile", idempotencyKey, requestDigest);
    if (prior.replay) return prior.replay;
    const adapter = adapterFromRegistry(adapters, adapterId);
    const prepared = store.mutate((state) => {
      const descriptor = idempotencyRecord(state, tenantId, "reconcile", idempotencyKey, requestDigest);
      if (descriptor.replay) return descriptor.replay;
      const record = state.owner_authority_envelopes?.[envelopeId];
      const envelope = record?.envelope;
      if (!envelope) fail("owner_authority_envelope_not_found");
      if (envelope.tenant_id !== tenantId || envelope.work_id !== workId ||
          envelope.intent_anchor_digest !== intentDigest ||
          envelope.owner_subject_fingerprint !== confirmation.owner_subject_fingerprint ||
          record.revocation?.state === "revoked") {
        fail("owner_authority_envelope_binding_invalid");
      }
      const { scope, ceiling } = envelopeValid(record, signer, nowValue);
      if (!scope.adapter_ids.includes(adapterId) || !scope.effect_types.includes(effectType) ||
          !scope.resource_ids.includes(normalizedResourceId) ||
          !scope.effect_reference_digests.includes(effectReferenceDigest) ||
          !ceiling.includes(effectType)) {
        fail("owner_authority_scope_or_ceiling_denied");
      }
      if (
        envelope.work_binding_digest !== workBinding.binding_digest ||
        !bindingAllowsTuple(workBinding, {
          adapter_id: adapterId,
          effect_type: effectType,
          resource_id: normalizedResourceId,
          effect_reference_digest: effectReferenceDigest,
        })
      ) fail("owner_manual_effect_work_scope_denied");
      if (envelope.mode === "OWNER_BREAK_GLASS" &&
          (!BREAK_GLASS_EFFECTS.has(effectType) || adapterId !== BREAK_GLASS_ADAPTER)) {
        fail("owner_break_glass_effect_denied");
      }
      consumeOwnerConfirmation(
        state, tenantId, confirmation, "reconcile", requestDigest, iso(nowValue),
      );
      if (record.reconciliation_pending) {
        if (record.reconciliation_pending.request_digest !== requestDigest) {
          fail("owner_manual_effect_reconciliation_in_progress");
        }
        fail("owner_manual_effect_reconciliation_in_progress");
      }
      if (!plainRecord(state.owner_manual_effect_instance_claims)) {
        state.owner_manual_effect_instance_claims = {};
      }
      const existingEffectClaim = state.owner_manual_effect_instance_claims[effectInstanceClaimKey];
      if (existingEffectClaim?.state === "pending" &&
          timestamp(existingEffectClaim.expires_at, "owner_manual_effect_instance_claim_invalid") <= nowValue) {
        delete state.owner_manual_effect_instance_claims[effectInstanceClaimKey];
      }
      const activeEffectClaim = state.owner_manual_effect_instance_claims[effectInstanceClaimKey];
      if (activeEffectClaim) {
        if (activeEffectClaim.request_digest === requestDigest &&
            activeEffectClaim.state === "pending") {
          fail("owner_manual_effect_instance_reconciliation_in_progress");
        }
        fail("owner_manual_effect_instance_already_claimed");
      }
      state.owner_manual_effect_instance_claims[effectInstanceClaimKey] = {
        schema_version: "owner_manual_effect_instance_claim_v1",
        state: "pending",
        tenant_id: tenantId,
        work_id: workId,
        intent_anchor_digest: intentDigest,
        authority_envelope_id: envelopeId,
        adapter_id: adapterId,
        effect_type: effectType,
        resource_id: normalizedResourceId,
        effect_reference_digest: effectReferenceDigest,
        request_digest: requestDigest,
        prepared_at: iso(nowValue),
        expires_at: envelope.expires_at,
      };
      record.reconciliation_pending = {
        request_digest: requestDigest,
        idempotency_key: idempotencyKey,
        prepared_at: iso(nowValue),
      };
      return { envelope: clone(envelope) };
    });
    let verifiedObservation;
    try {
      const observation = await adapter.reconcile(Object.freeze({
        tenant_id: tenantId,
        work_id: workId,
        intent_anchor_digest: intentDigest,
        mode: prepared.envelope.mode,
        adapter_id: adapterId,
        effect_type: effectType,
        resource_id: normalizedResourceId,
        effect_reference: clone(effectReference),
        effect_reference_digest: effectReferenceDigest,
        authority_envelope: clone(prepared.envelope),
      }));
      verifiedObservation = normalizedAdapterObservation(observation, {
        adapter_id: adapterId,
        effect_type: effectType,
        resource_id: normalizedResourceId,
        effect_reference_digest: effectReferenceDigest,
      }, nowMillis(now), timestamp(
        prepared.envelope.issued_at,
        "owner_manual_effect_adapter_observation_invalid",
      ));
    } catch (error) {
      store.mutate((state) => {
        const record = state.owner_authority_envelopes?.[envelopeId];
        if (record?.reconciliation_pending?.request_digest === requestDigest) {
          delete record.reconciliation_pending;
        }
        const effectClaim = state.owner_manual_effect_instance_claims?.[effectInstanceClaimKey];
        if (effectClaim?.state === "pending" && effectClaim.request_digest === requestDigest) {
          delete state.owner_manual_effect_instance_claims[effectInstanceClaimKey];
        }
        return null;
      });
      fail(String(error?.message || "owner_manual_effect_adapter_failed"));
    }
    const reconciledAt = iso(nowMillis(now));
    const finalized = store.mutate((state) => {
      const descriptor = idempotencyRecord(state, tenantId, "reconcile", idempotencyKey, requestDigest);
      if (descriptor.replay) return descriptor.replay;
      const record = state.owner_authority_envelopes?.[envelopeId];
      const envelope = record?.envelope;
      if (!envelope || record?.reconciliation_pending?.request_digest !== requestDigest ||
          record.revocation?.state === "revoked") {
        // The adapter is deliberately outside the store transaction. If a
        // revocation wins while it is reading, clear only this matching
        // pending marker and then report the terminal state. Returning from
        // the mutation (rather than throwing inside it) persists cleanup for
        // stores that roll back a throwing mutator.
        if (record?.reconciliation_pending?.request_digest === requestDigest) {
          delete record.reconciliation_pending;
        }
        const effectClaim = state.owner_manual_effect_instance_claims?.[effectInstanceClaimKey];
        if (effectClaim?.state === "pending" && effectClaim.request_digest === requestDigest) {
          delete state.owner_manual_effect_instance_claims[effectInstanceClaimKey];
        }
        return { reconciliation_state_changed: true };
      }
      envelopeValid(record, signer, nowMillis(now));
      const reconciliationId = makeId("omer", requestMaterial);
      const postVerificationDigest = genericWorkCoreJoinDigest(verifiedObservation.post_verification);
      const reconciliationUnsigned = {
        schema_version: OWNER_MANUAL_EFFECT_RECONCILIATION_SCHEMA_VERSION,
        reconciliation_id: reconciliationId,
        tenant_id: tenantId,
        work_id: workId,
        intent_anchor_digest: intentDigest,
        authority_envelope_id: envelopeId,
        authority_envelope_digest: envelope.envelope_digest,
        work_binding: clone(envelope.work_binding),
        work_binding_digest: envelope.work_binding_digest,
        mode: envelope.mode,
        break_glass_reason_digest: envelope.break_glass_reason_digest,
        owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
        adapter_id: adapterId,
        effect_type: effectType,
        resource_id: normalizedResourceId,
        effect_reference_digest: effectReferenceDigest,
        observation_digest: genericWorkCoreJoinDigest(verifiedObservation),
        evidence_digest: verifiedObservation.evidence_digest,
        post_verification_digest: postVerificationDigest,
        observed_at: verifiedObservation.observed_at,
        reconciled_at: reconciledAt,
        outcome: "VERIFIED_SUCCESS",
        closure_state: "POST_VERIFICATION_REQUIRED",
        ticket_issued: false,
        retrospective_ticket_issued: false,
        action_authorized: false,
        execution_authorized: false,
        provider_execution: false,
        external_side_effect: false,
      };
      const reconciliation = {
        ...reconciliationUnsigned,
        reconciliation_digest: genericWorkCoreJoinDigest(reconciliationUnsigned),
      };
      const effectClaim = state.owner_manual_effect_instance_claims?.[effectInstanceClaimKey];
      if (effectClaim?.state !== "pending" || effectClaim.request_digest !== requestDigest) {
        fail("owner_manual_effect_instance_claim_state_changed");
      }
      if (!plainRecord(state.owner_manual_effect_reconciliations)) {
        state.owner_manual_effect_reconciliations = {};
      }
      const existing = state.owner_manual_effect_reconciliations[reconciliationId];
      if (existing && existing.reconciliation?.reconciliation_digest !== reconciliation.reconciliation_digest) {
        fail("owner_manual_effect_reconciliation_conflict");
      }
      state.owner_manual_effect_reconciliations[reconciliationId] = {
        reconciliation: clone(reconciliation),
        observation: clone(verifiedObservation),
        closure_state: "POST_VERIFICATION_REQUIRED",
      };
      state.owner_manual_effect_instance_claims[effectInstanceClaimKey] = {
        ...effectClaim,
        state: "consumed",
        reconciliation_id: reconciliationId,
        reconciliation_digest: reconciliation.reconciliation_digest,
        consumed_at: reconciledAt,
      };
      record.usage_count = 1;
      record.state = "consumed";
      delete record.reconciliation_pending;
      const audit = appendAudit(state, {
        tenant_id: tenantId,
        work_id: workId,
        operation: "owner_manual_effect_reconcile",
        authority_envelope_id: envelopeId,
        reconciliation_id: reconciliationId,
        owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
        event_digest: reconciliation.reconciliation_digest,
        recorded_at: reconciledAt,
      });
      return saveIdempotency(state, descriptor.idempotencyKey, requestDigest, {
        reconciliation: clone(reconciliation),
        audit,
      });
    });
    if (finalized?.reconciliation_state_changed === true) {
      fail("owner_manual_effect_reconciliation_state_changed");
    }
    return finalized;
  }

  async function authorizeClosure(input = {}) {
    exactKeys(input, [
      "idempotency_key",
      "owner_confirmation",
      "reconciliation_id",
      "tenant_id",
      "work_binding",
    ], "owner_manual_effect_closure_request_invalid");
    const tenantId = id(input.tenant_id, "owner_manual_effect_closure_request_invalid");
    const reconciliationId = id(input.reconciliation_id, "owner_manual_effect_closure_request_invalid");
    const confirmation = normalizedOwnerConfirmation(
      input.owner_confirmation,
      "host_native_owner_manual_effect_authorize_closure",
    );
    const idempotencyKey = text(input.idempotency_key, "owner_authority_idempotency_key_required", 160);
    const nowValue = nowMillis(now);
    const initial = store.readState();
    const raw = initial.owner_manual_effect_reconciliations?.[reconciliationId];
    const reconciliation = raw?.reconciliation;
    if (!reconciliation) fail("owner_manual_effect_closure_binding_invalid");
    // Closure re-resolves the V2 Work binding instead of trusting only the
    // historical envelope. The stable binding digest excludes verified_at,
    // so this permits a fresh read while rejecting Work/status/selector drift.
    const workBinding = normalizedWorkBinding(input.work_binding, {
      tenant_id: tenantId,
      work_id: reconciliation.work_id,
      intent_anchor_digest: reconciliation.intent_anchor_digest,
      mode: reconciliation.mode,
    }, nowValue);
    const requestDigest = genericWorkCoreJoinDigest({
      tenant_id: tenantId,
      reconciliation_id: reconciliationId,
      work_binding_digest: workBinding.binding_digest,
      owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
      request_binding_hash: confirmation.request_binding_hash,
      idempotency_key: idempotencyKey,
    });
    const prior = idempotencyRecord(initial, tenantId, "authorize_closure", idempotencyKey, requestDigest);
    if (prior.replay) return prior.replay;
    requireFreshClosurePostVerification(raw, reconciliation, nowValue);
    const envelopeRecord = reconciliation && initial.owner_authority_envelopes?.[
      reconciliation.authority_envelope_id
    ];
    const envelope = envelopeRecord?.envelope;
    if (!reconciliation || !envelope || reconciliation.tenant_id !== tenantId ||
        reconciliation.owner_subject_fingerprint !== confirmation.owner_subject_fingerprint ||
        envelopeRecord?.revocation?.state === "revoked") {
      fail("owner_manual_effect_closure_binding_invalid");
    }
    if (raw?.closure_state !== "POST_VERIFICATION_REQUIRED") {
      fail("owner_manual_effect_closure_consumed");
    }
    if (envelopeRecord.state !== "consumed" || envelopeRecord.usage_count !== 1 ||
        timestamp(envelope.expires_at, "owner_manual_effect_closure_binding_invalid") <= nowValue) {
      fail("owner_manual_effect_closure_binding_invalid");
    }
    if (
      reconciliation.work_binding_digest !== workBinding.binding_digest ||
      envelope.work_binding_digest !== workBinding.binding_digest ||
      reconciliation.mode !== envelope.mode ||
      reconciliation.break_glass_reason_digest !== envelope.break_glass_reason_digest ||
      !bindingAllowsTuple(workBinding, {
        adapter_id: reconciliation.adapter_id,
        effect_type: reconciliation.effect_type,
        resource_id: reconciliation.resource_id,
        effect_reference_digest: reconciliation.effect_reference_digest,
      })
    ) fail("owner_manual_effect_closure_binding_invalid");
    const issuedAt = iso(nowValue);
    const expiresAt = iso(Math.min(
      nowValue + MIN_ENVELOPE_TTL_MS,
      timestamp(envelope.expires_at, "owner_manual_effect_closure_binding_invalid"),
    ));
    const proof = await signedProof(authorityProofUnsigned({
      proof_type: "owner_manual_effect_closure",
      proof_id: makeId("oap", { reconciliation_id: reconciliationId, proof_type: "closure" }),
      key_id: signer.key_id,
      tenant_id: tenantId,
      work_id: reconciliation.work_id,
      intent_anchor_digest: reconciliation.intent_anchor_digest,
      authority_envelope_id: envelope.envelope_id,
      authority_envelope_digest: envelope.envelope_digest,
      reconciliation_id: reconciliation.reconciliation_id,
      reconciliation_digest: reconciliation.reconciliation_digest,
      owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
      scope_digest: envelope.scope_digest,
      effect_ceiling_digest: envelope.effect_ceiling_digest,
      work_binding_digest: envelope.work_binding_digest,
      mode: envelope.mode,
      break_glass_reason_digest: envelope.break_glass_reason_digest,
      revocation_epoch: envelopeRecord.revocation_epoch,
      issued_at: issuedAt,
      expires_at: expiresAt,
      closure_authorized: true,
      post_verification_digest: reconciliation.post_verification_digest,
    }), signer);
    return store.mutate((state) => {
      const descriptor = idempotencyRecord(state, tenantId, "authorize_closure", idempotencyKey, requestDigest);
      if (descriptor.replay) return descriptor.replay;
      const current = state.owner_manual_effect_reconciliations?.[reconciliationId];
      const currentEnvelope = current && state.owner_authority_envelopes?.[
        current.reconciliation.authority_envelope_id
      ];
      if (!current || !currentEnvelope || currentEnvelope.revocation?.state === "revoked" ||
          currentEnvelope.state !== "consumed" ||
          current.closure_state !== "POST_VERIFICATION_REQUIRED") {
        fail("owner_manual_effect_closure_state_changed");
      }
      consumeOwnerConfirmation(
        state, tenantId, confirmation, "authorize_closure", requestDigest, issuedAt,
      );
      current.closure_authority_proof = clone(proof);
      current.closure_state = "CLOSURE_AUTHORIZED";
      const audit = appendAudit(state, {
        tenant_id: tenantId,
        work_id: current.reconciliation.work_id,
        operation: "owner_manual_effect_authorize_closure",
        authority_envelope_id: current.reconciliation.authority_envelope_id,
        reconciliation_id: reconciliationId,
        owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
        event_digest: proof.proof_digest,
        recorded_at: issuedAt,
      });
      return saveIdempotency(state, descriptor.idempotencyKey, requestDigest, {
        reconciliation: clone(current.reconciliation),
        authority_proof: clone(proof),
        closure_authorized: true,
        audit,
      });
    });
  }

  return Object.freeze({
    schema_version: "owner_manual_effect_reconciliation_service_v1",
    configured: true,
    provider_execution: false,
    issueEnvelope,
    readEnvelope,
    readManualEffectReconciliation,
    revokeEnvelope,
    recordManualEffect,
    authorizeClosure,
    verifyAuthorityProof(proof, expected = {}) {
      return authorityProofValid(proof, signer, nowMillis(now), expected);
    },
  });
}
