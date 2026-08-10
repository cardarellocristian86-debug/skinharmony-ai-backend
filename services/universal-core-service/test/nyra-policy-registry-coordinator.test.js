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
    version: "0.9.0-research-cortex",
    runtime_kind: "horizontal_neural_branch_runtime",
    domain_pack_resolution: "universal_core_key_metadata_only",
    auth_required: true,
    auth_configured: true,
    storage_persistent: true,
    suite_bridge_configured: true,
    deep_branch_v2_federation: {
      enabled: false,
      configured: false,
      ready: true,
      tenant_allowlist_configured: false,
      persistent_replay_store: true,
      replay_store_healthy: true,
      replay_store_ready: true,
      replay_store_durable: true,
      operational_evaluation_enabled: false,
    },
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
      attestation_schema_version: ATTESTATION_SCHEMA,
      compiler_provenance_binding_required: true,
      error: null,
      ...overrides,
    },
  };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function snapshotFixture(overrides = {}) {
  const packDigest = "8".repeat(64);
  const body = {
    schema_version: "nyra_policy_registry_v1",
    tenant_id: "codexai",
    domain_pack_id: "generic",
    ancestry: [{
      pack_id: "core/invariants",
      version: "1.0.0",
      digest: packDigest,
      scope: { kind: "core", value: "universal-core", tenant_id: null },
    }],
    leaf_packs: [{ pack_id: "core/invariants", version: "1.0.0", digest: packDigest }],
    policy: {
      allow_actions: [],
      deny_actions: ["cross_tenant_access"],
      required_gates: ["core_allow"],
      constraints: {},
    },
    bindings: {
      core_branch_ids: ["nyra_policy_registry"],
      nyra_branch_ids: ["risk_governance"],
      domain_pack_ids: ["generic"],
    },
    sources: ["nist_zero_trust"],
    validity: {
      valid_from: "2026-08-01T00:00:00.000Z",
      expires_at: "2027-08-01T00:00:00.000Z",
    },
    resolution: {
      logical_depth: 1,
      traversal_budget: 256,
      traversed: 1,
      catalog_depth_policy: "no_static_ceiling",
      runtime_policy: "bounded_fail_closed",
    },
    immutable: true,
    ...overrides,
  };
  return { ...body, snapshot_digest: sha256(canonical(body)) };
}

function provenanceFixture(snapshot, overrides = {}) {
  const body = {
    schema_version: "nyra_policy_compiler_provenance_v1",
    compiler_mode: "core_deterministic_recompile",
    compiler_algorithm: "nyra_policy_registry_v1",
    tenant_id: snapshot.tenant_id,
    domain_pack_id: snapshot.domain_pack_id,
    snapshot_digest: snapshot.snapshot_digest,
    leaf_pack_digests: structuredClone(snapshot.leaf_packs),
    ordered_pack_evidence: [{
      pack_id: "core/invariants",
      version: "1.0.0",
      pack_digest: "8".repeat(64),
      scope_kind: "core",
      verification_kind: "trusted_core_digest",
      verified_key_ids: [],
      verified_public_key_fingerprints: [],
      verified_roles: ["core"],
    }],
    core_root_digest: "8".repeat(64),
    catalog_digest: "9".repeat(64),
    trust_catalog_digest: "a".repeat(64),
    compiler_build_commit: "b".repeat(40),
    validity: structuredClone(snapshot.validity),
    resolution: structuredClone(snapshot.resolution),
    execution_authorized: false,
    ...overrides,
  };
  return { ...body, provenance_digest: sha256(canonical(body)) };
}

function compilerStatus(overrides = {}) {
  return {
    schema_version: "nyra_policy_compiler_provenance_status_v1",
    ready: true,
    clock_ready: true,
    mode: "core_deterministic_recompile",
    compiler_algorithm: "nyra_policy_registry_v1",
    verification_algorithm: "sha256_canonical_json+ed25519",
    traversal_budget: 256,
    compiler_build_commit: "b".repeat(40),
    catalog_digest: "9".repeat(64),
    trust_catalog_digest: "a".repeat(64),
    issuer_count: 2,
    independent_key_count: 2,
    trusted_core_pack_digest_count: 1,
    known_core_branch_count: 1,
    known_nyra_branch_count: 1,
    known_domain_pack_count: 1,
    execution_authorized: false,
    error: null,
    ...overrides,
  };
}

function provenanceVerification(provenance, overrides = {}) {
  return {
    ok: true,
    record_integrity_verified: true,
    derivation_reverified: false,
    tenant_id: provenance.tenant_id,
    domain_pack_id: provenance.domain_pack_id,
    snapshot_digest: provenance.snapshot_digest,
    compiler_provenance_digest: provenance.provenance_digest,
    compiler_build_commit: provenance.compiler_build_commit,
    catalog_digest: provenance.catalog_digest,
    trust_catalog_digest: provenance.trust_catalog_digest,
    execution_authorized: false,
    error: null,
    ...overrides,
  };
}

function proofStatus(overrides = {}) {
  return {
    ready: true,
    proof_schema_version: "nyra_policy_registry_proof_v3",
    attestation_schema_version: ATTESTATION_SCHEMA,
    receipt_schema_version: "core_policy_activation_receipt_v3",
    compiler_provenance_binding_required: true,
    ...overrides,
  };
}

function storeStatus(overrides = {}) {
  return {
    ready: true,
    backend: "postgresql",
    restart_durable: true,
    distributed: true,
    compiler_provenance_persistence: true,
    compiler_input_persisted: false,
    ...overrides,
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

  const rootDriftBody = healthBody();
  rootDriftBody.extra_root_authority = true;
  const rootDrift = createNyraPolicyRegistryClient({
    env: clientEnv(),
    fetchImpl: async (url) => jsonResponse(url, rootDriftBody),
  });
  assert.equal(await rootDrift.probe(), false);
  assert.equal(rootDrift.status().last_failure, "policy_registry_nyra_health_binding_invalid");

  const reverseRequired = createNyraPolicyRegistryClient({
    env: clientEnv({ CORE_NYRA_POLICY_REGISTRY_PROOF_REQUIRED: "false" }),
    fetchImpl: async (url) => jsonResponse(url, healthBody()),
  });
  assert.equal(await reverseRequired.probe(), false);

  const legacyAttestation = createNyraPolicyRegistryClient({
    env: clientEnv(),
    fetchImpl: async (url) => jsonResponse(url, healthBody({
      attestation_schema_version: "nyra_policy_activation_attestation_v2",
    })),
  });
  assert.equal(await legacyAttestation.probe(), false);
  assert.equal(legacyAttestation.status().last_failure, "policy_registry_nyra_health_binding_invalid");

  const missingCompilerBinding = healthBody();
  delete missingCompilerBinding.policy_registry_attestation.compiler_provenance_binding_required;
  const legacyBinding = createNyraPolicyRegistryClient({
    env: clientEnv(),
    fetchImpl: async (url) => jsonResponse(url, missingCompilerBinding),
  });
  assert.equal(await legacyBinding.probe(), false);
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
  assert.equal(first, sha256(`nyra-policy-registry-owner-approval-v3\0${canonical({
    tenant_id: base.tenantId,
    work_id: base.workId,
    operation_id: base.operationId,
    action: base.action,
    owner_subject_fingerprint: base.ownerSubjectFingerprint,
    binding_hash: base.bindingHash,
    confirmation_reference: base.confirmationReference,
    request_binding: base.requestBinding,
  })}`));
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

test("activation recompiles before proof/outbound/store and binds provenance into the v2 intent", async () => {
  const sequence = [];
  const snapshot = snapshotFixture();
  const provenance = provenanceFixture(snapshot);
  const compilerInput = { schema_version: "nyra_policy_compiler_input_v1", leaf_pack_ids: [], packs: [] };
  const requestBinding = "nyra_policy_registry_activate\0canonical-request";
  const input = {
    tenant_id: "codexai",
    work_id: "00000000-0000-4000-8000-000000000001",
    operation_id: "activate-operation-0001",
    preflight_id: "preflight-policy-0001",
    domain_pack_id: "generic",
    snapshot,
    compiler_input: compilerInput,
    authorization_digest: "4".repeat(64),
    owner_subject_fingerprint: `osf_${"d".repeat(64)}`,
    owner_binding_hash: sha256(requestBinding),
    confirmation_reference: "owner-confirmation-0001",
    owner_request_binding: requestBinding,
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    now: new Date("2026-08-10T10:00:00.000Z"),
  };
  let prepareInput;
  const proofService = {
    async prepare(value) {
      sequence.push("prepare");
      prepareInput = structuredClone(value);
      return {
        schema_version: ATTESTATION_SCHEMA,
        envelope: {
          schema_version: ATTESTATION_SCHEMA,
          ...structuredClone(value),
          nonce: "nonce-value",
          issued_at: "2026-08-10T10:00:00.000Z",
          expires_at: "2026-08-10T10:05:00.000Z",
          core_key_id: "core-policy-key-v3",
          nyra_key_id: "nyra-policy-key-v3",
          core_public_key_fingerprint: "a".repeat(64),
          nyra_public_key_fingerprint: "b".repeat(64),
        },
        core_signature: "A".repeat(86),
      };
    },
    async issue() {
      sequence.push("issue");
      return { receipt_id: "receipt-0001", idempotent_replay: false };
    },
    async reconcile() {},
    async reconcileConsumption() {},
    async status() { return proofStatus(); },
  };
  const registryStore = {
    async activate(value) {
      sequence.push("store");
      assert.deepEqual(value.compiler_provenance, provenance);
      assert.equal(Object.hasOwn(value, "compiler_input"), false);
      assert.equal(value.proof_binding.compiler_provenance_digest, provenance.provenance_digest);
      return { activated: true, snapshot_digest: snapshot.snapshot_digest };
    },
    async rollback() {},
    async resolveRollbackTarget() {},
    async reconcile() {},
    async status() { return storeStatus(); },
  };
  const nyraClient = {
    async attest(challenge) {
      sequence.push("nyra");
      assert.equal(challenge.envelope.compiler_provenance_digest, provenance.provenance_digest);
      return { ...challenge, nyra_signature: "B".repeat(86) };
    },
    async probe() { return true; },
    status() { return { ready: true, upstream_verified: true }; },
  };
  const compilerProvenanceVerifier = {
    async status() { sequence.push("compiler-status"); return compilerStatus(); },
    async verify(value) {
      sequence.push("compiler-verify");
      assert.deepEqual(value, {
        tenant_id: input.tenant_id,
        domain_pack_id: input.domain_pack_id,
        snapshot,
        compiler_input: compilerInput,
      });
      return provenance;
    },
    async verifyPersistedRecord(record, binding) {
      sequence.push("compiler-record-verify");
      assert.deepEqual(record, provenance);
      assert.deepEqual(binding, {
        tenant_id: input.tenant_id,
        domain_pack_id: input.domain_pack_id,
        snapshot_digest: snapshot.snapshot_digest,
        compiler_provenance_digest: provenance.provenance_digest,
      });
      return provenanceVerification(provenance);
    },
  };
  const coordinator = createNyraPolicyRegistryCoordinator({
    proofService, registryStore, nyraClient, compilerProvenanceVerifier,
  });
  const result = await coordinator.activate(input);
  assert.deepEqual(sequence, [
    "compiler-status", "compiler-verify", "compiler-record-verify",
    "prepare", "nyra", "issue", "store",
  ]);
  assert.equal(result.compiler_provenance_digest, provenance.provenance_digest);
  assert.equal(prepareInput.compiler_provenance_digest, provenance.provenance_digest);
  const ownerApprovalHash = derivePolicyRegistryOwnerApprovalHash({
    tenantId: input.tenant_id,
    workId: input.work_id,
    operationId: input.operation_id,
    action: "policy.snapshot.activate",
    ownerSubjectFingerprint: input.owner_subject_fingerprint,
    bindingHash: input.owner_binding_hash,
    confirmationReference: input.confirmation_reference,
    requestBinding: input.owner_request_binding,
  });
  assert.equal(prepareInput.intent_digest, sha256(`nyra-policy-registry-intent-v2\0${canonical({
    tenant_id: input.tenant_id,
    operation_id: input.operation_id,
    action: "policy.snapshot.activate",
    work_id: input.work_id,
    preflight_id: input.preflight_id,
    domain_pack_id: input.domain_pack_id,
    snapshot_digest: snapshot.snapshot_digest,
    compiler_provenance_digest: provenance.provenance_digest,
    owner_approval_hash: ownerApprovalHash,
    authorization_digest: input.authorization_digest,
    owner_request_binding_digest: sha256(input.owner_request_binding),
  })}`));

  const closedSequence = [];
  const closed = createNyraPolicyRegistryCoordinator({
    proofService: { ...proofService, async prepare() { closedSequence.push("prepare"); } },
    registryStore: { ...registryStore, async activate() { closedSequence.push("store"); } },
    nyraClient: { ...nyraClient, async attest() { closedSequence.push("nyra"); } },
    compilerProvenanceVerifier: {
      async status() { closedSequence.push("compiler-status"); return compilerStatus(); },
      async verify() { closedSequence.push("compiler-verify"); throw new Error("policy_compiler_input_invalid"); },
      async verifyPersistedRecord() { closedSequence.push("compiler-record-verify"); },
    },
  });
  await assert.rejects(closed.activate(input), /policy_compiler_input_invalid/);
  assert.deepEqual(closedSequence, ["compiler-status", "compiler-verify"]);

  const shallowSequence = [];
  const shallow = createNyraPolicyRegistryCoordinator({
    proofService: { ...proofService, async prepare() { shallowSequence.push("prepare"); } },
    registryStore: { ...registryStore, async activate() { shallowSequence.push("store"); } },
    nyraClient: { ...nyraClient, async attest() { shallowSequence.push("nyra"); } },
    compilerProvenanceVerifier: {
      async status() { shallowSequence.push("compiler-status"); return compilerStatus(); },
      async verify() { shallowSequence.push("compiler-verify"); return provenance; },
      async verifyPersistedRecord() {
        shallowSequence.push("compiler-record-verify");
        return { ok: true, record_integrity_verified: true };
      },
    },
  });
  await assert.rejects(shallow.activate(input), /policy_compiler_provenance_invalid/);
  assert.deepEqual(shallowSequence, [
    "compiler-status", "compiler-verify", "compiler-record-verify",
  ]);

  assert.throws(() => createNyraPolicyRegistryCoordinator({
    proofService,
    registryStore,
    nyraClient,
    compilerProvenanceVerifier: { async status() {}, async verify() {} },
  }), /policy_registry_coordinator_dependencies_invalid/);

  const unavailable = createNyraPolicyRegistryCoordinator({
    proofService, registryStore, nyraClient,
    compilerProvenanceVerifier: {
      async status() { return compilerStatus({ ready: false, error: "policy_compiler_clock_unavailable" }); },
      async verify() { throw new Error("must_not_run"); },
      async verifyPersistedRecord() { throw new Error("must_not_run"); },
    },
  });
  await assert.rejects(unavailable.activate(input), /policy_compiler_unavailable/);
});

test("rollback obtains provenance only from the durable target and never persists caller compiler input", async () => {
  const sequence = [];
  const snapshot = snapshotFixture();
  const provenance = provenanceFixture(snapshot);
  const target = { snapshot, attestation: { persisted: true }, compiler_provenance: provenance };
  const requestBinding = "nyra_policy_registry_rollback\0canonical-request";
  const input = {
    tenant_id: "codexai",
    work_id: "00000000-0000-4000-8000-000000000001",
    operation_id: "rollback-operation-0001",
    preflight_id: "preflight-policy-0001",
    domain_pack_id: "generic",
    target_snapshot_digest: snapshot.snapshot_digest,
    authorization_digest: "4".repeat(64),
    owner_subject_fingerprint: `osf_${"d".repeat(64)}`,
    owner_binding_hash: sha256(requestBinding),
    confirmation_reference: "owner-confirmation-0001",
    owner_request_binding: requestBinding,
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    now: new Date("2026-08-10T10:00:00.000Z"),
  };
  let binding;
  const proofService = {
    async prepare(value) {
      sequence.push("prepare");
      assert.equal(value.compiler_provenance_digest, provenance.provenance_digest);
      const envelope = {
        schema_version: ATTESTATION_SCHEMA,
        ...structuredClone(value),
        nonce: "nonce-value",
        issued_at: "2026-08-10T10:00:00.000Z",
        expires_at: "2026-08-10T10:05:00.000Z",
        core_key_id: "core-policy-key-v3",
        nyra_key_id: "nyra-policy-key-v3",
        core_public_key_fingerprint: "a".repeat(64),
        nyra_public_key_fingerprint: "b".repeat(64),
      };
      return { schema_version: ATTESTATION_SCHEMA, envelope, core_signature: "A".repeat(86) };
    },
    async issue() { sequence.push("issue"); return { receipt_id: "receipt-0001", idempotent_replay: false }; },
    async reconcile() {},
    async reconcileConsumption() {},
    async status() { return proofStatus(); },
  };
  const registryStore = {
    async activate() {},
    async resolveRollbackTarget(value) {
      sequence.push("resolve-target");
      assert.deepEqual(value, {
        tenant_id: input.tenant_id,
        target_snapshot_digest: input.target_snapshot_digest,
        domain_pack_id: input.domain_pack_id,
        core_branch_id: input.core_branch_id,
        nyra_branch_id: input.nyra_branch_id,
        now: input.now,
      });
      return structuredClone(target);
    },
    async rollback(value) {
      sequence.push("store");
      binding = value.proof_binding;
      assert.equal(Object.hasOwn(value, "compiler_input"), false);
      assert.equal(Object.hasOwn(value, "compiler_provenance"), false);
      assert.equal(value.proof_binding.compiler_provenance_digest, provenance.provenance_digest);
      return { rolled_back: true, snapshot_digest: value.target_snapshot_digest };
    },
    async reconcile() {},
    async status() { return storeStatus(); },
  };
  const nyraClient = {
    async attest(challenge) { sequence.push("nyra"); return { ...challenge, nyra_signature: "B".repeat(86) }; },
    async probe() { return true; },
    status() { return { ready: true, upstream_verified: true }; },
  };
  const compilerProvenanceVerifier = {
    async verify() { throw new Error("rollback_must_not_recompile"); },
    async verifyPersistedRecord() { throw new Error("rollback_must_not_reverify"); },
    async status() { return compilerStatus(); },
  };
  const coordinator = createNyraPolicyRegistryCoordinator({
    proofService, registryStore, nyraClient, compilerProvenanceVerifier,
  });
  const result = await coordinator.rollback(input);
  assert.equal(result.rolled_back, true);
  assert.equal(result.compiler_provenance_digest, provenance.provenance_digest);
  assert.equal(binding.compiler_provenance_digest, provenance.provenance_digest);
  assert.deepEqual(sequence, ["resolve-target", "prepare", "nyra", "issue", "store"]);

  const before = sequence.length;
  await assert.rejects(coordinator.rollback({
    ...input,
    compiler_input: { schema_version: "nyra_policy_compiler_input_v1" },
  }), /policy_registry_rollback_caller_provenance_denied/);
  assert.equal(sequence.length, before);
  await assert.rejects(coordinator.rollback({
    ...input,
    compiler_provenance_digest: "f".repeat(64),
  }), /policy_registry_rollback_caller_provenance_denied/);
  assert.equal(sequence.length, before);
});

test("reconcile accepts only the v3 proof binding and ignores caller-supplied proof material", async () => {
  const sequence = [];
  const compilerDigest = "e".repeat(64);
  const binding = {
    tenant_id: "codexai",
    operation_id: "rollback-operation-0001",
    action: "policy.snapshot.rollback",
    operation: "rollback_policy_snapshot",
    work_id: "00000000-0000-4000-8000-000000000001",
    preflight_id: "preflight-policy-0001",
    intent_digest: "1".repeat(64),
    domain_pack_id: "generic",
    snapshot_digest: "2".repeat(64),
    compiler_provenance_digest: compilerDigest,
    owner_approval_hash: "3".repeat(64),
    core_key_id: "core-policy-key-v3",
    nyra_key_id: "nyra-policy-key-v3",
    core_public_key_fingerprint: "a".repeat(64),
    nyra_public_key_fingerprint: "b".repeat(64),
  };
  let mutateProofBinding = null;
  let mutateStateEcho = null;
  const proofService = {
    async prepare() {}, async issue() {},
    async reconcile() {
      sequence.push("proof-reconcile");
      const current = structuredClone(binding);
      mutateProofBinding?.(current);
      const state = {
        tenant_id: binding.tenant_id,
        operation_id: binding.operation_id,
        status: "consumed",
        receipt: { receipt_id: "receipt-0001" },
        binding: current,
      };
      mutateStateEcho?.(state);
      return state;
    },
    async reconcileConsumption() { sequence.push("consumption"); return { consumed: true }; },
    async status() { return proofStatus(); },
  };
  const registryStore = {
    async activate() {}, async rollback() {}, async resolveRollbackTarget() {},
    async reconcile(value) {
      sequence.push("store-reconcile");
      assert.deepEqual(value.proof_binding, binding);
      assert.equal(value.snapshot_digest, binding.snapshot_digest);
      return { reconciled: true, snapshot_digest: value.snapshot_digest };
    },
    async status() { return storeStatus(); },
  };
  const nyraClient = {
    async attest() {}, async probe() { return true; },
    status() { return { ready: true, upstream_verified: true }; },
  };
  const coordinator = createNyraPolicyRegistryCoordinator({
    proofService,
    registryStore,
    nyraClient,
    compilerProvenanceVerifier: {
      async verify() {}, async verifyPersistedRecord() {},
      async status() { return compilerStatus(); },
    },
  });
  await assert.rejects(coordinator.reconcile({
    tenant_id: binding.tenant_id,
    operation_id: binding.operation_id,
    expected_work_id: "00000000-0000-4000-8000-000000000099",
  }), /policy_proof_work_binding_invalid/);
  const result = await coordinator.reconcile({
    tenant_id: binding.tenant_id,
    operation_id: binding.operation_id,
    expected_work_id: binding.work_id,
    receipt: { forged: true },
    compiler_provenance_digest: "f".repeat(64),
  });
  assert.equal(result.reconciled, true);
  assert.equal(result.compiler_provenance_digest, compilerDigest);
  assert.deepEqual(sequence.slice(-3), ["proof-reconcile", "consumption", "store-reconcile"]);

  for (const scopedRequest of [
    { tenant_id: "other-tenant", operation_id: binding.operation_id },
    { tenant_id: binding.tenant_id, operation_id: "rollback-operation-9999" },
  ]) {
    const consumptionBefore = sequence.filter((item) => item === "consumption").length;
    const storeBefore = sequence.filter((item) => item === "store-reconcile").length;
    await assert.rejects(coordinator.reconcile({
      ...scopedRequest,
      expected_work_id: binding.work_id,
    }), /policy_proof_reconciliation_scope_invalid/);
    assert.equal(sequence.filter((item) => item === "consumption").length, consumptionBefore);
    assert.equal(sequence.filter((item) => item === "store-reconcile").length, storeBefore);
  }

  for (const mutateEcho of [
    (state) => { state.tenant_id = "other-tenant"; },
    (state) => { state.operation_id = "rollback-operation-9999"; },
  ]) {
    mutateStateEcho = mutateEcho;
    const consumptionBefore = sequence.filter((item) => item === "consumption").length;
    const storeBefore = sequence.filter((item) => item === "store-reconcile").length;
    await assert.rejects(coordinator.reconcile({
      tenant_id: binding.tenant_id,
      operation_id: binding.operation_id,
      expected_work_id: binding.work_id,
    }), /policy_proof_reconciliation_scope_invalid/);
    assert.equal(sequence.filter((item) => item === "consumption").length, consumptionBefore);
    assert.equal(sequence.filter((item) => item === "store-reconcile").length, storeBefore);
  }
  mutateStateEcho = null;

  const adversarialBindings = [
    (value) => { delete value.compiler_provenance_digest; },
    (value) => { value.extra_authority = true; },
    (value) => { value.operation = "activate_policy_snapshot"; },
    (value) => { value.nyra_key_id = value.core_key_id; },
    (value) => { value.nyra_public_key_fingerprint = value.core_public_key_fingerprint; },
  ];
  for (const mutate of adversarialBindings) {
    mutateProofBinding = mutate;
    const before = sequence.filter((item) => item === "store-reconcile").length;
    await assert.rejects(coordinator.reconcile({
      tenant_id: binding.tenant_id,
      operation_id: binding.operation_id,
      expected_work_id: binding.work_id,
    }), /policy_proof_legacy_schema_unsupported/);
    assert.equal(sequence.filter((item) => item === "store-reconcile").length, before);
  }
});

test("coordinator readiness requires proof v3, durable provenance, compiler and exact Nyra health", async () => {
  let proof = proofStatus();
  let store = storeStatus();
  let compiler = compilerStatus();
  const proofService = {
    async prepare() {}, async issue() {}, async reconcile() {},
    async status() { return proof; },
  };
  const registryStore = {
    async activate() {}, async rollback() {}, async resolveRollbackTarget() {}, async reconcile() {},
    async status() { return store; },
  };
  const nyraClient = {
    async attest() {}, async probe() { return true; },
    status() { return { ready: true, upstream_verified: true }; },
  };
  const compilerProvenanceVerifier = {
    async verify() {}, async verifyPersistedRecord() {}, async status() { return compiler; },
  };
  const coordinator = createNyraPolicyRegistryCoordinator({
    proofService, registryStore, nyraClient, compilerProvenanceVerifier,
  });
  const ready = await coordinator.status();
  assert.equal(ready.ready, true);
  assert.equal(ready.e2e_verified, true);
  assert.deepEqual(ready.compiler_provenance, {
    ready: true,
    schema_version: "nyra_policy_compiler_provenance_v1",
    status_schema_version: "nyra_policy_compiler_provenance_status_v1",
    mode: "core_deterministic_recompile",
    compiler_algorithm: "nyra_policy_registry_v1",
    compiler_input_persisted: false,
    execution_authorized: false,
  });
  assert.equal(ready.store.compiler_provenance_persistence, true);
  assert.equal(ready.store.compiler_input_persisted, false);

  proof = proofStatus({ attestation_schema_version: "nyra_policy_activation_attestation_v2" });
  assert.deepEqual(
    [(await coordinator.status()).ready, (await coordinator.status()).e2e_verified],
    [false, false],
  );
  proof = proofStatus();
  for (const drift of [
    { backend: "memory" },
    { restart_durable: false },
    { distributed: false },
    { compiler_provenance_persistence: false },
  ]) {
    store = storeStatus(drift);
    const status = await coordinator.status();
    assert.equal(status.ready, false);
    assert.equal(status.e2e_verified, false);
  }
  store = storeStatus({ compiler_input_persisted: true });
  const inputPersisted = await coordinator.status();
  assert.equal(inputPersisted.ready, false);
  assert.equal(inputPersisted.e2e_verified, false);
  assert.equal(inputPersisted.store.compiler_input_persisted, true);
  assert.equal(inputPersisted.compiler_provenance.compiler_input_persisted, true);
  store = storeStatus();
  const compilerDrifts = [
    { extra_authority: true },
    { ready: false, clock_ready: false, error: "policy_compiler_clock_unavailable" },
    { clock_ready: false },
    { traversal_budget: 257 },
    { issuer_count: 1 },
    { independent_key_count: 1 },
    { issuer_count: 3, independent_key_count: 2 },
    { compiler_build_commit: "not-a-commit" },
    { catalog_digest: "0" },
  ];
  for (const drift of compilerDrifts) {
    compiler = compilerStatus(drift);
    const status = await coordinator.status();
    assert.equal(status.ready, false);
    assert.equal(status.e2e_verified, false);
    assert.equal(status.compiler_provenance.ready, false);
  }
});
