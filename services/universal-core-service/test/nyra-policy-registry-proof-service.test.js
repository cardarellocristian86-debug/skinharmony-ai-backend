import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

import {
  ATTESTATION_SCHEMA,
  RECEIPT_SCHEMA,
  canonical,
  createNyraPolicyRegistryProofService,
  proofBindingFromEnvelope,
} from "../src/nyraPolicyRegistryProofService.js";

const require = createRequire(import.meta.url);
const {
  SCHEMA_VERSION: NYRA_ATTESTATION_SCHEMA,
  createNyraPolicyRegistryAttester,
  createNyraPolicyRegistryLocalTestSigner,
} = require("../../../personal-control-center/lib/nyra-policy-registry-attestation");

const CONTEXT = "nyra-policy-activation-attestation-v3\0";

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
    if (q.startsWith("ALTER TABLE")) return { rowCount: 0, rows: [] };
    if (q.startsWith("INSERT INTO nyra_policy_registry_proofs")) {
      const key = `${params[0]}:${params[1]}`;
      if (this.rows.has(key)) return { rowCount: 0, rows: [] };
      const ownerKey = `${params[0]}:${params[3]}`;
      if (this.owner.has(ownerKey)) throw Object.assign(new Error("duplicate owner approval"), { code: "23505" });
      this.owner.set(ownerKey, key);
      this.rows.set(key, { tenant_id: params[0], operation_id: params[1], request_digest: params[2],
        owner_approval_hash: params[3], envelope: JSON.parse(params[4]), core_signature: params[5],
        expires_at: params[6], proof_schema_version: params[7], compiler_provenance_digest: params[8],
        status: "prepared", receipt: null, nyra_attestation: null });
      return { rowCount: 1, rows: [] };
    }
    if (q.startsWith("SELECT request_digest")) return this.#select(params);
    if (q.startsWith("SELECT envelope,core_signature")) return this.#select(params);
    if (q.startsWith("SELECT receipt")) return this.#select(params);
    if (q.startsWith("SELECT status,receipt,envelope")) return this.#select(params);
    if (q.startsWith("SELECT proof_schema_version")) return this.#select(params);
    if (q.startsWith("UPDATE nyra_policy_registry_proofs SET status='issued'")) {
      const row = this.rows.get(`${params[0]}:${params[1]}`);
      if (!row || row.status !== "prepared" || row.proof_schema_version !== params[4] ||
        row.compiler_provenance_digest !== params[5]) return { rowCount: 0, rows: [] };
      row.status = "issued"; row.nyra_attestation = JSON.parse(params[2]); row.receipt = JSON.parse(params[3]);
      return { rowCount: 1, rows: [] };
    }
    if (q.startsWith("UPDATE nyra_policy_registry_proofs SET status='consumed'")) {
      const row = this.rows.get(`${params[0]}:${params[1]}`);
      if (!row || row.status !== "issued" || row.receipt.receipt_id !== params[2] ||
        row.proof_schema_version !== params[3] || row.compiler_provenance_digest !== params[4]) {
        return { rowCount: 0, rows: [] };
      }
      row.status = "consumed"; return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected_query:${q}`);
  }
  #select(params) {
    const row = this.rows.get(`${params[0]}:${params[1]}`);
    return { rowCount: row ? 1 : 0, rows: row ? [structuredClone(row)] : [] };
  }
}

function setup({ signerFactory, boundProvenanceFactory, compilerVerifierFactory } = {}) {
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
  const input = { tenant_id: "codexai", work_id: "work-policy-0001", preflight_id: "preflight_policy_0001",
    intent_digest: "a".repeat(64), operation_id: "operation-policy-0001", action: "policy.snapshot.activate",
    snapshot_digest: "b".repeat(64), domain_pack_id: "generic", owner_approval_hash: "c".repeat(64) };
  const trustedCompilerProvenance = compilerProvenance(input);
  const boundCompilerProvenance = boundProvenanceFactory
    ? boundProvenanceFactory(structuredClone(trustedCompilerProvenance), input)
    : trustedCompilerProvenance;
  input.compiler_provenance_digest = boundCompilerProvenance.provenance_digest;
  const compilerProvenanceVerifier = compilerVerifierFactory
    ? compilerVerifierFactory({ trustedCompilerProvenance, boundCompilerProvenance, input })
    : strictCompilerProvenanceVerifier(trustedCompilerProvenance);
  const signer = signerFactory
    ? signerFactory({ keys: core, now: () => time })
    : localTestSigner(core);
  const service = createNyraPolicyRegistryProofService({
    pool,
    env,
    signer,
    compilerProvenanceVerifier,
    now: () => time,
  });
  function attest(challenge, overrides = {}) {
    const envelope = overrides.envelope || challenge.envelope;
    const signature = crypto.sign(null, Buffer.from(`${CONTEXT}${canonical(envelope)}`), nyra.privateKey).toString("base64url");
    return { schema_version: ATTESTATION_SCHEMA, envelope, core_signature: challenge.core_signature,
      nyra_signature: overrides.signature || signature };
  }
  return { pool, service, signer, input, attest, core, nyra, env, compilerProvenanceVerifier,
    trustedCompilerProvenance, boundCompilerProvenance, now: () => time,
    advance: (ms) => { time += ms; } };
}

function compilerProvenance(input, overrides = {}) {
  const body = {
    schema_version: "nyra_policy_compiler_provenance_v1",
    compiler_mode: "core_deterministic_recompile",
    compiler_algorithm: "nyra_policy_registry_v1",
    tenant_id: input.tenant_id,
    domain_pack_id: input.domain_pack_id,
    snapshot_digest: input.snapshot_digest,
    leaf_pack_digests: [{ pack_id: "generic", version: "1.0.0", digest: "1".repeat(64) }],
    ordered_pack_evidence: [
      {
        pack_id: "core",
        version: "1.0.0",
        pack_digest: "2".repeat(64),
        scope_kind: "core",
        verification_kind: "trusted_core_digest",
        verified_key_ids: [],
        verified_public_key_fingerprints: [],
        verified_roles: ["core"],
      },
      {
        pack_id: "generic",
        version: "1.0.0",
        pack_digest: "1".repeat(64),
        scope_kind: "domain",
        verification_kind: "ed25519_quorum",
        verified_key_ids: ["core-policy-key-v1", "nyra-policy-key-v1"],
        verified_public_key_fingerprints: ["6".repeat(64), "7".repeat(64)],
        verified_roles: ["core", "nyra"],
      },
    ],
    core_root_digest: "2".repeat(64),
    catalog_digest: "3".repeat(64),
    trust_catalog_digest: "4".repeat(64),
    compiler_build_commit: "5".repeat(40),
    validity: { valid_from: "2026-08-01T00:00:00.000Z", expires_at: "2026-09-01T00:00:00.000Z" },
    resolution: {
      logical_depth: 2,
      traversal_budget: 256,
      traversed: 2,
      catalog_depth_policy: "no_static_ceiling",
      runtime_policy: "bounded_fail_closed",
    },
    execution_authorized: false,
    ...overrides,
  };
  return { ...body, provenance_digest: crypto.createHash("sha256").update(canonical(body)).digest("hex") };
}

function deepPlain(value) {
  if (Array.isArray(value)) {
    return Object.getPrototypeOf(value) === Array.prototype &&
      Object.keys(value).length === value.length && value.every(deepPlain);
  }
  if (value && typeof value === "object") {
    return Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(deepPlain);
  }
  return value === null || ["boolean", "number", "string"].includes(typeof value);
}

function compilerVerificationSuccess(record) {
  return {
    ok: true,
    record_integrity_verified: true,
    derivation_reverified: false,
    tenant_id: record.tenant_id,
    domain_pack_id: record.domain_pack_id,
    snapshot_digest: record.snapshot_digest,
    compiler_provenance_digest: record.provenance_digest,
    compiler_build_commit: record.compiler_build_commit,
    catalog_digest: record.catalog_digest,
    trust_catalog_digest: record.trust_catalog_digest,
    execution_authorized: false,
    error: null,
  };
}

function strictCompilerProvenanceVerifier(expectedRecord) {
  const expectedCanonical = canonical(expectedRecord);
  return Object.freeze({
    verifyPersistedRecord(record, binding) {
      const failure = Object.freeze({
        ok: false,
        record_integrity_verified: false,
        derivation_reverified: false,
        execution_authorized: false,
        error: "compiled_policy_snapshot_provenance_invalid",
      });
      const expectedBinding = {
        tenant_id: expectedRecord.tenant_id,
        domain_pack_id: expectedRecord.domain_pack_id,
        snapshot_digest: expectedRecord.snapshot_digest,
        compiler_provenance_digest: expectedRecord.provenance_digest,
      };
      if (!deepPlain(record) || !deepPlain(binding) || canonical(record) !== expectedCanonical ||
        canonical(binding) !== canonical(expectedBinding)) return failure;
      return Object.freeze(compilerVerificationSuccess(expectedRecord));
    },
  });
}

function rehashCompilerProvenance(record) {
  const body = { ...record };
  delete body.provenance_digest;
  return { ...body, provenance_digest: crypto.createHash("sha256").update(canonical(body)).digest("hex") };
}

test("prepares a tenant-bound challenge and rejects drift or owner approval replay", async () => {
  const { service, input, pool } = setup();
  const challenge = await service.prepare(input);
  assert.equal(challenge.envelope.tenant_id, "codexai");
  assert.equal(challenge.envelope.action, "policy.snapshot.activate");
  assert.equal(challenge.envelope.owner_approval_hash, input.owner_approval_hash);
  assert.equal(challenge.envelope.compiler_provenance_digest, input.compiler_provenance_digest);
  assert.match(challenge.envelope.core_public_key_fingerprint, /^[a-f0-9]{64}$/);
  assert.match(challenge.envelope.nyra_public_key_fingerprint, /^[a-f0-9]{64}$/);
  const row = pool.rows.get(`${input.tenant_id}:${input.operation_id}`);
  assert.equal(row.proof_schema_version, "nyra_policy_registry_proof_v3");
  assert.equal(row.compiler_provenance_digest, input.compiler_provenance_digest);
  const status = await service.status();
  assert.equal(status.proof_schema_version, "nyra_policy_registry_proof_v3");
  assert.equal(status.attestation_schema_version, ATTESTATION_SCHEMA);
  assert.equal(status.receipt_schema_version, RECEIPT_SCHEMA);
  assert.equal(status.compiler_provenance_binding_required, true);
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
  assert.equal(receipt.compiler_provenance_digest, input.compiler_provenance_digest);
  const receiptReplay = await service.issue({ tenant_id: input.tenant_id, operation_id: input.operation_id,
    attestation: attest(challenge) });
  assert.equal(receiptReplay.idempotent_replay, true);
  assert.equal(receiptReplay.receipt_id, receipt.receipt_id);
  assert.equal(receiptReplay.compiler_provenance_digest, input.compiler_provenance_digest);
  const binding = proofBindingFromEnvelope(challenge.envelope);
  assert.equal(service.verifyReceipt(receipt, binding).operation_id, input.operation_id);
  assert.throws(() => service.verifyReceipt({
    ...receipt,
    schema_version: "core_policy_activation_receipt_v2",
  }, binding), /policy_activation_core_receipt_invalid/);
  const quorum = service.verifyActivationSnapshot({
    tenant_id: input.tenant_id,
    domain_pack_id: input.domain_pack_id,
    snapshot_digest: input.snapshot_digest,
  }, compilerProvenance(input), { binding, activation_attestation: attest(challenge) });
  assert.deepEqual(quorum.verified_roles, ["core", "nyra"]);
  assert.throws(() => service.verifyActivationSnapshot({
    tenant_id: input.tenant_id, domain_pack_id: input.domain_pack_id, snapshot_digest: "e".repeat(64),
  }, compilerProvenance(input), { binding, activation_attestation: attest(challenge) }),
  /policy_snapshot_signature_quorum_invalid/);
  const proof = await service.consume(receipt, binding);
  assert.equal(proof.consumed, true);
  await assert.rejects(service.consume(receipt, binding), /policy_activation_core_receipt_replayed/);
  await assert.rejects(service.consume(receipt, { ...binding, snapshot_digest: "e".repeat(64) }), /policy_activation_core_receipt_invalid/);
});

test("rejects v2, compiler provenance tampering and mixed operation bindings", async () => {
  const { service, input, attest } = setup();
  const challenge = await service.prepare(input);
  const v3Attestation = attest(challenge);
  await assert.rejects(service.issue({
    tenant_id: input.tenant_id,
    operation_id: input.operation_id,
    attestation: { ...v3Attestation, schema_version: "nyra_policy_activation_attestation_v2" },
  }), /policy_proof_attestation_invalid/);

  const receipt = await service.issue({
    tenant_id: input.tenant_id,
    operation_id: input.operation_id,
    attestation: v3Attestation,
  });
  const binding = proofBindingFromEnvelope(challenge.envelope);
  assert.throws(() => service.verifyReceipt(receipt, {
    ...binding,
    operation: "rollback_policy_snapshot",
  }), /policy_proof_operation_binding_invalid/);
  assert.throws(() => service.verifyReceipt(receipt, {
    ...binding,
    compiler_provenance_digest: "f".repeat(64),
  }), /policy_activation_core_receipt_invalid/);

  const record = compilerProvenance(input);
  assert.throws(() => service.verifyActivationSnapshot({
    tenant_id: input.tenant_id,
    domain_pack_id: input.domain_pack_id,
    snapshot_digest: input.snapshot_digest,
  }, { ...record, catalog_digest: "f".repeat(64) }, {
    binding,
    activation_attestation: v3Attestation,
  }), /policy_snapshot_signature_quorum_invalid/);
  assert.throws(() => service.verifyActivationSnapshot({
    tenant_id: input.tenant_id,
    domain_pack_id: input.domain_pack_id,
    snapshot_digest: input.snapshot_digest,
  }, { ...record, tenant_id: "other-tenant" }, {
    binding,
    activation_attestation: v3Attestation,
  }), /policy_snapshot_signature_quorum_invalid/);
  assert.throws(() => service.verifyActivationSnapshot({
    tenant_id: input.tenant_id,
    domain_pack_id: "forged-domain",
    snapshot_digest: input.snapshot_digest,
  }, record, {
    binding,
    activation_attestation: v3Attestation,
  }), /policy_snapshot_signature_quorum_invalid/);
});

test("requires an injected compiler provenance verifier and exact verification outcomes", async () => {
  const baseline = setup();
  const missing = createNyraPolicyRegistryProofService({
    pool: new FakePool(),
    env: baseline.env,
    signer: localTestSigner(baseline.core),
  });
  assert.equal((await missing.status()).ready, false);
  await assert.rejects(missing.prepare(baseline.input), /policy_proof_unavailable/);

  const invalid = createNyraPolicyRegistryProofService({
    pool: new FakePool(),
    env: baseline.env,
    signer: localTestSigner(baseline.core),
    compilerProvenanceVerifier: { verifyPersistedRecord: true },
  });
  assert.equal((await invalid.status()).ready, false);

  for (const outcomeMutation of [
    (outcome) => { delete outcome.trust_catalog_digest; },
    (outcome) => { outcome.derivation_reverified = true; },
    (outcome) => { outcome.unexpected = true; },
    () => { throw new Error("verifier internal secret"); },
  ]) {
    const value = setup({
      compilerVerifierFactory: ({ trustedCompilerProvenance }) => ({
        verifyPersistedRecord() {
          const outcome = compilerVerificationSuccess(trustedCompilerProvenance);
          outcomeMutation(outcome);
          return outcome;
        },
      }),
    });
    const challenge = await value.service.prepare(value.input);
    assert.throws(() => value.service.verifyActivationSnapshot({
      tenant_id: value.input.tenant_id,
      domain_pack_id: value.input.domain_pack_id,
      snapshot_digest: value.input.snapshot_digest,
    }, value.boundCompilerProvenance, {
      binding: proofBindingFromEnvelope(challenge.envelope),
      activation_attestation: value.attest(challenge),
    }), /policy_snapshot_signature_quorum_invalid/);
  }
});

test("denies self-digested malformed provenance even when the dual proof binds its digest", async () => {
  const malformedFactories = [
    (record) => {
      record.ordered_pack_evidence[1].verification_kind = "self_asserted";
      return rehashCompilerProvenance(record);
    },
    (record) => {
      record.ordered_pack_evidence[1].verified_roles = ["core"];
      return rehashCompilerProvenance(record);
    },
    (record) => {
      record.resolution.logical_depth = 1;
      return rehashCompilerProvenance(record);
    },
    (record) => rehashCompilerProvenance({ ...record, unexpected: true }),
    (record) => {
      Object.setPrototypeOf(record, { inherited_trust: true });
      return record;
    },
  ];
  for (const boundProvenanceFactory of malformedFactories) {
    const value = setup({ boundProvenanceFactory });
    const challenge = await value.service.prepare(value.input);
    const binding = proofBindingFromEnvelope(challenge.envelope);
    assert.equal(binding.compiler_provenance_digest,
      value.boundCompilerProvenance.provenance_digest);
    assert.throws(() => value.service.verifyActivationSnapshot({
      tenant_id: value.input.tenant_id,
      domain_pack_id: value.input.domain_pack_id,
      snapshot_digest: value.input.snapshot_digest,
    }, value.boundCompilerProvenance, {
      binding,
      activation_attestation: value.attest(challenge),
    }), /policy_snapshot_signature_quorum_invalid/);
  }
});

test("legacy proof rows with nullable v3 columns are rejected fail closed", async () => {
  const { service, input, pool, attest } = setup();
  const challenge = await service.prepare(input);
  const key = `${input.tenant_id}:${input.operation_id}`;
  pool.rows.get(key).proof_schema_version = null;
  pool.rows.get(key).compiler_provenance_digest = null;
  await assert.rejects(service.prepare(input), /policy_proof_legacy_schema_unsupported/);
  await assert.rejects(service.issue({ tenant_id: input.tenant_id, operation_id: input.operation_id,
    attestation: attest(challenge) }), /policy_proof_legacy_schema_unsupported/);
  await assert.rejects(service.reconcile({ tenant_id: input.tenant_id, operation_id: input.operation_id }),
    /policy_proof_legacy_schema_unsupported/);

  pool.rows.get(key).proof_schema_version = "nyra_policy_registry_proof_v3";
  await assert.rejects(service.reconcile({ tenant_id: input.tenant_id, operation_id: input.operation_id }),
    /policy_proof_legacy_schema_unsupported/);
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
  assert.equal(reconciled.binding.compiler_provenance_digest, input.compiler_provenance_digest);
  assert.equal(reconciled.compiler_provenance_digest, input.compiler_provenance_digest);
  assert.equal(reconciled.execution_authorized, false);
  const consumption = await service.reconcileConsumption({ tenant_id: input.tenant_id,
    operation_id: input.operation_id, operation: "forged", snapshot_digest: "e".repeat(64) });
  assert.equal(consumption.consumed, true);
  assert.equal(consumption.action, "policy.snapshot.activate");
  assert.equal(consumption.operation, "activate_policy_snapshot");
});

test("Core v3 challenges are consumed byte-exactly by the Nyra v3 attester", async () => {
  const value = setup();
  const replayStore = {
    kind: "postgresql",
    restart_durable: true,
    distributed: true,
    async initialize() {},
    async probe() {},
    async lookup() { return null; },
    async record({ response }) { return { response: structuredClone(response), idempotent_replay: false }; },
  };
  const nyraEnv = {
    NODE_ENV: "test",
    NYRA_POLICY_REGISTRY_ATTESTATION_ENABLED: "true",
    NYRA_POLICY_REGISTRY_ATTESTATION_REQUIRED: "true",
    NYRA_POLICY_REGISTRY_SIGNER_MODE: "remote",
    NYRA_POLICY_REGISTRY_TENANT_ALLOWLIST: value.input.tenant_id,
    NYRA_POLICY_REGISTRY_CORE_SERVICE_KEY: "core-service-key-at-least-32-bytes",
    NYRA_POLICY_REGISTRY_CORE_KEY_ID: "core-policy-key-v1",
    NYRA_POLICY_REGISTRY_NYRA_KEY_ID: "nyra-policy-key-v1",
    NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY: value.core.publicKey.export({ type: "spki", format: "pem" }),
    NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY: value.nyra.publicKey.export({ type: "spki", format: "pem" }),
    NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY_FINGERPRINT: fingerprint(value.core.publicKey),
    NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY_FINGERPRINT: fingerprint(value.nyra.publicKey),
    NYRA_POLICY_REGISTRY_ATTESTATION_MAX_AGE_MS: "300000",
  };
  const attester = createNyraPolicyRegistryAttester({
    env: nyraEnv,
    now: value.now,
    replayStore,
    testSigner: createNyraPolicyRegistryLocalTestSigner({
      privateKey: value.nyra.privateKey,
      keyId: "nyra-policy-key-v1",
    }),
    allowLocalSignerForTests: true,
    probeCooldownMs: 0,
  });
  await attester.probe({ force: true });
  assert.equal(ATTESTATION_SCHEMA, NYRA_ATTESTATION_SCHEMA);
  assert.equal(attester.status().ready, true);
  const challenge = await value.service.prepare(value.input);
  const attestation = await attester.attest({
    envelope: challenge.envelope,
    core_signature: challenge.core_signature,
  });
  const receipt = await value.service.issue({
    tenant_id: value.input.tenant_id,
    operation_id: value.input.operation_id,
    attestation,
  });
  assert.equal(receipt.schema_version, RECEIPT_SCHEMA);
  assert.equal(receipt.compiler_provenance_digest, value.input.compiler_provenance_digest);
});

test("fails closed after challenge expiry and when env key material is incomplete", async () => {
  const { service, input, attest, advance, pool, compilerProvenanceVerifier } = setup();
  const challenge = await service.prepare(input);
  advance(300001);
  await assert.rejects(service.issue({ tenant_id: input.tenant_id, operation_id: input.operation_id,
    attestation: attest(challenge) }), /policy_proof_attestation_invalid/);
  const unavailable = createNyraPolicyRegistryProofService({
    pool,
    env: {},
    signer: null,
    compilerProvenanceVerifier,
  });
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
  const configuredCompilerVerifier = Object.freeze({
    verifyPersistedRecord() { throw new Error("not_invoked_by_status"); },
  });
  const service = createNyraPolicyRegistryProofService({
    pool,
    env,
    signer: localTestSigner(core),
    compilerProvenanceVerifier: configuredCompilerVerifier,
  });
  assert.equal((await service.status()).ready, true);
  const privateWrapper = createNyraPolicyRegistryProofService({
    pool,
    env: {
      ...env,
      CORE_NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY: nyra.privateKey.export({ type: "pkcs8", format: "pem" }),
    },
    signer: localTestSigner(core),
    compilerProvenanceVerifier: configuredCompilerVerifier,
  });
  assert.equal((await privateWrapper.status()).ready, false);
});
