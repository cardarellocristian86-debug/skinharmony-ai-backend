import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  ATTESTATION_SCHEMA,
  RECEIPT_SCHEMA,
  canonical,
  createNyraPolicyRegistryProofService,
  proofBindingFromEnvelope,
} from "../src/nyraPolicyRegistryProofService.js";

const CONTEXT = "nyra-policy-activation-attestation-v2\0";

function fingerprint(key) {
  return crypto.createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");
}

function localTestSigner(keys, keyId = "core-policy-key-v1") {
  let state = "configured";
  return {
    algorithm: "Ed25519",
    custody: "local_test_seam",
    key_id: keyId,
    public_key: keys.publicKey,
    public_key_fingerprint: fingerprint(keys.publicKey),
    async signPayload(payload) {
      state = "ready";
      return crypto.sign(null, payload, keys.privateKey).toString("base64url");
    },
    async probe() {
      state = "ready";
      return true;
    },
    health() { return { signer_state: state, reason: null, target_commit: null }; },
  };
}
class FakePool {
  constructor() { this.rows = new Map(); this.owner = new Map(); this.schemaFailures = 0; this.schemaAttempts = 0; }
  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (q.startsWith("CREATE TABLE")) {
      this.schemaAttempts += 1;
      if (this.schemaFailures > 0) {
        this.schemaFailures -= 1;
        throw new Error("transient schema backend failure with secret");
      }
      return { rowCount: 0, rows: [] };
    }
    if (q.startsWith("INSERT INTO nyra_policy_registry_proofs")) {
      const key = `${params[0]}:${params[1]}`;
      if (this.rows.has(key)) return { rowCount: 0, rows: [] };
      const ownerKey = `${params[0]}:${params[3]}`;
      if (this.owner.has(ownerKey)) throw Object.assign(new Error("duplicate owner approval"), { code: "23505" });
      this.owner.set(ownerKey, key);
      this.rows.set(key, { tenant_id: params[0], operation_id: params[1], request_digest: params[2],
        owner_approval_hash: params[3], envelope: JSON.parse(params[4]), core_signature: params[5],
        expires_at: params[6], status: "prepared", receipt: null, nyra_attestation: null });
      return { rowCount: 1, rows: [] };
    }
    if (q.startsWith("SELECT request_digest")) return this.#select(params);
    if (q.startsWith("SELECT envelope,core_signature")) return this.#select(params);
    if (q.startsWith("SELECT receipt")) return this.#select(params);
    if (q.startsWith("SELECT status,receipt,envelope")) return this.#select(params);
    if (q.startsWith("UPDATE nyra_policy_registry_proofs SET status='issued'")) {
      const row = this.rows.get(`${params[0]}:${params[1]}`);
      if (!row || row.status !== "prepared") return { rowCount: 0, rows: [] };
      row.status = "issued"; row.nyra_attestation = JSON.parse(params[2]); row.receipt = JSON.parse(params[3]);
      return { rowCount: 1, rows: [] };
    }
    if (q.startsWith("UPDATE nyra_policy_registry_proofs SET status='consumed'")) {
      const row = this.rows.get(`${params[0]}:${params[1]}`);
      if (!row || row.status !== "issued" || row.receipt.receipt_id !== params[2]) return { rowCount: 0, rows: [] };
      row.status = "consumed"; return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected_query:${q}`);
  }
  #select(params) {
    const row = this.rows.get(`${params[0]}:${params[1]}`);
    return { rowCount: row ? 1 : 0, rows: row ? [structuredClone(row)] : [] };
  }
}

function setup({ signerFactory } = {}) {
  const core = crypto.generateKeyPairSync("ed25519");
  const nyra = crypto.generateKeyPairSync("ed25519");
  const pool = new FakePool();
  let time = Date.parse("2026-08-03T12:00:00.000Z");
  const env = {
    CORE_NYRA_POLICY_REGISTRY_CORE_KEY_ID: "core-policy-key-v1",
    CORE_NYRA_POLICY_REGISTRY_NYRA_KEY_ID: "nyra-policy-key-v1",
    CORE_NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY: nyra.publicKey.export({ type: "spki", format: "pem" }),
    CORE_NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY_FINGERPRINT: fingerprint(core.publicKey),
    CORE_NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY_FINGERPRINT: fingerprint(nyra.publicKey),
    CORE_NYRA_POLICY_REGISTRY_RECEIPT_SECRET: "r".repeat(64),
    CORE_NYRA_POLICY_REGISTRY_TENANT_ALLOWLIST: "codexai",
    CORE_NYRA_POLICY_REGISTRY_PROOF_TTL_MS: "300000",
  };
  const signer = signerFactory
    ? signerFactory({ keys: core, now: () => time })
    : localTestSigner(core);
  const service = createNyraPolicyRegistryProofService({ pool, env, signer, now: () => time });
  const input = { tenant_id: "codexai", work_id: "work-policy-0001", preflight_id: "preflight_policy_0001",
    intent_digest: "a".repeat(64), operation_id: "operation-policy-0001", action: "policy.snapshot.activate",
    snapshot_digest: "b".repeat(64), domain_pack_id: "generic", owner_approval_hash: "c".repeat(64) };
  function attest(challenge, overrides = {}) {
    const envelope = overrides.envelope || challenge.envelope;
    const signature = crypto.sign(null, Buffer.from(`${CONTEXT}${canonical(envelope)}`), nyra.privateKey).toString("base64url");
    return { schema_version: ATTESTATION_SCHEMA, envelope, core_signature: challenge.core_signature,
      nyra_signature: overrides.signature || signature };
  }
  return { pool, service, signer, input, attest, advance: (ms) => { time += ms; } };
}

test("prepares a tenant-bound challenge and rejects drift or owner approval replay", async () => {
  const { service, input } = setup();
  const challenge = await service.prepare(input);
  assert.equal(challenge.envelope.tenant_id, "codexai");
  assert.equal(challenge.envelope.action, "policy.snapshot.activate");
  assert.equal(challenge.envelope.owner_approval_hash, input.owner_approval_hash);
  assert.match(challenge.envelope.core_public_key_fingerprint, /^[a-f0-9]{64}$/);
  assert.match(challenge.envelope.nyra_public_key_fingerprint, /^[a-f0-9]{64}$/);
  const replay = await service.prepare(input);
  assert.equal(replay.envelope.nonce, challenge.envelope.nonce);
  assert.equal(replay.idempotent_replay, true);
  await assert.rejects(service.prepare({ ...input, snapshot_digest: "d".repeat(64) }), /policy_proof_idempotency_conflict/);
  await assert.rejects(service.prepare({ ...input, operation_id: "operation-policy-0002" }), /policy_proof_owner_replayed/);
  await assert.rejects(service.prepare({ ...input, tenant_id: "other" }), /policy_proof_tenant_denied/);
  await assert.rejects(service.prepare({ ...input, action: "policy.snapshot.activate.similar" }), /policy_proof_action_invalid/);
});

test("verifies the Nyra signature, issues a dual-bound receipt and consumes it once", async () => {
  const { service, input, attest } = setup();
  const challenge = await service.prepare(input);
  await assert.rejects(service.issue({ tenant_id: input.tenant_id, operation_id: input.operation_id,
    attestation: attest(challenge, { signature: "invalid" }) }), /policy_proof_attestation_invalid/);
  const receipt = await service.issue({ tenant_id: input.tenant_id, operation_id: input.operation_id,
    attestation: attest(challenge) });
  assert.equal(receipt.schema_version, RECEIPT_SCHEMA);
  assert.equal(receipt.single_use, true);
  const binding = proofBindingFromEnvelope(challenge.envelope);
  assert.equal(service.verifyReceipt(receipt, binding).operation_id, input.operation_id);
  assert.throws(() => service.verifyReceipt({
    ...receipt,
    schema_version: "core_policy_activation_receipt_v1",
  }, binding), /policy_activation_core_receipt_invalid/);
  const quorum = service.verifyActivationSnapshot({
    tenant_id: input.tenant_id,
    snapshot_digest: input.snapshot_digest,
  }, { binding, activation_attestation: attest(challenge) });
  assert.deepEqual(quorum.verified_roles, ["core", "nyra"]);
  assert.throws(() => service.verifyActivationSnapshot({
    tenant_id: input.tenant_id, snapshot_digest: "e".repeat(64),
  }, { binding, activation_attestation: attest(challenge) }), /policy_snapshot_signature_quorum_invalid/);
  const proof = await service.consume(receipt, binding);
  assert.equal(proof.consumed, true);
  await assert.rejects(service.consume(receipt, binding), /policy_activation_core_receipt_replayed/);
  await assert.rejects(service.consume(receipt, { ...binding, snapshot_digest: "e".repeat(64) }), /policy_activation_core_receipt_invalid/);
});

test("CAS permits one concurrent receipt consumer and reconcile trusts server state only", async () => {
  const { service, input, attest } = setup();
  const challenge = await service.prepare(input);
  const receipt = await service.issue({ tenant_id: input.tenant_id, operation_id: input.operation_id,
    attestation: attest(challenge) });
  const binding = proofBindingFromEnvelope(challenge.envelope);
  const raced = await Promise.allSettled(Array.from({ length: 8 }, () => service.consume(receipt, binding)));
  assert.equal(raced.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(raced.filter((entry) => entry.status === "rejected").length, 7);
  const reconciled = await service.reconcile({ tenant_id: input.tenant_id, operation_id: input.operation_id,
    receipt: { forged: true }, status: "issued" });
  assert.equal(reconciled.status, "consumed");
  assert.equal(reconciled.receipt.receipt_id, receipt.receipt_id);
  assert.equal(reconciled.consumed, true);
  const consumption = await service.reconcileConsumption({ tenant_id: input.tenant_id,
    operation_id: input.operation_id, operation: "forged", snapshot_digest: "e".repeat(64) });
  assert.equal(consumption.consumed, true);
  assert.equal(consumption.action, "policy.snapshot.activate");
  assert.equal(consumption.operation, "activate_policy_snapshot");
});

test("fails closed after challenge expiry and when env key material is incomplete", async () => {
  const { service, input, attest, advance, pool } = setup();
  const challenge = await service.prepare(input);
  advance(300001);
  await assert.rejects(service.issue({ tenant_id: input.tenant_id, operation_id: input.operation_id,
    attestation: attest(challenge) }), /policy_proof_attestation_invalid/);
  const unavailable = createNyraPolicyRegistryProofService({ pool, env: {}, signer: null });
  assert.equal((await unavailable.status()).ready, false);
  await assert.rejects(unavailable.prepare(input), /policy_proof_unavailable/);
});

test("retries a transient proof schema failure without a process restart", async () => {
  const { service, pool } = setup();
  pool.schemaFailures = 1;
  assert.equal((await service.status()).ready, false);
  assert.equal((await service.status()).ready, true);
  assert.equal(pool.schemaAttempts, 2);
  assert.equal(JSON.stringify(await service.status()).includes("secret"), false);
});

test("refreshes signer proof after cooldown and fails health closed on a later outage", async () => {
  let upstreamReady = true;
  let probeCalls = 0;
  let remoteAttempts = 0;
  const { service, signer, advance } = setup({
    signerFactory: ({ keys, now }) => {
      let signerState = "configured";
      let reason = null;
      let cooldownUntil = Number.NEGATIVE_INFINITY;
      return {
        algorithm: "Ed25519",
        custody: "external_remote_signer",
        key_id: "core-policy-key-v1",
        public_key: keys.publicKey,
        public_key_fingerprint: fingerprint(keys.publicKey),
        async signPayload(payload) {
          if (!upstreamReady) throw new Error("signer outage with private detail");
          signerState = "ready";
          reason = null;
          return crypto.sign(null, payload, keys.privateKey).toString("base64url");
        },
        async probe() {
          probeCalls += 1;
          if (now() < cooldownUntil) return signerState === "ready";
          remoteAttempts += 1;
          cooldownUntil = now() + 100;
          signerState = upstreamReady ? "ready" : "unavailable";
          reason = upstreamReady ? null : "policy_registry_core_signer_unavailable";
          return upstreamReady;
        },
        health() {
          return { signer_state: signerState, reason, target_commit: "b".repeat(40), remote_attempts: remoteAttempts };
        },
      };
    },
  });

  assert.equal((await service.status()).ready, true);
  assert.equal(probeCalls, 1);
  assert.equal(remoteAttempts, 1);
  assert.equal((await service.status()).ready, true);
  assert.equal(probeCalls, 2);
  assert.equal(remoteAttempts, 1);

  upstreamReady = false;
  advance(101);
  const unavailable = await service.status();
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.signer.ready, false);
  assert.equal(signer.health().signer_state, "unavailable");
  assert.equal(probeCalls, 3);
  assert.equal(remoteAttempts, 2);
  assert.equal(JSON.stringify(unavailable).includes("private detail"), false);
});

test("accepts only public Nyra material and an external signer adapter", async () => {
  const core = crypto.generateKeyPairSync("ed25519");
  const nyra = crypto.generateKeyPairSync("ed25519");
  const pool = new FakePool();
  const env = {
    CORE_NYRA_POLICY_REGISTRY_CORE_KEY_ID: "core-policy-key-v1",
    CORE_NYRA_POLICY_REGISTRY_NYRA_KEY_ID: "nyra-policy-key-v1",
    CORE_NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY: nyra.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    CORE_NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY_FINGERPRINT: fingerprint(core.publicKey),
    CORE_NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY_FINGERPRINT: fingerprint(nyra.publicKey),
    CORE_NYRA_POLICY_REGISTRY_RECEIPT_SECRET: "r".repeat(64),
    CORE_NYRA_POLICY_REGISTRY_TENANT_ALLOWLIST: "codexai",
  };
  const service = createNyraPolicyRegistryProofService({ pool, env, signer: localTestSigner(core) });
  assert.equal((await service.status()).ready, true);
  const privateWrapper = createNyraPolicyRegistryProofService({
    pool,
    env: {
      ...env,
      CORE_NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY: nyra.privateKey.export({ type: "pkcs8", format: "pem" }),
    },
    signer: localTestSigner(core),
  });
  assert.equal((await privateWrapper.status()).ready, false);
});
