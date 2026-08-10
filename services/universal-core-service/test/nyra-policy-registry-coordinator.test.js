import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  createNyraPolicyRegistryClient,
  createNyraPolicyRegistryCoordinator,
  derivePolicyRegistryOwnerApprovalHash,
} from "../src/nyraPolicyRegistryCoordinator.js";
import { ATTESTATION_SCHEMA } from "../src/nyraPolicyRegistryProofService.js";

const ORIGIN = "https://nyra-policy.example";
const HEALTH_ENDPOINT = `${ORIGIN}/healthz`;

function jsonResponse(url, value, { status = 200, bodyDelayMs = 0 } = {}) {
  const bytes = Buffer.from(JSON.stringify(value));
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    url,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-type") return "application/json; charset=utf-8";
        if (String(name).toLowerCase() === "content-length") return String(bytes.length);
        return null;
      },
    },
    body: {
      getReader() {
        return {
          async read() {
            if (sent) return { done: true };
            sent = true;
            if (bodyDelayMs) await new Promise((resolve) => setTimeout(resolve, bodyDelayMs));
            return { done: false, value: bytes };
          },
          async cancel() {},
        };
      },
    },
  };
}

function clientEnv(overrides = {}) {
  return {
    CORE_NYRA_POLICY_REGISTRY_NYRA_ORIGIN: ORIGIN,
    CORE_NYRA_POLICY_REGISTRY_NYRA_SERVICE_KEY: "n".repeat(64),
    CORE_NYRA_POLICY_REGISTRY_NYRA_TIMEOUT_MS: "100",
    CORE_NYRA_POLICY_REGISTRY_NYRA_MAX_RESPONSE_BYTES: "65536",
    CORE_NYRA_POLICY_REGISTRY_NYRA_PROBE_COOLDOWN_MS: "100",
    CORE_NYRA_POLICY_REGISTRY_PROOF_REQUIRED: "true",
    CORE_NYRA_POLICY_REGISTRY_NYRA_SERVICE: "nyra-horizontal-runtime",
    CORE_NYRA_POLICY_REGISTRY_CORE_KEY_ID: "core-policy-key-v2",
    CORE_NYRA_POLICY_REGISTRY_NYRA_KEY_ID: "nyra-policy-key-v2",
    CORE_NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY_FINGERPRINT: "a".repeat(64),
    CORE_NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY_FINGERPRINT: "b".repeat(64),
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_SERVICE: "nyra-policy-registry-signer",
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_TARGET_COMMIT: "c".repeat(40),
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_PURPOSE: "nyra.policy_registry.attestation",
    ...overrides,
  };
}

function healthBody(overrides = {}) {
  return {
    ok: true,
    service: "nyra-horizontal-runtime",
    policy_registry_attestation: {
      enabled: true,
      required: true,
      mode: "remote",
      configuration_valid: true,
      configured: true,
      ready: true,
      state: "ready",
      render_gate_required: true,
      service_key_configured: true,
      signer_state: "ready",
      replay_state: "ready",
      replay_backend: "postgresql",
      restart_durable: true,
      distributed: true,
      algorithm: "Ed25519",
      custody: "external_remote_signer",
      signer_service: "nyra-policy-registry-signer",
      signer_target_commit: "c".repeat(40),
      signer_purpose: "nyra.policy_registry.attestation",
      core_key_id: "core-policy-key-v2",
      nyra_key_id: "nyra-policy-key-v2",
      core_public_key_fingerprint: "a".repeat(64),
      nyra_public_key_fingerprint: "b".repeat(64),
      error: null,
      ...overrides,
    },
  };
}

test("read-only Nyra health probe verifies exact E2E trust and writes no proof data", async () => {
  let fetchCalls = 0;
  const client = createNyraPolicyRegistryClient({
    env: clientEnv(),
    fetchImpl: async (url, options) => {
      fetchCalls += 1;
      assert.equal(url, HEALTH_ENDPOINT);
      assert.equal(options.method, "GET");
      assert.equal(Object.hasOwn(options.headers, "x-nyra-policy-registry-service-key"), false);
      return jsonResponse(url, healthBody());
    },
  });
  assert.equal(await client.probe(), true);
  assert.equal(client.status().ready, true);
  assert.equal(client.status().upstream_verified, true);
  assert.equal(fetchCalls, 1);

  const drift = createNyraPolicyRegistryClient({
    env: clientEnv(),
    fetchImpl: async (url) => jsonResponse(url, healthBody({ extra_authority: true })),
  });
  assert.equal(await drift.probe(), false);
  assert.equal(drift.status().last_failure, "policy_registry_nyra_health_binding_invalid");

  const reverseRequired = createNyraPolicyRegistryClient({
    env: clientEnv({ CORE_NYRA_POLICY_REGISTRY_PROOF_REQUIRED: "false" }),
    fetchImpl: async (url) => jsonResponse(url, healthBody()),
  });
  assert.equal(await reverseRequired.probe(), false);
});

test("Nyra health hard deadline covers body read and late success cannot promote readiness", async () => {
  let calls = 0;
  const client = createNyraPolicyRegistryClient({
    env: clientEnv(),
    fetchImpl: async (url) => {
      calls += 1;
      return jsonResponse(url, healthBody(), { bodyDelayMs: calls === 1 ? 150 : 0 });
    },
  });
  assert.equal(await client.probe(), false);
  assert.equal(client.status().last_failure, "policy_registry_nyra_timeout");
  assert.equal(await client.probe(), false);
  assert.equal(calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(client.status().ready, false);
  assert.equal(await client.probe(), false);
  assert.equal(calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 105));
  assert.equal(await client.probe(), true);
  assert.equal(client.status().ready, true);
  assert.equal(calls, 2);
});

test("Nyra attestation deadline retains the mutation barrier and closes unknown errors", async () => {
  const challenge = {
    schema_version: ATTESTATION_SCHEMA,
    envelope: { tenant_id: "codexai", operation_id: "operation-policy-0001" },
    core_signature: Buffer.alloc(64, 1).toString("base64url"),
  };
  let calls = 0;
  const client = createNyraPolicyRegistryClient({
    env: clientEnv(),
    fetchImpl: async (url) => {
      calls += 1;
      return jsonResponse(url, {
        ok: true,
        attestation: {
          ...challenge,
          nyra_signature: Buffer.alloc(64, 2).toString("base64url"),
        },
      }, { bodyDelayMs: 150 });
    },
  });
  await assert.rejects(client.attest(challenge), /policy_registry_nyra_timeout/);
  await assert.rejects(client.attest(challenge), /policy_registry_nyra_busy/);
  assert.equal(calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(client.status().ready, false);
  assert.equal(client.status().last_failure, "policy_registry_nyra_timeout");

  const serviceKey = clientEnv().CORE_NYRA_POLICY_REGISTRY_NYRA_SERVICE_KEY;
  const closed = createNyraPolicyRegistryClient({
    env: clientEnv(),
    fetchImpl: async () => { throw new Error(`upstream reflected ${serviceKey}`); },
  });
  await assert.rejects(closed.attest(challenge), /policy_registry_nyra_unavailable/);
  assert.equal(JSON.stringify(closed.status()).includes(serviceKey), false);
});

test("owner approval is stable across fresh assertions and bound to owner, request and reference", () => {
  const base = {
    tenantId: "codexai",
    workId: "00000000-0000-4000-8000-000000000001",
    operationId: "operation-policy-0001",
    action: "policy.snapshot.activate",
    ownerSubjectFingerprint: `osf_${"d".repeat(64)}`,
    confirmationReference: "owner-confirmation-0001",
    requestBinding: "nyra_policy_registry_activate\0canonical-request",
  };
  base.bindingHash = crypto.createHash("sha256").update(base.requestBinding).digest("hex");
  const first = derivePolicyRegistryOwnerApprovalHash({ ...base, ownerAssertion: "ocs_first" });
  const freshContext = derivePolicyRegistryOwnerApprovalHash({ ...base, ownerAssertion: "ocs_fresh_issued_at" });
  assert.equal(first, freshContext);
  assert.notEqual(first, derivePolicyRegistryOwnerApprovalHash({
    ...base,
    ownerSubjectFingerprint: `osf_${"e".repeat(64)}`,
  }));
  assert.notEqual(first, derivePolicyRegistryOwnerApprovalHash({
    ...base,
    confirmationReference: "owner-confirmation-0002",
  }));
  const changedRequest = `${base.requestBinding}-changed`;
  assert.notEqual(first, derivePolicyRegistryOwnerApprovalHash({
    ...base,
    requestBinding: changedRequest,
    bindingHash: crypto.createHash("sha256").update(changedRequest).digest("hex"),
  }));
  const changedOperationRequest = base.requestBinding.replace("0001", "0002");
  assert.notEqual(first, derivePolicyRegistryOwnerApprovalHash({
    ...base,
    operationId: "operation-policy-0002",
    requestBinding: changedOperationRequest,
    bindingHash: crypto.createHash("sha256").update(changedOperationRequest).digest("hex"),
  }));
  assert.throws(() => derivePolicyRegistryOwnerApprovalHash({
    ...base,
    bindingHash: "f".repeat(64),
  }), /policy_registry_owner_binding_invalid/);
});

test("coordinator sequences prepare, Nyra, issue and store and reconciles only server proof", async () => {
  const sequence = [];
  const requestBinding = "nyra_policy_registry_rollback\0canonical-request";
  const bindingHash = crypto.createHash("sha256").update(requestBinding).digest("hex");
  const envelope = {
    schema_version: ATTESTATION_SCHEMA,
    tenant_id: "codexai",
    work_id: "00000000-0000-4000-8000-000000000001",
    preflight_id: "preflight-policy-0001",
    intent_digest: "1".repeat(64),
    operation_id: "rollback-operation-0001",
    action: "policy.snapshot.rollback",
    snapshot_digest: "2".repeat(64),
    domain_pack_id: "generic",
    owner_approval_hash: "3".repeat(64),
    nonce: "nonce-value",
    issued_at: "2026-08-10T10:00:00.000Z",
    expires_at: "2026-08-10T10:05:00.000Z",
    core_key_id: "core-policy-key-v2",
    nyra_key_id: "nyra-policy-key-v2",
    core_public_key_fingerprint: "a".repeat(64),
    nyra_public_key_fingerprint: "b".repeat(64),
  };
  const proofService = {
    async prepare(input) {
      sequence.push("prepare");
      envelope.intent_digest = input.intent_digest;
      envelope.owner_approval_hash = input.owner_approval_hash;
      return { schema_version: ATTESTATION_SCHEMA, envelope: structuredClone(envelope), core_signature: "A".repeat(86) };
    },
    async issue() { sequence.push("issue"); return { receipt_id: "receipt-0001", idempotent_replay: false }; },
    async reconcile() {
      sequence.push("proof-reconcile");
      return {
        status: "consumed",
        receipt: { receipt_id: "receipt-0001" },
        binding: {
          tenant_id: envelope.tenant_id, operation_id: envelope.operation_id,
          action: envelope.action, operation: "rollback_policy_snapshot", work_id: envelope.work_id,
          preflight_id: envelope.preflight_id, intent_digest: envelope.intent_digest,
          domain_pack_id: envelope.domain_pack_id, snapshot_digest: envelope.snapshot_digest,
          owner_approval_hash: envelope.owner_approval_hash, core_key_id: envelope.core_key_id,
          nyra_key_id: envelope.nyra_key_id,
          core_public_key_fingerprint: envelope.core_public_key_fingerprint,
          nyra_public_key_fingerprint: envelope.nyra_public_key_fingerprint,
        },
      };
    },
    async reconcileConsumption() { sequence.push("consumption"); return { consumed: true }; },
    async status() { return { ready: true }; },
  };
  const registryStore = {
    async activate() {},
    async rollback(input) {
      sequence.push("store");
      assert.equal(input.core_receipt.receipt_id, "receipt-0001");
      assert.equal(input.proof_binding.work_id, envelope.work_id);
      return { rolled_back: true, snapshot_digest: input.target_snapshot_digest };
    },
    async reconcile(input) {
      sequence.push("store-reconcile");
      assert.equal(input.operation, "rollback_policy_snapshot");
      return { reconciled: true, snapshot_digest: input.snapshot_digest };
    },
    async status() { return { ready: true, backend: "postgresql", restart_durable: true, distributed: true }; },
  };
  const nyraClient = {
    async attest(challenge) { sequence.push("nyra"); return { ...challenge, nyra_signature: "B".repeat(86) }; },
    async probe() { return true; },
    status() { return { ready: true, upstream_verified: true }; },
  };
  const coordinator = createNyraPolicyRegistryCoordinator({ proofService, registryStore, nyraClient });
  const result = await coordinator.rollback({
    tenant_id: envelope.tenant_id,
    work_id: envelope.work_id,
    operation_id: envelope.operation_id,
    preflight_id: envelope.preflight_id,
    domain_pack_id: envelope.domain_pack_id,
    target_snapshot_digest: envelope.snapshot_digest,
    authorization_digest: "4".repeat(64),
    owner_subject_fingerprint: `osf_${"d".repeat(64)}`,
    owner_binding_hash: bindingHash,
    confirmation_reference: "owner-confirmation-0001",
    owner_request_binding: requestBinding,
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
  });
  assert.equal(result.rolled_back, true);
  assert.deepEqual(sequence, ["prepare", "nyra", "issue", "store"]);
  await assert.rejects(coordinator.reconcile({
    tenant_id: envelope.tenant_id,
    operation_id: envelope.operation_id,
    expected_work_id: "00000000-0000-4000-8000-000000000099",
    receipt: { forged: true },
  }), /policy_proof_work_binding_invalid/);
  const reconciled = await coordinator.reconcile({
    tenant_id: envelope.tenant_id,
    operation_id: envelope.operation_id,
    expected_work_id: envelope.work_id,
    receipt: { forged: true },
  });
  assert.equal(reconciled.reconciled, true);
  assert.deepEqual(sequence.slice(-3), ["proof-reconcile", "consumption", "store-reconcile"]);
});
