import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createGenericWorkCoreJoinAuthority,
  createGenericWorkCoreJoinVerdictVerifier,
  createLocalGenericWorkCoreJoinSigner,
  genericWorkCoreJoinDigest,
} from "../../universal-core-service/src/genericWorkCoreJoin.js";
import { createMemoryGenericWorkCoreJoinStore } from "../../universal-core-service/src/genericWorkCoreJoinStore.js";
import {
  GENERIC_WORK_CORE_JOIN_TRUST_REGISTRY_SCHEMA_VERSION,
  parseGenericWorkCoreJoinTrustRegistry,
} from "../src/config.js";
import { verifyGenericCoreJoinVerdict } from "../src/work-continuity-v2-store.js";

const NOW = Date.parse("2026-08-09T10:00:00.000Z");
const TENANT = "tenant-alpha";
const OTHER_TENANT = "tenant-beta";
const ADAPTER = "research";
const WORK = "work-alpha";

function pem(publicKey) {
  return publicKey.export({ type: "spki", format: "pem" });
}

function privatePem(privateKey) {
  return privateKey.export({ type: "pkcs8", format: "pem" });
}

function request({ workId = WORK, idempotencyDigest = "a".repeat(64) } = {}) {
  const acceptance_criteria = [{
    criterion_id: "criterion-001",
    criterion_digest: "1".repeat(64),
    evidence_digest: "2".repeat(64),
    verification_digest: "3".repeat(64),
  }];
  const task_state = [{
    task_id: "task-001",
    completion_evidence_digest: "4".repeat(64),
    task_state_digest: "5".repeat(64),
    verification_digest: "6".repeat(64),
  }];
  const evidence_digests = ["7".repeat(64)];
  return {
    tenant_id: TENANT,
    work_id: workId,
    adapter: ADAPTER,
    requester_identity: "builder-agent",
    requester_session_id: "builder-session",
    idempotency_digest: idempotencyDigest,
    acceptance_criteria,
    task_state,
    evidence_digests,
    independent_verifier_receipt: {
      schema_version: "generic_work_independent_verifier_receipt_v1",
      tenant_id: TENANT,
      work_id: workId,
      adapter: ADAPTER,
      acceptance_criteria_digest: genericWorkCoreJoinDigest(acceptance_criteria),
      task_state_digest: genericWorkCoreJoinDigest(task_state),
      evidence_digest: genericWorkCoreJoinDigest([...evidence_digests].sort()),
      verification_digest: "8".repeat(64),
      verifier_identity: "independent-verifier",
      session_id: "verifier-session",
      nonce: `nonce-${workId}`,
      issued_at: new Date(NOW - 1_000).toISOString(),
      expires_at: new Date(NOW + 60_000).toISOString(),
      signature: "independent-verifier-signature",
    },
  };
}

function authority(signer, store) {
  return createGenericWorkCoreJoinAuthority({
    signer,
    store,
    now: () => NOW,
    verifyIndependentVerifierReceipt: () => true,
  });
}

test("active signing and retired replay resolve by verdict key id while unknown and revoked keys fail closed", async () => {
  const activePair = crypto.generateKeyPairSync("ed25519");
  const retiredPair = crypto.generateKeyPairSync("ed25519");
  const revokedPair = crypto.generateKeyPairSync("ed25519");
  const unknownPair = crypto.generateKeyPairSync("ed25519");
  const activeLocal = createLocalGenericWorkCoreJoinSigner({ privateKey: privatePem(activePair.privateKey), keyId: "core-active-v2" });
  const retiredLocal = createLocalGenericWorkCoreJoinSigner({ privateKey: privatePem(retiredPair.privateKey), keyId: "core-retired-v1" });
  const revokedLocal = createLocalGenericWorkCoreJoinSigner({ privateKey: privatePem(revokedPair.privateKey), keyId: "core-revoked-v0" });
  const unknownLocal = createLocalGenericWorkCoreJoinSigner({ privateKey: privatePem(unknownPair.privateKey), keyId: "core-unknown-v9" });
  const store = createMemoryGenericWorkCoreJoinStore();
  const retiredRequest = request();
  const retiredVerdict = await authority(retiredLocal, store).issue(retiredRequest);
  const registrySigner = {
    ...activeLocal,
    trust_registry_revision: "generic-join-keys-20260809-v2",
    resolvePublicKey(keyId) {
      if (keyId === activeLocal.key_id) return activePair.publicKey;
      if (keyId === retiredLocal.key_id) return retiredPair.publicKey;
      return null;
    },
  };
  const currentAuthority = authority(registrySigner, store);
  const replay = await currentAuthority.issue(retiredRequest);
  assert.deepEqual(replay, retiredVerdict);
  assert.equal(replay.key_id, "core-retired-v1");
  assert.equal(store.events().length, 1);
  const applicationVerifier = createGenericWorkCoreJoinVerdictVerifier({
    publicKey: registrySigner.public_key,
    keyId: registrySigner.key_id,
  });
  assert.equal(applicationVerifier.verify({
    verdict: replay,
    expected: {
      tenant_id: TENANT,
      work_id: WORK,
      adapter: ADAPTER,
      idempotency_digest: retiredRequest.idempotency_digest,
    },
  }), true);

  const activeVerdict = await currentAuthority.issue(request({
    workId: "work-active",
    idempotencyDigest: "b".repeat(64),
  }));
  assert.equal(activeVerdict.key_id, "core-active-v2");
  assert.equal(currentAuthority.signer_metadata.trust_registry_revision, "generic-join-keys-20260809-v2");

  const revokedVerdict = await authority(revokedLocal, createMemoryGenericWorkCoreJoinStore()).issue(request({
    workId: "work-revoked",
    idempotencyDigest: "c".repeat(64),
  }));
  const unknownVerdict = await authority(unknownLocal, createMemoryGenericWorkCoreJoinStore()).issue(request({
    workId: "work-unknown",
    idempotencyDigest: "d".repeat(64),
  }));
  const verifier = {
    trustRegistry: {
      schema_version: GENERIC_WORK_CORE_JOIN_TRUST_REGISTRY_SCHEMA_VERSION,
      revision: "generic-join-keys-20260809-v2",
      keys: {
        "core-active-v2": { status: "active", public_key: pem(activePair.publicKey) },
        "core-retired-v1": { status: "retired", public_key: pem(retiredPair.publicKey) },
        "core-revoked-v0": { status: "revoked", public_key: pem(revokedPair.publicKey) },
      },
    },
  };
  assert.equal(verifyGenericCoreJoinVerdict(activeVerdict, verifier), true);
  assert.equal(verifyGenericCoreJoinVerdict(activeVerdict, verifier), true, "verification replay remains idempotent");
  assert.equal(verifyGenericCoreJoinVerdict(retiredVerdict, verifier), true);
  assert.equal(verifyGenericCoreJoinVerdict(revokedVerdict, verifier), false);
  assert.equal(verifyGenericCoreJoinVerdict(unknownVerdict, verifier), false);
  assert.equal(verifyGenericCoreJoinVerdict({ ...activeVerdict, tenant_id: OTHER_TENANT }, verifier), false);

  const revokedReplayAuthority = authority({
    ...activeLocal,
    resolvePublicKey: (keyId) => keyId === activeLocal.key_id ? activePair.publicKey : null,
  }, store);
  await assert.rejects(() => revokedReplayAuthority.issue(retiredRequest), /generic_work_core_join_key_untrusted/);
});

test("legacy single-key verifier remains backward compatible", async () => {
  const pair = crypto.generateKeyPairSync("ed25519");
  const keyId = "legacy-core-key-v1";
  const verdict = await authority(
    createLocalGenericWorkCoreJoinSigner({ privateKey: privatePem(pair.privateKey), keyId }),
    createMemoryGenericWorkCoreJoinStore(),
  ).issue(request({ workId: "work-legacy", idempotencyDigest: "e".repeat(64) }));
  assert.equal(verifyGenericCoreJoinVerdict(verdict, { publicKey: pem(pair.publicKey), keyId }), true);
});

test("canonical trust registry rejects mixed legacy, multiple active keys and missing revision", () => {
  const pairA = crypto.generateKeyPairSync("ed25519");
  const pairB = crypto.generateKeyPairSync("ed25519");
  const base = {
    schema_version: GENERIC_WORK_CORE_JOIN_TRUST_REGISTRY_SCHEMA_VERSION,
    revision: "registry-20260809-v1",
    keys: {
      "core-active-a": { status: "active", public_key: pem(pairA.publicKey) },
      "core-retired-b": { status: "retired", public_key: pem(pairB.publicKey) },
    },
  };
  assert.equal(parseGenericWorkCoreJoinTrustRegistry(base).revision, base.revision);
  assert.throws(() => parseGenericWorkCoreJoinTrustRegistry(base, {
    legacyPublicKey: pem(pairA.publicKey),
    legacyKeyId: "legacy-key-a",
  }), /mixed_legacy_ambiguous/);
  assert.throws(() => parseGenericWorkCoreJoinTrustRegistry({
    ...base,
    keys: {
      ...base.keys,
      "core-active-b": { status: "active", public_key: pem(pairB.publicKey) },
    },
  }), /multiple_active_keys/);
  const { revision: _revision, ...withoutRevision } = base;
  assert.throws(() => parseGenericWorkCoreJoinTrustRegistry(withoutRevision), /trust_registry_invalid|revision_required/);
});
