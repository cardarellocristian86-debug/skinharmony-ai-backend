import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createGenericWorkCoreJoinAuthority, createGenericWorkCoreJoinVerdictVerifier, genericWorkCoreJoinDigest, genericWorkCoreJoinSignaturePayload, verifyGenericWorkCoreJoinVerdict } from "../src/genericWorkCoreJoin.js";
import { createMemoryGenericWorkCoreJoinStore } from "../src/genericWorkCoreJoinStore.js";

const NOW = Date.parse("2026-08-08T10:00:00.000Z");
const d = (value) => genericWorkCoreJoinDigest({ value });
const KEYS = crypto.generateKeyPairSync("ed25519");
const PRIVATE_KEY = KEYS.privateKey.export({ type: "pkcs8", format: "pem" });
const PUBLIC_KEY = KEYS.publicKey.export({ type: "spki", format: "pem" });
const KEY_ID = "generic-work-core-join-test-key";
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function nonCanonicalBase64Url(value) {
  const finalIndex = BASE64URL_ALPHABET.indexOf(value.at(-1));
  assert.notEqual(finalIndex, -1);
  const replacement = BASE64URL_ALPHABET[(finalIndex & 0b110000) | ((finalIndex + 1) & 0b001111)];
  const altered = `${value.slice(0, -1)}${replacement}`;
  assert.notEqual(altered, value);
  assert.deepEqual(Buffer.from(altered, "base64url"), Buffer.from(value, "base64url"));
  return altered;
}
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
  const nonCanonical = structuredClone(verdict); nonCanonical.signature = nonCanonicalBase64Url(verdict.signature);
  assert.throws(() => verifyGenericWorkCoreJoinVerdict({ verdict: nonCanonical, expected: { tenant_id: input.tenant_id, work_id: input.work_id, adapter: input.adapter, idempotency_digest: input.idempotency_digest }, publicKey: PUBLIC_KEY, expectedKeyId: KEY_ID }), /generic_work_core_join_signature_invalid/);
  const forgedContext = structuredClone(verdict); forgedContext.work_id = "work-999";
  assert.throws(() => verifyGenericWorkCoreJoinVerdict({ verdict: forgedContext, expected: { tenant_id: input.tenant_id, work_id: input.work_id, adapter: input.adapter, idempotency_digest: input.idempotency_digest }, publicKey: PUBLIC_KEY, expectedKeyId: KEY_ID }), /generic_work_core_join_verdict_digest_invalid/);
});

test("fails closed for an untrusted verifier and does not accept agent success booleans", async () => {
  const { authority, input } = fixture({ verifier: () => false });
  await assert.rejects(authority.issue(input), /independent_verifier_receipt_untrusted/);
  const valid = fixture(); valid.input.task_state[0].success = true;
  await assert.rejects(valid.authority.issue(valid.input), /task_state_invalid/);
});

test("awaits an asynchronous signer and verifies its Ed25519 result before persistence", async () => {
  const baseline = fixture();
  const store = createMemoryGenericWorkCoreJoinStore();
  let releaseSignature;
  let requestedDigest = null;
  const signer = {
    algorithm: "Ed25519",
    key_id: KEY_ID,
    public_key: PUBLIC_KEY,
    custody: "external_remote_signer",
    async signDigest(verdictDigest) {
      requestedDigest = verdictDigest;
      return new Promise((resolve) => {
        releaseSignature = () => resolve(crypto.sign(null, genericWorkCoreJoinSignaturePayload(verdictDigest), KEYS.privateKey).toString("base64url"));
      });
    },
  };
  const authority = createGenericWorkCoreJoinAuthority({ signer, now: () => NOW, verifyIndependentVerifierReceipt: () => true, store });
  const pending = authority.issue(baseline.input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(requestedDigest, /^[a-f0-9]{64}$/);
  assert.equal(store.events().length, 0);
  releaseSignature();
  const verdict = await pending;
  assert.equal(store.events().length, 1);
  assert.equal(verdict.execution_authorized, false);
  assert.equal(verdict.host_action_authorized, false);
});

test("expiry during asynchronous signing leaves no durable Generic verdict", async () => {
  const baseline = fixture();
  const store = createMemoryGenericWorkCoreJoinStore();
  const signer = {
    algorithm: "Ed25519", key_id: KEY_ID, public_key: PUBLIC_KEY, custody: "external_remote_signer",
    async signDigest(verdictDigest) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return crypto.sign(null, genericWorkCoreJoinSignaturePayload(verdictDigest), KEYS.privateKey).toString("base64url");
    },
  };
  const authority = createGenericWorkCoreJoinAuthority({ signer, now: Date.now, verifyIndependentVerifierReceipt: () => true, store });
  const input = structuredClone(baseline.input);
  const closureDigest = d("software-closure");
  input.evidence_digests = [...input.evidence_digests, closureDigest];
  input.independent_verifier_receipt.evidence_digest = genericWorkCoreJoinDigest([...input.evidence_digests].sort());
  input.independent_verifier_receipt.issued_at = new Date(Date.now() - 1_000).toISOString();
  input.independent_verifier_receipt.expires_at = new Date(Date.now() + 60_000).toISOString();
  await assert.rejects(() => authority.issueDetailed(input, { softwareClosure: {
    digest: closureDigest, fresh_until: new Date(Date.now() + 10).toISOString(),
  } }), /software_cognition_closure_expired_during_issuance/);
  assert.equal(store.events().length, 0);
});

test("never persists an invalid or unavailable asynchronous signer result", async () => {
  const baseline = fixture();
  const wrongKeys = crypto.generateKeyPairSync("ed25519");
  for (const signDigest of [
    async (verdictDigest) => crypto.sign(null, genericWorkCoreJoinSignaturePayload(verdictDigest), wrongKeys.privateKey).toString("base64url"),
    async (verdictDigest) => nonCanonicalBase64Url(crypto.sign(null, genericWorkCoreJoinSignaturePayload(verdictDigest), KEYS.privateKey).toString("base64url")),
    async () => { throw new Error("upstream token must not escape"); },
  ]) {
    const store = createMemoryGenericWorkCoreJoinStore();
    const authority = createGenericWorkCoreJoinAuthority({
      signer: { algorithm: "Ed25519", key_id: KEY_ID, public_key: PUBLIC_KEY, custody: "external_remote_signer", signDigest },
      now: () => NOW,
      verifyIndependentVerifierReceipt: () => true,
      store,
    });
    await assert.rejects(authority.issue(structuredClone(baseline.input)), /generic_work_core_join_(?:signature_invalid|signer_unavailable)/);
    assert.equal(store.events().length, 0);
  }
});

test("verifier and injected authority accept only explicit public key material", () => {
  const privateJwk = KEYS.privateKey.export({ format: "jwk" });
  const rejected = [
    KEYS.privateKey,
    PRIVATE_KEY,
    { key: KEYS.privateKey },
    { key: PRIVATE_KEY, format: "pem" },
    privateJwk,
  ];
  for (const material of rejected) {
    assert.throws(() => createGenericWorkCoreJoinVerdictVerifier({ publicKey: material, keyId: KEY_ID }), /generic_work_core_join_verifier_unavailable/);
    assert.throws(() => createGenericWorkCoreJoinAuthority({
      signer: { algorithm: "Ed25519", key_id: KEY_ID, public_key: material, custody: "external_remote_signer", async signDigest() { return "unused"; } },
      now: () => NOW,
      verifyIndependentVerifierReceipt: () => true,
      store: createMemoryGenericWorkCoreJoinStore(),
    }), /generic_work_core_join_verifier_unavailable/);
  }
  const publicJwk = KEYS.publicKey.export({ format: "jwk" });
  assert.equal(createGenericWorkCoreJoinVerdictVerifier({ publicKey: publicJwk, keyId: KEY_ID }).key_id, KEY_ID);
});
