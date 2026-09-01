import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  createInMemoryHostNativeGovernanceStore,
} from "../src/hostNativeGovernance.js";
import {
  createLocalGenericWorkCoreJoinSigner,
  genericWorkCoreJoinDigest,
} from "../src/genericWorkCoreJoin.js";
import {
  createHostNativeNyraCoreManualEffectAdapter,
  nyraCoreRepairActionDigest,
} from "../src/hostNativeExternalReadback.js";
import {
  createOwnerManualEffectReconciliation,
  OWNER_MANUAL_EFFECT_ADAPTER_OBSERVATION_SCHEMA_VERSION,
  OWNER_MANUAL_EFFECT_POST_VERIFICATION_SCHEMA_VERSION,
  OWNER_MANUAL_EFFECT_WORK_BINDING_SCHEMA_VERSION,
} from "../src/ownerManualEffectReconciliation.js";
import {
  createNyraSignedReceipt,
} from "../../shared/nyra-work-automation-receipts.js";

const H = (value) => String(value).repeat(64);
const OWNER = `osf_${H("a")}`;
const TENANT = "codexai";
const WORK = "work-owner-manual-effect";
const INTENT = H("1");

function ownerConfirmation(purpose, nonce, binding = H("2")) {
  return {
    verified: true,
    request_bound: true,
    owner_subject_fingerprint: OWNER,
    consent_nonce: nonce,
    confirmation_reference: `owner confirmation for ${purpose}`,
    purpose,
    request_binding_hash: binding,
  };
}

function signer() {
  const keys = crypto.generateKeyPairSync("ed25519");
  return createLocalGenericWorkCoreJoinSigner({
    privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }),
    keyId: "owner-manual-effect-test-key",
  });
}

function effectReference(effect = "github.merge", repository = "owner/repo") {
  return effect === "github.merge"
    ? { merge_commit: H("3").slice(0, 40), pull_request: 394, repository }
    : { branch: "owner-manual-effect", commit: H("4").slice(0, 40), repository };
}

function effectTuple({ adapterId, effectType, resourceId, reference }) {
  return {
    adapter_id: adapterId,
    effect_type: effectType,
    resource_id: resourceId,
    effect_reference_digest: genericWorkCoreJoinDigest(reference),
  };
}

function scopeForTuples(tuples) {
  return {
    adapter_ids: [...new Set(tuples.map((tuple) => tuple.adapter_id))].sort(),
    effect_types: [...new Set(tuples.map((tuple) => tuple.effect_type))].sort(),
    resource_ids: [...new Set(tuples.map((tuple) => tuple.resource_id))].sort(),
    effect_reference_digests: [...new Set(
      tuples.map((tuple) => tuple.effect_reference_digest),
    )].sort(),
  };
}

function manualScope({ adapterId = "github", effectType = "github.merge", resourceId = "github:owner/repo" } = {}) {
  return scopeForTuples([effectTuple({
    adapterId,
    effectType,
    resourceId,
    reference: effectReference(effectType),
  })]);
}

// Work Continuity V2, not a caller, constructs this exact binding.  The
// service keeps `trusted` and `verified_at` outside the signed semantic
// digest so a closure can require a fresh V2 read without changing Work.
function serverOwnedWorkBinding(subject, {
  mode = "OWNER_MANUAL",
  tuples = [effectTuple(subject.effect)],
  verifiedAt = subject.nowIso(),
  workUpdatedAt = subject.workUpdatedAt,
  currentVersion = 1,
  workStatus = "active",
  repository = "owner/repo",
} = {}) {
  const allowedEffectTuples = tuples
    .map((tuple) => ({
      adapter_id: tuple.adapter_id,
      effect_type: tuple.effect_type,
      resource_id: tuple.resource_id,
      effect_reference_digest: tuple.effect_reference_digest,
    }))
    .sort((left, right) => genericWorkCoreJoinDigest(left).localeCompare(
      genericWorkCoreJoinDigest(right),
    ));
  const unsigned = {
    schema_version: OWNER_MANUAL_EFFECT_WORK_BINDING_SCHEMA_VERSION,
    source: "mcp_work_continuity_v2",
    tenant_id: TENANT,
    work_id: WORK,
    intent_anchor_digest: INTENT,
    mode,
    work_status: workStatus,
    current_version: currentVersion,
    work_updated_at: workUpdatedAt,
    repository,
    provider_execution: false,
    allowed_effect_tuples: allowedEffectTuples,
  };
  return {
    ...unsigned,
    trusted: true,
    verified_at: verifiedAt,
    binding_digest: genericWorkCoreJoinDigest(unsigned),
  };
}

function harness({ adapterId = "github", effectType = "github.merge", resourceId = "github:owner/repo" } = {}) {
  let clock = Date.parse("2026-08-31T12:00:00.000Z");
  let adapterCalls = 0;
  let identifierSequence = 0;
  let adapterOverride = null;
  const testSigner = signer();
  const nowIso = () => new Date(clock).toISOString();
  const workUpdatedAt = nowIso();
  function verifiedObservation(request, {
    observedAt = nowIso(),
    verifiedAt = observedAt,
  } = {}) {
    return {
      schema_version: OWNER_MANUAL_EFFECT_ADAPTER_OBSERVATION_SCHEMA_VERSION,
      trusted: true,
      adapter_id: request.adapter_id,
      effect_type: request.effect_type,
      resource_id: request.resource_id,
      effect_reference_digest: request.effect_reference_digest,
      observed_at: observedAt,
      outcome: "VERIFIED_SUCCESS",
      evidence_digest: H("5"),
      post_verification: {
        schema_version: OWNER_MANUAL_EFFECT_POST_VERIFICATION_SCHEMA_VERSION,
        verified: true,
        verifier_id: "independent-core-readback",
        verified_at: verifiedAt,
        evidence_digest: H("5"),
        result_digest: H("6"),
      },
      provider_execution: false,
      external_side_effect: false,
    };
  }
  const adapter = {
    trusted: true,
    async reconcile(request) {
      adapterCalls += 1;
      if (adapterOverride) return adapterOverride(request, {
        clock,
        nowIso,
        verifiedObservation,
      });
      return verifiedObservation(request);
    },
  };
  const store = createInMemoryHostNativeGovernanceStore();
  const service = createOwnerManualEffectReconciliation({
    store,
    signer: testSigner,
    adapters: { [adapterId]: adapter },
    now: () => clock,
    idFactory: () => `test-manual-effect-${++identifierSequence}`,
  });
  return {
    service,
    store,
    effect: { adapterId, effectType, resourceId, reference: effectReference(effectType) },
    adapterCalls: () => adapterCalls,
    nowIso,
    workUpdatedAt,
    setAdapterOverride(value) { adapterOverride = value; },
    advance(milliseconds) { clock += milliseconds; },
  };
}

async function issue(subject, {
  mode = "OWNER_MANUAL",
  adapterId = subject.effect.adapterId,
  effectType = subject.effect.effectType,
  resourceId = subject.effect.resourceId,
  nonce = "oauth-envelope-1",
  ttlSeconds = 120,
  breakGlassReason = null,
  idempotencyKey = `issue-${nonce}`,
  scope,
  workBinding,
} = {}) {
  const defaultTuple = effectTuple({
    adapterId,
    effectType,
    resourceId,
    reference: effectReference(effectType),
  });
  return subject.service.issueEnvelope({
    tenant_id: TENANT,
    work_id: WORK,
    intent_anchor_digest: INTENT,
    mode,
    scope: scope || manualScope({ adapterId, effectType, resourceId }),
    effect_ceiling: [effectType],
    ttl_seconds: ttlSeconds,
    break_glass_reason_digest: breakGlassReason,
    work_binding: workBinding || serverOwnedWorkBinding(subject, {
      mode,
      tuples: [defaultTuple],
    }),
    owner_confirmation: ownerConfirmation(
      "host_native_owner_authority_envelope_issue",
      nonce,
    ),
    idempotency_key: idempotencyKey,
  });
}

async function reconcile(subject, envelope, {
  nonce = "oauth-reconcile-1",
  adapterId = subject.effect.adapterId,
  effectType = subject.effect.effectType,
  resourceId = subject.effect.resourceId,
  reference = subject.effect.reference,
  workBinding,
} = {}) {
  return subject.service.recordManualEffect({
    tenant_id: TENANT,
    work_id: WORK,
    intent_anchor_digest: INTENT,
    envelope_id: envelope.envelope.envelope_id,
    adapter_id: adapterId,
    effect_type: effectType,
    resource_id: resourceId,
    effect_reference: reference,
    work_binding: workBinding || serverOwnedWorkBinding(subject, {
      mode: envelope.envelope.mode,
      tuples: [effectTuple({
        adapterId,
        effectType,
        resourceId,
        reference,
      })],
    }),
    owner_confirmation: ownerConfirmation(
      "host_native_owner_manual_effect_reconcile",
      nonce,
    ),
    idempotency_key: `reconcile-${nonce}`,
  });
}

async function authorizeClosure(subject, reconciled, {
  nonce = "oauth-closure-1",
  workBinding,
  idempotencyKey = `authorize-closure-${nonce}`,
} = {}) {
  const reconciliation = reconciled.reconciliation;
  return subject.service.authorizeClosure({
    tenant_id: TENANT,
    reconciliation_id: reconciliation.reconciliation_id,
    work_binding: workBinding || serverOwnedWorkBinding(subject, {
      mode: reconciliation.mode,
      tuples: [effectTuple({
        adapterId: reconciliation.adapter_id,
        effectType: reconciliation.effect_type,
        resourceId: reconciliation.resource_id,
        reference: subject.effect.reference,
      })],
    }),
    owner_confirmation: ownerConfirmation(
      "host_native_owner_manual_effect_authorize_closure",
      nonce,
    ),
    idempotency_key: idempotencyKey,
  });
}

test("manual effect reconciliation is provider-neutral, independently verified, and ticket-free", async () => {
  const subject = harness();
  const envelope = await issue(subject);
  const read = subject.service.readEnvelope({
    tenant_id: TENANT,
    envelope_id: envelope.envelope.envelope_id,
    owner_confirmation: ownerConfirmation(
      "host_native_owner_authority_envelope_read",
      "oauth-read-1",
    ),
  });
  assert.equal(read.envelope.envelope_id, envelope.envelope.envelope_id);
  assert.throws(() => subject.service.readEnvelope({
    tenant_id: TENANT,
    envelope_id: envelope.envelope.envelope_id,
    owner_confirmation: {
      ...ownerConfirmation("host_native_owner_authority_envelope_read", "oauth-read-other"),
      owner_subject_fingerprint: `osf_${H("b")}`,
    },
  }), /owner_authority_envelope_owner_mismatch/);
  const reconciled = await reconcile(subject, envelope);
  assert.equal(subject.adapterCalls(), 1);
  assert.equal(reconciled.reconciliation.outcome, "VERIFIED_SUCCESS");
  assert.equal(reconciled.reconciliation.closure_state, "POST_VERIFICATION_REQUIRED");
  assert.equal(reconciled.reconciliation.ticket_issued, false);
  assert.equal(reconciled.reconciliation.retrospective_ticket_issued, false);
  assert.equal(reconciled.reconciliation.provider_execution, false);

  const closure = await authorizeClosure(subject, reconciled, {
    idempotencyKey: "authorize-closure-1",
  });
  assert.equal(closure.reconciliation.closure_state, "POST_VERIFICATION_REQUIRED");
  assert.equal(closure.closure_authorized, true);
  assert.equal(closure.authority_proof.proof_type, "owner_manual_effect_closure");
  assert.equal(closure.authority_proof.closure_authorized, true);
  assert.equal(closure.authority_proof.execution_authorized, false);
  assert.equal(closure.authority_proof.provider_execution, false);
  assert.equal(closure.authority_proof.ticket_issued, false);
  assert.equal(closure.authority_proof.retrospective_ticket_issued, false);
  assert.doesNotThrow(() => subject.service.verifyAuthorityProof(
    closure.authority_proof,
    {
      proof_type: "owner_manual_effect_closure",
      tenant_id: TENANT,
      work_id: WORK,
      reconciliation_id: reconciled.reconciliation.reconciliation_id,
      reconciliation_digest: reconciled.reconciliation.reconciliation_digest,
      closure_authorized: true,
    },
  ));
  const state = subject.store.readState();
  assert.equal(Object.keys(state.tickets).length, 0);
  assert.equal(Object.keys(state.owner_manual_effect_reconciliations).length, 1);
});

test("a verified manual effect instance is durably single-consumption across envelopes", async () => {
  const subject = harness();
  const firstEnvelope = await issue(subject, {
    nonce: "oauth-instance-first",
    idempotencyKey: "issue-instance-first",
  });
  const first = await reconcile(subject, firstEnvelope, {
    nonce: "oauth-instance-first-reconcile",
  });
  assert.equal(first.reconciliation.outcome, "VERIFIED_SUCCESS");

  const secondEnvelope = await issue(subject, {
    nonce: "oauth-instance-second",
    idempotencyKey: "issue-instance-second",
  });
  await assert.rejects(reconcile(subject, secondEnvelope, {
    nonce: "oauth-instance-second-reconcile",
  }), /owner_manual_effect_instance_already_claimed/);
  assert.equal(subject.adapterCalls(), 1);
  const claims = subject.store.readState().owner_manual_effect_instance_claims;
  assert.equal(Object.keys(claims).length, 1);
  assert.equal(Object.values(claims)[0].state, "consumed");
});

test("revocation, expiry, OAuth replay, and scope denial stop reconciliation before any adapter call", async () => {
  const revoked = harness();
  const envelope = await issue(revoked);
  await revoked.service.revokeEnvelope({
    tenant_id: TENANT,
    envelope_id: envelope.envelope.envelope_id,
    owner_confirmation: ownerConfirmation(
      "host_native_owner_authority_envelope_revoke",
      "oauth-revoke-1",
    ),
    idempotency_key: "revoke-1",
  });
  await assert.rejects(reconcile(revoked, envelope), /owner_authority_envelope_binding_invalid/);
  assert.equal(revoked.adapterCalls(), 0);

  const expired = harness();
  const expiringEnvelope = await issue(expired, { ttlSeconds: 60 });
  expired.advance(60_001);
  await assert.rejects(reconcile(expired, expiringEnvelope), /owner_authority_envelope_invalid/);
  assert.equal(expired.adapterCalls(), 0);

  const replay = harness();
  await issue(replay, { nonce: "oauth-replayed" });
  await assert.rejects(issue(replay, {
    nonce: "oauth-replayed",
    ttlSeconds: 180,
    idempotencyKey: "issue-replayed-with-new-idempotency-key",
  }), /owner_authority_confirmation_replayed/);
  assert.equal(replay.adapterCalls(), 0);

  const scoped = harness();
  const scopedEnvelope = await issue(scoped);
  await assert.rejects(scoped.service.recordManualEffect({
    tenant_id: TENANT,
    work_id: WORK,
    intent_anchor_digest: INTENT,
    envelope_id: scopedEnvelope.envelope.envelope_id,
    adapter_id: "github",
    effect_type: "github.merge",
    resource_id: "github:owner/other-repo",
    effect_reference: scoped.effect.reference,
    work_binding: serverOwnedWorkBinding(scoped),
    owner_confirmation: ownerConfirmation(
      "host_native_owner_manual_effect_reconcile",
      "oauth-scope-denied",
    ),
    idempotency_key: "scope-denied",
  }), /owner_authority_scope_or_ceiling_denied/);
  assert.equal(scoped.adapterCalls(), 0);
});

test("Owner Break-Glass is restricted to Nyra/Core self-repair and never grants provider execution", async () => {
  const subject = harness({
    adapterId: "nyra_core",
    effectType: "nyra_core.self_repair.commit",
    resourceId: "nyra_core:core",
  });
  await assert.rejects(issue(subject, {
    mode: "OWNER_BREAK_GLASS",
    adapterId: "nyra_core",
    effectType: "github.merge",
    resourceId: "nyra_core:core",
    breakGlassReason: H("7"),
  }), /owner_break_glass_scope_invalid/);

  const exactTuple = effectTuple(subject.effect);
  const secondReferenceTuple = {
    ...exactTuple,
    effect_reference_digest: H("8"),
  };
  await assert.rejects(issue(subject, {
    mode: "OWNER_BREAK_GLASS",
    breakGlassReason: H("7"),
    scope: scopeForTuples([exactTuple, secondReferenceTuple]),
    workBinding: serverOwnedWorkBinding(subject, {
      mode: "OWNER_BREAK_GLASS",
      tuples: [exactTuple, secondReferenceTuple],
    }),
  }), /owner_break_glass_scope_invalid/);

  const envelope = await issue(subject, {
    mode: "OWNER_BREAK_GLASS",
    breakGlassReason: H("7"),
  });
  assert.equal(envelope.envelope.mode, "OWNER_BREAK_GLASS");
  assert.equal(envelope.envelope.execution_authorized, false);
  const reconciled = await reconcile(subject, envelope);
  assert.equal(reconciled.reconciliation.effect_type, "nyra_core.self_repair.commit");
  assert.equal(reconciled.reconciliation.action_authorized, false);
  assert.equal(reconciled.reconciliation.execution_authorized, false);
  assert.equal(reconciled.reconciliation.provider_execution, false);
});

test("a signed Nyra repair receipt from before the break-glass envelope is reconciled by fresh readback", async () => {
  const signingSecret = "n".repeat(64);
  const repairObservedAt = "2026-08-31T11:59:00.000Z";
  let clock = Date.parse("2026-08-31T12:00:00.000Z");
  const nowIso = () => new Date(clock).toISOString();
  const effect = {
    adapterId: "nyra_core",
    effectType: "nyra_core.self_repair.commit",
    resourceId: "nyra_core:owner/repo:main:services/nyra-core",
  };
  const referenceBase = {
    repository: "owner/repo",
    branch: "main",
    path: "services/nyra-core",
    commit: H("9").slice(0, 40),
    repair_action_id: "nra_core-repair-001",
    repair_receipt_id: "nrr_core-repair-001",
  };
  const repairActionDigest = nyraCoreRepairActionDigest({
    tenant_id: TENANT,
    work_id: WORK,
    intent_anchor_digest: INTENT,
    mode: "OWNER_BREAK_GLASS",
    adapter_id: effect.adapterId,
    effect_type: effect.effectType,
    resource_id: effect.resourceId,
    ...referenceBase,
  });
  const repairReceipt = createNyraSignedReceipt({
    schema_version: "nyra_core_repair_receipt_v1",
    tenant_id: TENANT,
    work_id: WORK,
    intent_anchor_digest: INTENT,
    mode: "OWNER_BREAK_GLASS",
    adapter_id: effect.adapterId,
    effect_type: effect.effectType,
    resource_id: effect.resourceId,
    ...referenceBase,
    repair_action_digest: repairActionDigest,
    read_only: true,
    provider_execution: false,
    external_side_effect: false,
    evidence_digest: H("e"),
    observed_at: repairObservedAt,
  }, {
    secret: signingSecret,
    now: () => Date.parse(repairObservedAt),
  });
  const reference = {
    ...referenceBase,
    repair_action_digest: repairActionDigest,
    repair_receipt_digest: repairReceipt.receipt_digest,
  };
  const effectReferenceDigest = genericWorkCoreJoinDigest(reference);
  const readback = {
    schema_version: "nyra_core_manual_effect_readback_v3",
    trusted: true,
    verified: true,
    read_only: true,
    transport: "GET",
    provider_execution: false,
    external_side_effect: false,
    adapter_id: effect.adapterId,
    effect_type: effect.effectType,
    resource_id: effect.resourceId,
    effect_reference_digest: effectReferenceDigest,
    tenant_id: TENANT,
    work_id: WORK,
    intent_anchor_digest: INTENT,
    mode: "OWNER_BREAK_GLASS",
    repair_receipt: repairReceipt,
  };
  let readbackCalls = 0;
  const adapter = createHostNativeNyraCoreManualEffectAdapter({
    nyraCoreReadbackOrigin: "https://nyra-core.example.test",
    nyraCoreRepairReceiptSigningSecret: signingSecret,
    now: () => clock,
    fetchImpl: async (url, init) => {
      const endpoint = new URL(url);
      assert.equal(endpoint.origin, "https://nyra-core.example.test");
      assert.equal(endpoint.pathname, "/v1/host-native/manual-effect-readback");
      assert.equal(init.method, "GET");
      assert.equal(endpoint.searchParams.get("effect_reference_digest"), effectReferenceDigest);
      readbackCalls += 1;
      return new Response(JSON.stringify(readback), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(adapter?.trusted, true);
  const store = createInMemoryHostNativeGovernanceStore();
  const service = createOwnerManualEffectReconciliation({
    store,
    signer: signer(),
    adapters: { nyra_core: adapter },
    now: () => clock,
    idFactory: () => "nyra-prior-receipt-test",
  });
  const subject = {
    service,
    effect: { ...effect, reference },
    nowIso,
    workUpdatedAt: nowIso(),
  };
  const tuple = effectTuple(subject.effect);
  const envelope = await issue(subject, {
    mode: "OWNER_BREAK_GLASS",
    adapterId: effect.adapterId,
    effectType: effect.effectType,
    resourceId: effect.resourceId,
    breakGlassReason: H("7"),
    nonce: "oauth-nyra-prior-receipt-envelope",
    scope: scopeForTuples([tuple]),
    workBinding: serverOwnedWorkBinding(subject, {
      mode: "OWNER_BREAK_GLASS",
      tuples: [tuple],
    }),
  });
  assert(Date.parse(repairObservedAt) < Date.parse(envelope.envelope.issued_at));

  const reconciled = await reconcile(subject, envelope, {
    nonce: "oauth-nyra-prior-receipt-reconcile",
    adapterId: effect.adapterId,
    effectType: effect.effectType,
    resourceId: effect.resourceId,
    reference,
    workBinding: serverOwnedWorkBinding(subject, {
      mode: "OWNER_BREAK_GLASS",
      tuples: [tuple],
    }),
  });
  assert.equal(readbackCalls, 1);
  assert.equal(reconciled.reconciliation.outcome, "VERIFIED_SUCCESS");
  assert.equal(reconciled.reconciliation.observed_at, nowIso());
  assert(Date.parse(reconciled.reconciliation.observed_at) >=
    Date.parse(envelope.envelope.issued_at));
  assert.equal(reconciled.reconciliation.evidence_digest, genericWorkCoreJoinDigest({
    schema_version: "nyra_core_manual_effect_readback_v3",
    tenant_id: TENANT,
    work_id: WORK,
    intent_anchor_digest: INTENT,
    mode: "OWNER_BREAK_GLASS",
    ...readback,
  }));
  assert.equal(readback.repair_receipt.observed_at, repairObservedAt);
});

test("server-owned Work tuples reject a scope cross-product before the adapter runs", async () => {
  const subject = harness();
  const canonicalTuple = effectTuple(subject.effect);
  const otherReference = effectReference("github.merge", "owner/other-repo");
  const otherTuple = effectTuple({
    adapterId: "github",
    effectType: "github.merge",
    resourceId: "github:owner/other-repo",
    reference: otherReference,
  });
  const binding = serverOwnedWorkBinding(subject, {
    tuples: [canonicalTuple, otherTuple],
  });
  const envelope = await issue(subject, {
    scope: scopeForTuples([canonicalTuple, otherTuple]),
    workBinding: binding,
  });

  // The broad envelope scope contains both resources and both reference
  // digests, but the exact V2 tuple list never permits this cross-pairing.
  await assert.rejects(reconcile(subject, envelope, {
    nonce: "oauth-cross-product",
    resourceId: "github:owner/other-repo",
    reference: subject.effect.reference,
    workBinding: binding,
  }), /owner_manual_effect_work_scope_denied/);
  assert.equal(subject.adapterCalls(), 0);
});

test("closure needs a fresh, matching server-owned Work binding", async () => {
  const subject = harness();
  const envelope = await issue(subject);
  const reconciled = await reconcile(subject, envelope);
  subject.advance(1_000);

  await assert.rejects(subject.service.authorizeClosure({
    tenant_id: TENANT,
    reconciliation_id: reconciled.reconciliation.reconciliation_id,
    owner_confirmation: ownerConfirmation(
      "host_native_owner_manual_effect_authorize_closure",
      "oauth-closure-without-binding",
    ),
    idempotency_key: "authorize-closure-without-binding",
  }), /owner_manual_effect_closure_request_invalid/);

  const staleAt = new Date(Date.parse(subject.nowIso()) - 5 * 60_000 - 1).toISOString();
  await assert.rejects(authorizeClosure(subject, reconciled, {
    nonce: "oauth-closure-stale-binding",
    workBinding: serverOwnedWorkBinding(subject, {
      verifiedAt: staleAt,
      workUpdatedAt: staleAt,
    }),
  }), /owner_manual_effect_work_scope_invalid/);

  await assert.rejects(authorizeClosure(subject, reconciled, {
    nonce: "oauth-closure-work-drift",
    workBinding: serverOwnedWorkBinding(subject, { currentVersion: 2 }),
  }), /owner_manual_effect_closure_binding_invalid/);

  const closure = await authorizeClosure(subject, reconciled, {
    nonce: "oauth-closure-fresh-binding",
  });
  assert.equal(closure.closure_authorized, true);
  assert.equal(closure.authority_proof.work_binding_digest, envelope.envelope.work_binding_digest);
});

test("closure refuses stale independently verified manual evidence", async () => {
  const subject = harness();
  // Keep the envelope live beyond the mandatory five-minute evidence window
  // so this assertion exercises post-verification freshness rather than TTL.
  const envelope = await issue(subject, { ttlSeconds: 600 });
  const reconciled = await reconcile(subject, envelope);
  subject.advance(5 * 60_000 + 1);

  await assert.rejects(authorizeClosure(subject, reconciled, {
    nonce: "oauth-closure-stale-post-verification",
  }), /owner_manual_effect_closure_post_verification_stale/);
  const stored = subject.store.readState().owner_manual_effect_reconciliations[
    reconciled.reconciliation.reconciliation_id
  ];
  assert.equal(stored.closure_state, "POST_VERIFICATION_REQUIRED");
  assert.equal(stored.closure_authority_proof, undefined);
});

test("reconciliation makes revocation terminal before a closure proof can race", async () => {
  const subject = harness();
  const envelope = await issue(subject);
  const reconciled = await reconcile(subject, envelope);

  await assert.rejects(subject.service.revokeEnvelope({
    tenant_id: TENANT,
    envelope_id: envelope.envelope.envelope_id,
    owner_confirmation: ownerConfirmation(
      "host_native_owner_authority_envelope_revoke",
      "oauth-revoke-after-reconcile",
    ),
    idempotency_key: "revoke-after-reconcile",
  }), /owner_authority_envelope_revocation_closed/);

  const closure = await authorizeClosure(subject, reconciled, {
    nonce: "oauth-closure-after-revoke-rejected",
  });
  assert.equal(closure.closure_authorized, true);
});

test("malformed or stale adapter evidence clears the pending reconciliation state", async () => {
  const subject = harness();
  const envelope = await issue(subject);
  const envelopeId = envelope.envelope.envelope_id;

  subject.setAdapterOverride(() => ({}));
  await assert.rejects(reconcile(subject, envelope, {
    nonce: "oauth-malformed-observation",
  }), /owner_manual_effect_adapter_observation_invalid/);
  assert.equal(
    subject.store.readState().owner_authority_envelopes[envelopeId].reconciliation_pending,
    undefined,
  );

  subject.setAdapterOverride((request, { clock, verifiedObservation }) => {
    const staleAt = new Date(clock - 5 * 60_000 - 1).toISOString();
    return verifiedObservation(request, { observedAt: staleAt, verifiedAt: staleAt });
  });
  await assert.rejects(reconcile(subject, envelope, {
    nonce: "oauth-stale-observation",
  }), /owner_manual_effect_adapter_observation_invalid/);
  assert.equal(
    subject.store.readState().owner_authority_envelopes[envelopeId].reconciliation_pending,
    undefined,
  );

  subject.setAdapterOverride(null);
  const recovered = await reconcile(subject, envelope, {
    nonce: "oauth-observation-recovery",
  });
  assert.equal(recovered.reconciliation.outcome, "VERIFIED_SUCCESS");
  assert.equal(subject.adapterCalls(), 3);
});

test("a revocation that wins during adapter readback clears pending state", async () => {
  const subject = harness();
  const envelope = await issue(subject);
  const envelopeId = envelope.envelope.envelope_id;
  let finishReadback;
  subject.setAdapterOverride((request, { verifiedObservation }) => new Promise((resolve) => {
    finishReadback = () => resolve(verifiedObservation(request));
  }));

  const pending = reconcile(subject, envelope, { nonce: "oauth-reconcile-race" });
  assert.equal(
    subject.store.readState().owner_authority_envelopes[envelopeId].reconciliation_pending
      ?.idempotency_key,
    "reconcile-oauth-reconcile-race",
  );
  await subject.service.revokeEnvelope({
    tenant_id: TENANT,
    envelope_id: envelopeId,
    owner_confirmation: ownerConfirmation(
      "host_native_owner_authority_envelope_revoke",
      "oauth-revoke-race",
    ),
    idempotency_key: "revoke-race",
  });
  finishReadback();
  await assert.rejects(pending, /owner_manual_effect_reconciliation_state_changed/);
  assert.equal(
    subject.store.readState().owner_authority_envelopes[envelopeId].reconciliation_pending,
    undefined,
  );
});
