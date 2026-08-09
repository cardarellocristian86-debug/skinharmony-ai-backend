import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createGenericWorkCoreJoinAuthority, createGenericWorkCoreJoinVerdictVerifier, genericWorkCoreJoinDigest, verifyGenericWorkCoreJoinVerdict } from "../src/genericWorkCoreJoin.js";
import { createMemoryGenericWorkCoreJoinStore } from "../src/genericWorkCoreJoinStore.js";

const NOW = Date.parse("2026-08-08T10:00:00.000Z");
const d = (value) => genericWorkCoreJoinDigest({ value });
const KEYS = crypto.generateKeyPairSync("ed25519");
const PRIVATE_KEY = KEYS.privateKey.export({ type: "pkcs8", format: "pem" });
const PUBLIC_KEY = KEYS.publicKey.export({ type: "spki", format: "pem" });
const KEY_ID = "generic-work-core-join-test-key";
function fixture({ store = createMemoryGenericWorkCoreJoinStore(), verifier = () => true } = {}) {
  const authority = createGenericWorkCoreJoinAuthority({ signingPrivateKey: PRIVATE_KEY, signingKeyId: KEY_ID, now: () => NOW, verifyIndependentVerifierReceipt: verifier, store });
  const acceptance_criteria = [{ criterion_id: "criterion-001", criterion_digest: d("criterion"), evidence_digest: d("criterion-evidence"), verification_digest: d("criterion-verification") }];
  const task_state = [{ task_id: "task-001", completion_evidence_digest: d("task-evidence"), task_state_digest: d("done"), verification_digest: d("task-verification") }];
  const evidence_digests = [d("evidence-001")];
  const independent_verifier_receipt = { schema_version: "generic_work_independent_verifier_receipt_v1", tenant_id: "tenant-001", work_id: "work-001", adapter: "research", acceptance_criteria_digest: genericWorkCoreJoinDigest(acceptance_criteria), task_state_digest: genericWorkCoreJoinDigest(task_state), evidence_digest: genericWorkCoreJoinDigest([...evidence_digests].sort()), verification_digest: d("verification"), verifier_identity: "verifier-001", session_id: "verifier-session-001", nonce: "nonce-001", issued_at: "2026-08-08T09:59:00.000Z", expires_at: "2026-08-08T10:05:00.000Z", signature: "independent-signed-receipt" };
  return { authority, store, input: { tenant_id: "tenant-001", work_id: "work-001", adapter: "research", requester_identity: "builder-001", requester_session_id: "builder-session-001", idempotency_digest: d("idem-001"), acceptance_criteria, task_state, evidence_digests, independent_verifier_receipt } };
}

test("durably records an immutable non-host-authorizing verdict and exact replay", async () => {
  const { authority, input, store } = fixture();
  const first = await authority.issue(input); const replay = await authority.issue(structuredClone(input));
  assert.deepEqual(replay, first); assert.equal(first.host_action_authorized, false); assert.equal(first.execution_authorized, false);
  assert.equal(first.signature_algorithm, "ed25519");
  assert.equal(store.events().length, 1);
  assert.equal(verifyGenericWorkCoreJoinVerdict({ verdict: first, expected: { tenant_id: input.tenant_id, work_id: input.work_id, adapter: input.adapter, idempotency_digest: input.idempotency_digest }, publicKey: PUBLIC_KEY, expectedKeyId: KEY_ID }), true);
  assert.equal(createGenericWorkCoreJoinVerdictVerifier({ publicKey: PUBLIC_KEY, keyId: KEY_ID }).verify({ verdict: first, expected: { tenant_id: input.tenant_id, work_id: input.work_id, adapter: input.adapter, idempotency_digest: input.idempotency_digest } }), true);
});

test("denies conflicting idempotency reuse, nonce replay, cross-tenant context, forged signature and forged context", async () => {
  const { authority, input } = fixture(); const verdict = await authority.issue(input);
  const conflict = structuredClone(input); conflict.evidence_digests = [d("other-evidence")];
  assert.rejects(authority.issue(conflict), /generic_work_core_join_idempotency_conflict/);
  const nonceReplay = structuredClone(input); nonceReplay.idempotency_digest = d("idem-002"); nonceReplay.independent_verifier_receipt.nonce = input.independent_verifier_receipt.nonce;
  assert.rejects(authority.issue(nonceReplay), /generic_work_core_join_nonce_replayed/);
  assert.throws(() => verifyGenericWorkCoreJoinVerdict({ verdict, expected: { tenant_id: "tenant-999", work_id: input.work_id, adapter: input.adapter, idempotency_digest: input.idempotency_digest }, publicKey: PUBLIC_KEY, expectedKeyId: KEY_ID }), /generic_work_core_join_tenant_id_mismatch/);
  const forged = structuredClone(verdict); forged.signature = "forged";
  assert.throws(() => verifyGenericWorkCoreJoinVerdict({ verdict: forged, expected: { tenant_id: input.tenant_id, work_id: input.work_id, adapter: input.adapter, idempotency_digest: input.idempotency_digest }, publicKey: PUBLIC_KEY, expectedKeyId: KEY_ID }), /generic_work_core_join_signature_invalid/);
  const forgedContext = structuredClone(verdict); forgedContext.work_id = "work-999";
  assert.throws(() => verifyGenericWorkCoreJoinVerdict({ verdict: forgedContext, expected: { tenant_id: input.tenant_id, work_id: input.work_id, adapter: input.adapter, idempotency_digest: input.idempotency_digest }, publicKey: PUBLIC_KEY, expectedKeyId: KEY_ID }), /generic_work_core_join_verdict_digest_invalid/);
});

test("fails closed for an untrusted verifier and does not accept agent success booleans", async () => {
  const { authority, input } = fixture({ verifier: () => false });
  await assert.rejects(authority.issue(input), /independent_verifier_receipt_untrusted/);
  const valid = fixture(); valid.input.task_state[0].success = true;
  await assert.rejects(valid.authority.issue(valid.input), /task_state_invalid/);
});
