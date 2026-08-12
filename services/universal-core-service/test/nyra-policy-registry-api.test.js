import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";
import { derivePolicyRegistryOwnerApprovalHash } from "../src/nyraPolicyRegistryCoordinator.js";
import { DTT_WORK_CONTEXT_HEADER, issueDttWorkContext } from "../../shared/dtt-work-context.js";

const TENANT = "tenant-policy-registry";
const WORK_A = "11111111-1111-4111-8111-111111111111";
const WORK_B = "22222222-2222-4222-8222-222222222222";
const GATEWAY_KEY = "policy-registry-mcp-gateway-key-01234567890123456789";
const TENANT_SECRET = "policy-registry-tenant-context-secret-01234567890123456789";
const OWNER_SECRET = "policy-registry-owner-context-secret-01234567890123456789";
const WORK_SECRET = "policy-registry-dtt-work-secret-01234567890123456789";
const OWNER_SUBJECT = `osf_${"a".repeat(64)}`;
const CATALOG_DIGEST = "7".repeat(64);
const TRUST_CATALOG_DIGEST = "8".repeat(64);
const PROVENANCE_DIGEST = "9".repeat(64);

const PURPOSE = Object.freeze({
  activate: "nyra_policy_registry_snapshot_activate_v3",
  rollback: "nyra_policy_registry_snapshot_rollback_v3",
  reconcile: "nyra_policy_registry_snapshot_reconcile_v3",
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, stable(value[key])]));
}

function policySnapshot() {
  const timestamp = Date.now();
  const body = {
    schema_version: "nyra_policy_registry_v1",
    tenant_id: TENANT,
    domain_pack_id: "generic",
    ancestry: [
      {
        pack_id: "core/invariants",
        version: "1.0.0",
        digest: "5".repeat(64),
        scope: { kind: "core", value: "universal-core", tenant_id: null },
      },
      {
        pack_id: "tenant/policy-registry",
        version: "1.0.0",
        digest: "6".repeat(64),
        scope: { kind: "action", value: "policy.snapshot.activate", tenant_id: TENANT },
      },
    ],
    leaf_packs: [{
      pack_id: "tenant/policy-registry",
      version: "1.0.0",
      digest: "6".repeat(64),
    }],
    policy: {
      allow_actions: ["policy.snapshot.activate"],
      deny_actions: [],
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
      valid_from: new Date(timestamp - 60_000).toISOString(),
      expires_at: new Date(timestamp + 3_600_000).toISOString(),
    },
    resolution: {
      logical_depth: 2,
      traversal_budget: 256,
      traversed: 2,
      catalog_depth_policy: "no_static_ceiling",
      runtime_policy: "bounded_fail_closed",
    },
    immutable: true,
  };
  return {
    ...body,
    snapshot_digest: crypto.createHash("sha256")
      .update(JSON.stringify(stable(body)))
      .digest("hex"),
  };
}

function recalculateSnapshotDigest(snapshot) {
  const body = structuredClone(snapshot);
  delete body.snapshot_digest;
  return {
    ...body,
    snapshot_digest: crypto.createHash("sha256")
      .update(JSON.stringify(stable(body)))
      .digest("hex"),
  };
}

function compilerInput(overrides = {}) {
  return {
    schema_version: "nyra_policy_compiler_input_v1",
    leaf_pack_ids: ["tenant/policy-registry@1.0.0"],
    packs: [{ test_fixture: "public-policy-pack-bundle" }],
    ...overrides,
  };
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
    compiler_build_commit: "a".repeat(40),
    catalog_digest: CATALOG_DIGEST,
    trust_catalog_digest: TRUST_CATALOG_DIGEST,
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

function proofLifecycleStatus(overrides = {}) {
  return {
    ready: true,
    backend: "postgresql",
    proof_schema_version: "nyra_policy_registry_proof_v3",
    attestation_schema_version: "nyra_policy_activation_attestation_v3",
    receipt_schema_version: "core_policy_activation_receipt_v3",
    compiler_provenance_binding_required: true,
    ...overrides,
  };
}

function staticCompilerVerifier(overrides = {}) {
  return {
    status() { return compilerStatus(overrides); },
    verify(input) { return compilerProvenance(input.snapshot); },
    verifyPersistedRecord(_record, binding) {
      return compilerRecordVerification({ snapshot_digest: binding.snapshot_digest });
    },
  };
}

function compilerProvenance(snapshot) {
  return {
    schema_version: "nyra_policy_compiler_provenance_v1",
    tenant_id: TENANT,
    domain_pack_id: "generic",
    snapshot_digest: snapshot.snapshot_digest,
    provenance_digest: PROVENANCE_DIGEST,
    compiler_build_commit: "a".repeat(40),
    catalog_digest: CATALOG_DIGEST,
    trust_catalog_digest: TRUST_CATALOG_DIGEST,
    execution_authorized: false,
  };
}

function compilerRecordVerification(snapshot, overrides = {}) {
  return {
    ok: true,
    record_integrity_verified: true,
    derivation_reverified: false,
    tenant_id: TENANT,
    domain_pack_id: "generic",
    snapshot_digest: snapshot.snapshot_digest,
    compiler_provenance_digest: PROVENANCE_DIGEST,
    compiler_build_commit: "a".repeat(40),
    catalog_digest: CATALOG_DIGEST,
    trust_catalog_digest: TRUST_CATALOG_DIGEST,
    execution_authorized: false,
    error: null,
    ...overrides,
  };
}

function trustCatalogFixture(overrides = {}) {
  return {
    schema_version: "nyra_policy_pack_trust_catalog_v1",
    issuers: [
      {
        issuer_id: "core-issuer",
        key_id: "core-key",
        role: "core",
        algorithm: "Ed25519",
        public_key: "ZmFrZS1wdWJsaWMta2V5LWNvcmU=",
        public_key_fingerprint: "1".repeat(64),
      },
      {
        issuer_id: "nyra-issuer",
        key_id: "nyra-key",
        role: "nyra",
        algorithm: "Ed25519",
        public_key: "ZmFrZS1wdWJsaWMta2V5LW55cmE=",
        public_key_fingerprint: "2".repeat(64),
      },
    ],
    trusted_core_pack_digests: ["3".repeat(64)],
    known_core_branch_ids: ["nyra_policy_registry"],
    known_nyra_branch_ids: ["risk_governance"],
    known_domain_pack_ids: ["generic"],
    ...overrides,
  };
}

function tenantContext() {
  const context = {
    version: "mcp_tenant_context_v1",
    tenant_id: TENANT,
    issued_at: new Date().toISOString(),
  };
  return Buffer.from(JSON.stringify({
    ...context,
    assertion: `mtc_${crypto.createHmac("sha256", TENANT_SECRET)
      .update(`mcp-tenant-context\0${JSON.stringify(context)}`)
      .digest("hex")}`,
  })).toString("base64url");
}

function ownerContext(body, purpose, { issuedAt, ownerSubject = OWNER_SUBJECT } = {}) {
  const { owner_context: _ownerContext, ...payload } = body;
  const binding = `${purpose}\0${JSON.stringify(stable(payload))}`;
  const context = {
    assertion_version: "owner_context_assertion_v1",
    audience: "nira_core_bridge",
    tenant_id: TENANT,
    access_mode: "god_mode",
    role: "owner_root",
    delegated_actor: "policy_registry_api_test",
    owner_verified: true,
    owner_subject_fingerprint: ownerSubject,
    issued_at: issuedAt || new Date().toISOString(),
    binding_version: "owner_request_binding_v1",
    binding_hash: crypto.createHash("sha256").update(binding).digest("hex"),
  };
  const canonical = JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
    owner_subject_fingerprint: context.owner_subject_fingerprint,
    issued_at: context.issued_at,
    binding_version: context.binding_version,
    binding_hash: context.binding_hash,
    approval_digest: undefined,
  });
  return {
    ...context,
    assertion: `ocs_${crypto.createHmac("sha256", OWNER_SECRET)
      .update(`owner-context\0${canonical}`)
      .digest("hex")}`,
  };
}

function preflight(kind, domainPackId = "generic") {
  return {
    schema_version: "skinharmony_work_preflight_v1",
    preflight_id: `preflight-policy-${kind}-0001`,
    mandatory: true,
    tenant_id: TENANT,
    operational_surface: "tenant_work_gallery",
    tenant_work_gallery: {
      schema_version: "tenant_work_gallery_v1",
      tenant_id: TENANT,
      available: true,
      state: "ready",
    },
    memory_first: { status: "recalled" },
    governance: { execution_allowed_by_preflight: false },
    security_governance: {
      schema_version: "nyra_core_security_gate_v1",
      always_on: true,
      fail_closed: true,
      core_verdict_required: true,
      source_instructions_are_data: true,
      cross_tenant_blocked: true,
    },
    request: { operation_type: `policy.snapshot.${kind}` },
    domain_pack: { id: domainPackId },
  };
}

const presence = Object.freeze({
  agent_id: "policy-registry-mcp",
  session_id: "policy-registry-session",
  session_fingerprint: "b".repeat(64),
  host_transport_session_fingerprint: "c".repeat(64),
  signature: `ags_${"d".repeat(32)}`,
  opaque_agent_id: `ai_${"e".repeat(32)}`,
  actor_provenance: `ap_${"f".repeat(32)}`,
  client_type: "codex",
  transport_bound: true,
});

function dttToken(pathname, body, workId = WORK_A) {
  const now = Date.now();
  return issueDttWorkContext({
    secret: WORK_SECRET,
    tenant_id: TENANT,
    work_id: workId,
    lease_binding: {
      schema_version: "dtt_work_lease_binding_v1",
      tenant_id: TENANT,
      work_id: workId,
      lease_id: "33333333-3333-4333-8333-333333333333",
      expires_at: new Date(now + 120_000).toISOString(),
      participant_expires_at: new Date(now + 120_000).toISOString(),
      session_id: presence.session_id,
      agent_id: presence.agent_id,
      client_type: presence.client_type,
      session_fingerprint: presence.session_fingerprint,
      host_transport_session_fingerprint: presence.host_transport_session_fingerprint,
      presence_signature: presence.signature,
      opaque_agent_id: presence.opaque_agent_id,
      actor_provenance: presence.actor_provenance,
      execution_authorized: false,
    },
    agent_presence: presence,
    method: "POST",
    path: pathname,
    body,
    now_ms: now,
  });
}

function operationBody(kind, overrides = {}) {
  const common = {
    tenant_id: TENANT,
    work_id: WORK_A,
    operation_id: `${kind}-operation-0001`,
    work_preflight: preflight(kind),
    owner_confirmed: true,
    confirmation_reference: `${kind}-owner-confirmation-0001`,
  };
  const body = kind === "activate"
    ? {
        ...common,
        domain_pack_id: "generic",
        snapshot: policySnapshot(),
        compiler_input: compilerInput(),
      }
    : kind === "rollback"
      ? { ...common, domain_pack_id: "generic", target_snapshot_digest: "2".repeat(64) }
      : common;
  return { ...body, ...overrides };
}

function createUnexpectedQueryPool() {
  return {
    async query() {
      throw new Error("policy_registry_test_pool_query_unexpected");
    },
  };
}

function createUnreadDependency(onAccess, message) {
  const fail = () => {
    onAccess();
    throw new Error(message);
  };
  return new Proxy(function unreadDependency() { fail(); }, {
    apply: fail,
    construct: fail,
    get: fail,
    getOwnPropertyDescriptor: fail,
    ownKeys: fail,
    set: fail,
  });
}

async function startFixture({
  proofRequired = true,
  coordinatorReady = true,
  compilerReady = true,
  proofStatus = async () => proofLifecycleStatus(),
} = {}) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-api-"));
  const calls = {
    status: 0,
    proof: 0,
    outbound: 0,
    persist: 0,
    activate: [],
    rollback: [],
    reconcile: [],
    compilerVerify: [],
    compilerRecordVerify: [],
  };
  let activationError = null;
  let compilerError = null;
  let compilerRecordVerificationOverrides = {};
  let compilerRecordVerificationTransform = (value) => value;
  const coordinator = {
    async status() {
      calls.status += 1;
      calls.outbound += 1;
      return {
        ready: coordinatorReady,
        e2e_verified: coordinatorReady,
        upstream: { ready: coordinatorReady, upstream_verified: coordinatorReady },
      };
    },
    async activate(input) {
      calls.activate.push(structuredClone(input));
      calls.proof += 1;
      calls.outbound += 1;
      calls.persist += 1;
      if (activationError) throw activationError;
      return {
        activated: true,
        snapshot_digest: input.snapshot.snapshot_digest,
        operation_id: input.operation_id,
        work_id: input.work_id,
        preflight_id: input.preflight_id,
        intent_digest: "3".repeat(64),
        compiler_provenance_digest: PROVENANCE_DIGEST,
        proof_status: "consumed",
        idempotent_replay: calls.activate.length > 1,
        receipt: { signature: "must-not-leak" },
        activation_attestation: { nyra_signature: "must-not-leak" },
        secret: "must-not-leak",
        execution_authorized: true,
        caller_authority: true,
      };
    },
    async rollback(input) {
      calls.rollback.push(structuredClone(input));
      return {
        rolled_back: true,
        snapshot_digest: input.target_snapshot_digest,
        activation_generation: 2,
        idempotent_replay: false,
        proof_status: "consumed",
        compiler_provenance_digest: PROVENANCE_DIGEST,
      };
    },
    async reconcile(input) {
      calls.reconcile.push(structuredClone(input));
      return {
        reconciled: true,
        snapshot_digest: "4".repeat(64),
        idempotent_replay: true,
        proof_status: "consumed",
        compiler_provenance_digest: PROVENANCE_DIGEST,
      };
    },
  };
  const registryStore = {
    evaluate: () => ({ verdict: "DENY", reasons: ["policy_snapshot_missing"], snapshot_present: false }),
    async status() {
      return {
        configured: true,
        backend: "postgresql",
        restart_durable: true,
        distributed: true,
        compiler_provenance_persistence: true,
        compiler_input_persisted: false,
        state: "ready",
        ready: true,
      };
    },
    async activate() {}, async rollback() {}, async resolveRollbackTarget() {}, async reconcile() {},
  };
  const proofService = { status: proofStatus };
  const client = { async probe() { return true; }, status() { return { ready: true, upstream_verified: true }; } };
  const signer = {
    algorithm: "Ed25519", custody: "external_remote_signer", key_id: "core-key",
    public_key: crypto.generateKeyPairSync("ed25519").publicKey,
    async signPayload() {}, async probe() { return true; }, health() { return { signer_state: "ready" }; },
  };
  const compilerVerifier = {
    status() {
      return compilerStatus({
        ready: compilerReady,
        clock_ready: compilerReady,
        error: compilerReady ? null : "policy_compiler_clock_unavailable",
      });
    },
    verify(input) {
      calls.compilerVerify.push(structuredClone(input));
      if (compilerError) throw compilerError;
      return compilerProvenance(input.snapshot);
    },
    verifyPersistedRecord(record, binding) {
      calls.compilerRecordVerify.push({
        record: structuredClone(record),
        binding: structuredClone(binding),
      });
      if (compilerError) throw compilerError;
      return compilerRecordVerificationTransform(compilerRecordVerification(
        { snapshot_digest: binding.snapshot_digest },
        compilerRecordVerificationOverrides,
      ));
    },
  };
  const { app } = createUniversalCoreService({
    storageRoot,
    mcpTenantGatewayKey: GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_SECRET,
    ownerContextSigningSecret: OWNER_SECRET,
    dttAgentIdentitySigningSecret: WORK_SECRET,
    nyraPolicyRegistryProofEnabled: true,
    nyraPolicyRegistryProofRequired: proofRequired,
    nyraPolicyRegistryCompilerProvenanceEnabled: true,
    nyraPolicyRegistryCompilerProvenanceRequired: true,
    nyraPolicyRegistryCompilerProvenanceMode: "core_deterministic_recompile",
    nyraPolicyRegistryCompilerCatalogDigest: CATALOG_DIGEST,
    nyraPolicyRegistryCompilerTrustCatalogDigest: TRUST_CATALOG_DIGEST,
    nyraPolicyRegistryCompilerProvenanceVerifier: compilerVerifier,
    nyraPolicyRegistryCoreSignerMode: "remote",
    nyraPolicyRegistryPostgresPool: createUnexpectedQueryPool(),
    nyraPolicyRegistryCoreSigner: signer,
    nyraPolicyRegistryProofService: proofService,
    nyraPolicyRegistryStore: registryStore,
    nyraPolicyRegistryClient: client,
    nyraPolicyRegistryCoordinator: coordinator,
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function send(kind, body, { tokenWorkId = WORK_A, includeToken = true } = {}) {
    const pathname = `/v1/nyra-policy-registry/${kind}`;
    const headers = {
      authorization: `Bearer ${GATEWAY_KEY}`,
      "content-type": "application/json",
      "x-sh-tenant-id": TENANT,
      "x-sh-tenant-context": tenantContext(),
    };
    if (includeToken) headers[DTT_WORK_CONTEXT_HEADER] = dttToken(pathname, body, tokenWorkId);
    const response = await fetch(`${base}${pathname}`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  }
  return {
    storageRoot, calls, coordinator, base, server, send,
    setActivationError(error) { activationError = error; },
    setCompilerError(error) { compilerError = error; },
    setCompilerRecordVerificationOverrides(overrides = {}) {
      compilerRecordVerificationOverrides = overrides;
    },
    setCompilerRecordVerificationTransform(transform = (value) => value) {
      compilerRecordVerificationTransform = transform;
    },
  };
}

function withOwner(kind, body, options) {
  return { ...body, owner_context: ownerContext(body, PURPOSE[kind], options) };
}

test("Policy Registry routes bind gateway, DTT Work, stable owner approval and false authority", async () => {
  const fixture = await startFixture();
  try {
    const healthResponse = await fetch(`${fixture.base}/healthz`);
    const health = await healthResponse.json();
    assert.equal(health.nyra_policy_registry.proof_lifecycle.ready, true);
    assert.equal(health.nyra_policy_registry.proof_e2e.e2e_verified, true);
    assert.equal(health.nyra_policy_registry.compiler_provenance.ready, true);
    assert.equal(health.nyra_policy_registry.compiler_provenance.required, true);
    assert.equal(health.nyra_policy_registry.compiler_provenance.compiler_input_persisted, false);
    assert.equal(health.nyra_policy_registry.compiler_provenance_persistence, true);
    assert.equal(health.nyra_policy_registry.compiler_input_persisted, false);
    assert.equal(health.nyra_policy_registry.proof.proof_schema_version,
      "nyra_policy_registry_proof_v3");
    assert.deepEqual(
      Object.keys(health.nyra_policy_registry.compiler_provenance).sort(),
      [
        "enabled", "required", "mode", "configuration_valid", "configured", "ready",
        "state", "render_gate_required", "schema_version", "provenance_schema_version",
        "compiler_algorithm", "verification_algorithm", "traversal_budget",
        "compiler_build_commit", "catalog_digest", "trust_catalog_digest",
        "compiler_input_persisted", "execution_authorized", "error",
      ].sort(),
    );
    assert.equal(fixture.calls.activate.length, 0);

    const baseBody = operationBody("activate");
    const firstBody = withOwner("activate", baseBody, { issuedAt: new Date(Date.now() - 1_000).toISOString() });
    const first = await fixture.send("activate", firstBody);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.authorization.core_final_authority, true);
    assert.equal(first.json.authorization.caller_authority, false);
    assert.equal(first.json.authorization.provider_execution_authorized, false);
    assert.equal(first.json.activation.execution_authorized, false);
    assert.equal(first.json.activation.caller_authority, false);
    assert.equal(first.json.activation.compiler_provenance_digest, PROVENANCE_DIGEST);
    assert.equal(Object.hasOwn(first.json.activation, "receipt"), false);
    assert.equal(Object.hasOwn(first.json.activation, "activation_attestation"), false);
    assert.equal(JSON.stringify(first.json).includes("must-not-leak"), false);
    assert.equal(JSON.stringify(first.json).includes("public-policy-pack-bundle"), false);
    assert.equal(fixture.calls.compilerVerify.length, 1);
    assert.equal(fixture.calls.compilerVerify[0].tenant_id, TENANT);
    assert.deepEqual(fixture.calls.compilerVerify[0].compiler_input, firstBody.compiler_input);
    assert.equal(Object.hasOwn(fixture.calls.activate[0], "compiler_provenance"), false);
    const secondBody = withOwner("activate", baseBody, { issuedAt: new Date().toISOString() });
    const second = await fixture.send("activate", secondBody);
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(fixture.calls.activate.length, 2);
    assert.equal(Object.hasOwn(fixture.calls.activate[0], "owner_assertion"), false);
    const approval = (input) => derivePolicyRegistryOwnerApprovalHash({
      tenantId: input.tenant_id,
      workId: input.work_id,
      operationId: input.operation_id,
      action: "policy.snapshot.activate",
      ownerSubjectFingerprint: input.owner_subject_fingerprint,
      bindingHash: input.owner_binding_hash,
      confirmationReference: input.confirmation_reference,
      requestBinding: input.owner_request_binding,
    });
    assert.equal(approval(fixture.calls.activate[0]), approval(fixture.calls.activate[1]));

    const changedCompilerBase = operationBody("activate", {
      compiler_input: compilerInput({
        packs: [{ test_fixture: "changed-public-policy-pack-bundle" }],
      }),
    });
    const changedCompiler = await fixture.send(
      "activate",
      withOwner("activate", changedCompilerBase),
    );
    assert.equal(changedCompiler.status, 200, JSON.stringify(changedCompiler.json));
    assert.notEqual(
      fixture.calls.activate[0].authorization_digest,
      fixture.calls.activate[2].authorization_digest,
    );
    assert.notEqual(approval(fixture.calls.activate[0]), approval(fixture.calls.activate[2]));

    const rollbackBody = operationBody("rollback");
    const rollback = await fixture.send("rollback", withOwner("rollback", rollbackBody));
    assert.equal(rollback.status, 200, JSON.stringify(rollback.json));
    assert.equal(fixture.calls.rollback[0].work_id, WORK_A);
    assert.equal(rollback.json.rollback.compiler_provenance_digest, PROVENANCE_DIGEST);

    const reconcileBody = operationBody("reconcile");
    const reconciliation = await fixture.send("reconcile", withOwner("reconcile", reconcileBody));
    assert.equal(reconciliation.status, 200, JSON.stringify(reconciliation.json));
    assert.equal(reconciliation.json.reconciliation.compiler_provenance_digest, PROVENANCE_DIGEST);
    assert.deepEqual(fixture.calls.reconcile[0], {
      tenant_id: TENANT,
      operation_id: "reconcile-operation-0001",
      expected_work_id: WORK_A,
    });
    const auditLog = fs.readFileSync(
      path.join(fixture.storageRoot, "audit", "events.jsonl"),
      "utf8",
    );
    assert.equal(auditLog.includes("public-policy-pack-bundle"), false);
    assert.equal(auditLog.includes("must-not-leak"), false);
    assert.equal(auditLog.includes(PROVENANCE_DIGEST), true);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

test("Policy Registry denies caller trust fields, cross-Work and owner tamper before outbound mutation", async () => {
  const fixture = await startFixture();
  try {
    const missingOwner = operationBody("activate", { owner_context: null });
    const beforeStatus = fixture.calls.status;
    const deniedOwner = await fixture.send("activate", missingOwner);
    assert.equal(deniedOwner.status, 403);
    assert.equal(deniedOwner.json.error, "policy_registry_owner_confirmation_required");
    assert.equal(fixture.calls.status, beforeStatus);
    assert.equal(fixture.calls.activate.length, 0);

    const injectedReceiptBase = operationBody("activate", { core_receipt: { forged: true } });
    const injectedReceipt = withOwner("activate", injectedReceiptBase);
    const deniedReceipt = await fixture.send("activate", injectedReceipt);
    assert.equal(deniedReceipt.status, 400);
    assert.equal(deniedReceipt.json.error, "policy_registry_request_schema_invalid");
    assert.equal(fixture.calls.activate.length, 0);

    const injectedTenantBase = operationBody("activate", { tenant_id: "forged-tenant" });
    const deniedTenant = await fixture.send("activate", withOwner("activate", injectedTenantBase));
    assert.equal(deniedTenant.status, 403);
    assert.equal(deniedTenant.json.error, "tenant_scope_denied");

    const crossWorkBase = operationBody("activate", { work_id: WORK_B });
    const crossWork = await fixture.send("activate", withOwner("activate", crossWorkBase), { tokenWorkId: WORK_A });
    assert.equal(crossWork.status, 403);
    assert.equal(crossWork.json.error, "cross_work_task_tree_denied");
    assert.equal(fixture.calls.activate.length, 0);

    const forgedOwnerBase = operationBody("activate");
    const forgedOwner = withOwner("activate", forgedOwnerBase, { ownerSubject: `osf_${"9".repeat(64)}` });
    forgedOwner.owner_context.binding_hash = "8".repeat(64);
    const deniedForgedOwner = await fixture.send("activate", forgedOwner);
    assert.equal(deniedForgedOwner.status, 403);
    assert.equal(deniedForgedOwner.json.error, "policy_registry_owner_confirmation_required");
    assert.equal(fixture.calls.activate.length, 0);

    const callerReconcileBase = operationBody("reconcile", { receipt: { forged: true } });
    const callerReconcile = await fixture.send("reconcile", withOwner("reconcile", callerReconcileBase));
    assert.equal(callerReconcile.status, 400);
    assert.equal(fixture.calls.reconcile.length, 0);

    for (const forbidden of [
      { compiler_input: compilerInput() },
      { compiler_provenance: { forged: true } },
      { compiler_provenance_digest: "f".repeat(64) },
      { trust_catalog: { forged: true } },
      { traversal_budget: 1 },
    ]) {
      const rollbackBase = operationBody("rollback", forbidden);
      const denied = await fixture.send("rollback", withOwner("rollback", rollbackBase));
      assert.equal(denied.status, 400, JSON.stringify(denied.json));
      assert.equal(denied.json.error, "policy_registry_request_schema_invalid");
    }
    assert.equal(fixture.calls.rollback.length, 0);

    const reconcileCompilerBase = operationBody("reconcile", {
      compiler_provenance_digest: "f".repeat(64),
    });
    const reconcileCompiler = await fixture.send(
      "reconcile",
      withOwner("reconcile", reconcileCompilerBase),
    );
    assert.equal(reconcileCompiler.status, 400);
    assert.equal(fixture.calls.reconcile.length, 0);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

test("structurally forged snapshots are denied before proof, outbound or persistence", async () => {
  const fixture = await startFixture();
  try {
    const mutations = [
      (snapshot) => { snapshot.core_receipt = { forged: true }; },
      (snapshot) => { snapshot.raw_customer_secret = "must-not-cross-boundary"; },
      (snapshot) => { snapshot.policy.raw_customer_secret = "nested-extra"; },
      (snapshot) => { snapshot.ancestry[0].scope.structural_extra = true; },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const snapshot = policySnapshot();
      mutate(snapshot);
      const base = operationBody("activate", {
        operation_id: `activate-forged-structure-${index}`,
        snapshot: recalculateSnapshotDigest(snapshot),
      });
      const response = await fixture.send("activate", withOwner("activate", base));
      assert.equal(response.status, 400, JSON.stringify(response.json));
      assert.equal(response.json.error, "policy_registry_snapshot_invalid");
    }
    assert.equal(fixture.calls.status, 0);
    assert.equal(fixture.calls.proof, 0);
    assert.equal(fixture.calls.outbound, 0);
    assert.equal(fixture.calls.persist, 0);
    assert.equal(fixture.calls.activate.length, 0);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

test("invalid compiler bundles and snapshot mismatches stop before proof, Nyra or store", async () => {
  const fixture = await startFixture();
  try {
    const cases = [
      ["policy_compiler_input_invalid", 400],
      ["policy_compiler_snapshot_mismatch", 400],
      ["policy_compiler_clock_unavailable", 503],
    ];
    for (const [code, status] of cases) {
      const body = operationBody("activate", {
        operation_id: `activate-${code}`,
        compiler_input: compilerInput({
          packs: [{ forged_provenance_or_trust: "malicious-public-bundle" }],
        }),
      });
      fixture.setCompilerError(new Error(code));
      const before = {
        status: fixture.calls.status,
        proof: fixture.calls.proof,
        outbound: fixture.calls.outbound,
        persist: fixture.calls.persist,
        activate: fixture.calls.activate.length,
      };
      const response = await fixture.send("activate", withOwner("activate", body));
      assert.equal(response.status, status, JSON.stringify(response.json));
      assert.equal(response.json.error, code);
      assert.equal(fixture.calls.status, before.status);
      assert.equal(fixture.calls.proof, before.proof);
      assert.equal(fixture.calls.outbound, before.outbound);
      assert.equal(fixture.calls.persist, before.persist);
      assert.equal(fixture.calls.activate.length, before.activate);
      assert.equal(JSON.stringify(response.json).includes("malicious-public-bundle"), false);
    }
    fixture.setCompilerError(null);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

test("compiler verification echoes are pinned before authorization or coordinator side effects", async () => {
  const fixture = await startFixture();
  try {
    const cases = [
      { compiler_build_commit: "b".repeat(40) },
      { catalog_digest: "c".repeat(64) },
      { trust_catalog_digest: "d".repeat(64) },
      {
        compiler_build_commit: "b".repeat(40),
        catalog_digest: "c".repeat(64),
        trust_catalog_digest: "d".repeat(64),
      },
    ];
    for (const [index, overrides] of cases.entries()) {
      fixture.setCompilerRecordVerificationOverrides(overrides);
      const body = operationBody("activate", {
        operation_id: `activate-forged-compiler-echo-${index}`,
      });
      const before = {
        status: fixture.calls.status,
        proof: fixture.calls.proof,
        outbound: fixture.calls.outbound,
        persist: fixture.calls.persist,
        activate: fixture.calls.activate.length,
      };
      const response = await fixture.send("activate", withOwner("activate", body));
      assert.equal(response.status, 400, JSON.stringify(response.json));
      assert.equal(response.json.error, "policy_compiler_provenance_invalid");
      assert.equal(fixture.calls.status, before.status);
      assert.equal(fixture.calls.proof, before.proof);
      assert.equal(fixture.calls.outbound, before.outbound);
      assert.equal(fixture.calls.persist, before.persist);
      assert.equal(fixture.calls.activate.length, before.activate);
    }
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

test("compiler verification outcome requires plain own enumerable data descriptors", async () => {
  const fixture = await startFixture();
  let getterCalls = 0;
  try {
    const cases = [
      (value) => Object.assign(Object.create({ forged_authority: true }), value),
      (value) => {
        Object.defineProperty(value, "compiler_build_commit", {
          enumerable: true,
          configurable: true,
          get() {
            getterCalls += 1;
            return "a".repeat(40);
          },
        });
        return value;
      },
      (value) => {
        Object.defineProperty(value, "catalog_digest", {
          ...Object.getOwnPropertyDescriptor(value, "catalog_digest"),
          enumerable: false,
        });
        return value;
      },
      (value) => {
        Object.defineProperty(value, Symbol("forged_authority"), {
          enumerable: true,
          value: true,
        });
        return value;
      },
    ];
    for (const [index, transform] of cases.entries()) {
      fixture.setCompilerRecordVerificationTransform(transform);
      const body = operationBody("activate", {
        operation_id: `activate-non-data-compiler-outcome-${index}`,
      });
      const before = {
        status: fixture.calls.status,
        proof: fixture.calls.proof,
        outbound: fixture.calls.outbound,
        persist: fixture.calls.persist,
        activate: fixture.calls.activate.length,
      };
      const response = await fixture.send("activate", withOwner("activate", body));
      assert.equal(response.status, 400, JSON.stringify(response.json));
      assert.equal(response.json.error, "policy_compiler_provenance_invalid");
      assert.equal(fixture.calls.status, before.status);
      assert.equal(fixture.calls.proof, before.proof);
      assert.equal(fixture.calls.outbound, before.outbound);
      assert.equal(fixture.calls.persist, before.persist);
      assert.equal(fixture.calls.activate.length, before.activate);
    }
    assert.equal(getterCalls, 0);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

test("Policy Registry response and audit use a closed error classifier", async () => {
  const fixture = await startFixture();
  const reflectedSecret = "super-private-service-key-value";
  try {
    fixture.setActivationError(new Error(`policy_registry_${reflectedSecret}`));
    const body = operationBody("activate");
    const response = await fixture.send("activate", withOwner("activate", body));
    assert.equal(response.status, 503);
    assert.equal(response.json.error, "policy_registry_operation_failed");
    assert.equal(JSON.stringify(response.json).includes(reflectedSecret), false);
    const audit = fs.readFileSync(path.join(fixture.storageRoot, "audit", "events.jsonl"), "utf8");
    assert.equal(audit.includes(reflectedSecret), false);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

test("Policy Registry readiness gates only required mode while configuration errors always fail", async () => {
  const codeDark = await appHealth({
    storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-code-dark-health-")),
    nyraPolicyRegistryProofEnabled: false,
    nyraPolicyRegistryProofRequired: false,
    nyraPolicyRegistryCoreSignerMode: "disabled",
    nyraPolicyRegistryCompilerProvenanceEnabled: false,
    nyraPolicyRegistryCompilerProvenanceRequired: false,
    nyraPolicyRegistryCompilerProvenanceMode: "disabled",
  });
  assert.equal(codeDark.status, 200);
  assert.equal(codeDark.json.nyra_policy_registry.compiler_provenance.state, "disabled");
  assert.equal(codeDark.json.nyra_policy_registry.compiler_provenance.render_gate_required, false);

  const optional = await startFixture({ proofRequired: false, coordinatorReady: false });
  try {
    const response = await fetch(`${optional.base}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 200);
    assert.equal(health.render_ready, true);
    assert.equal(health.nyra_policy_registry.proof_lifecycle.required, false);
    assert.equal(health.nyra_policy_registry.proof_lifecycle.ready, false);
  } finally {
    await new Promise((resolve) => optional.server.close(resolve));
  }

  const required = await startFixture({ proofRequired: true, coordinatorReady: false });
  try {
    const response = await fetch(`${required.base}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 503);
    assert.equal(health.render_ready, false);
    assert.equal(health.nyra_policy_registry.proof_lifecycle.required, true);
    assert.equal(health.nyra_policy_registry.proof_lifecycle.ready, false);
  } finally {
    await new Promise((resolve) => required.server.close(resolve));
  }

  const compilerUnavailable = await startFixture({
    proofRequired: false,
    coordinatorReady: false,
    compilerReady: false,
  });
  try {
    const response = await fetch(`${compilerUnavailable.base}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 503);
    assert.equal(health.render_ready, false);
    assert.equal(health.nyra_policy_registry.compiler_provenance.required, true);
    assert.equal(health.nyra_policy_registry.compiler_provenance.ready, false);
    assert.equal(health.nyra_policy_registry.compiler_provenance.render_gate_required, true);
  } finally {
    await new Promise((resolve) => compilerUnavailable.server.close(resolve));
  }

  const proofWithoutCompiler = await appHealth({
    storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-proof-no-compiler-")),
    nyraPolicyRegistryProofEnabled: true,
    nyraPolicyRegistryProofRequired: false,
    nyraPolicyRegistryCoreSignerMode: "remote",
    nyraPolicyRegistryCompilerProvenanceEnabled: false,
    nyraPolicyRegistryCompilerProvenanceRequired: false,
    nyraPolicyRegistryCompilerProvenanceMode: "disabled",
  });
  assert.equal(proofWithoutCompiler.status, 503);
  assert.equal(
    proofWithoutCompiler.json.nyra_policy_registry.proof_lifecycle.error,
    "policy_registry_proof_compiler_provenance_required",
  );
});

test("required lifecycle health follows refreshed proof availability", async () => {
  let proofReady = true;
  let proofStatusCalls = 0;
  const fixture = await startFixture({
    proofRequired: true,
    proofStatus: async () => {
      proofStatusCalls += 1;
      return proofLifecycleStatus({ ready: proofReady });
    },
  });
  try {
    const initialResponse = await fetch(`${fixture.base}/healthz`);
    const initial = await initialResponse.json();
    assert.equal(initialResponse.status, 200);
    assert.equal(initial.nyra_policy_registry.proof_lifecycle.ready, true);
    assert.equal(proofStatusCalls, 1);

    proofReady = false;
    const unavailableResponse = await fetch(`${fixture.base}/healthz`);
    const unavailable = await unavailableResponse.json();
    assert.equal(unavailableResponse.status, 503);
    assert.equal(unavailable.nyra_policy_registry.proof.ready, false);
    assert.equal(unavailable.nyra_policy_registry.proof_lifecycle.ready, false);
    assert.equal(proofStatusCalls, 2);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

async function appHealth(options) {
  const { app } = createUniversalCoreService(options);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    return { status: response.status, json: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("compiler flags, mode, catalog JSON, digests and status fail closed before runtime init", async () => {
  const base = () => ({
    storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-compiler-config-")),
    nyraPolicyRegistryProofEnabled: false,
    nyraPolicyRegistryProofRequired: false,
    nyraPolicyRegistryCoreSignerMode: "disabled",
    nyraPolicyRegistryCompilerProvenanceEnabled: true,
    nyraPolicyRegistryCompilerProvenanceRequired: true,
    nyraPolicyRegistryCompilerProvenanceMode: "core_deterministic_recompile",
    nyraPolicyRegistryCompilerCatalogDigest: CATALOG_DIGEST,
    nyraPolicyRegistryCompilerTrustCatalogDigest: TRUST_CATALOG_DIGEST,
    nyraPolicyRegistryCompilerProvenanceVerifier: staticCompilerVerifier(),
  });
  const cases = [
    [{ nyraPolicyRegistryCompilerProvenanceEnabled: "TRUE" },
      "policy_registry_compiler_enabled_flag_invalid"],
    [{ nyraPolicyRegistryCompilerProvenanceRequired: "TRUE" },
      "policy_registry_compiler_required_flag_invalid"],
    [{
      nyraPolicyRegistryCompilerProvenanceEnabled: false,
      nyraPolicyRegistryCompilerProvenanceRequired: true,
      nyraPolicyRegistryCompilerProvenanceMode: "disabled",
    }, "policy_registry_compiler_required_without_enabled"],
    [{ nyraPolicyRegistryCompilerProvenanceMode: "CORE_DETERMINISTIC_RECOMPILE" },
      "policy_registry_compiler_mode_invalid"],
    [{ nyraPolicyRegistryCompilerProvenanceMode: "disabled" },
      "policy_registry_compiler_mode_binding_invalid"],
    [{ nyraPolicyRegistryCompilerCatalogDigest: "A".repeat(64) },
      "policy_registry_compiler_catalog_digest_invalid"],
    [{ nyraPolicyRegistryCompilerTrustCatalogDigest: "0" },
      "policy_registry_compiler_trust_catalog_digest_invalid"],
    [{
      nyraPolicyRegistryCompilerCatalogDigest: "6".repeat(64),
      nyraPolicyRegistryCompilerProvenanceVerifier: staticCompilerVerifier(),
    }, "policy_registry_compiler_status_invalid"],
    [{
      nyraPolicyRegistryCompilerProvenanceVerifier:
        staticCompilerVerifier({ extra_authority: true }),
    }, "policy_registry_compiler_status_invalid"],
    [{
      nyraPolicyRegistryCompilerProvenanceVerifier:
        staticCompilerVerifier({ independent_key_count: 3 }),
    }, "policy_registry_compiler_status_invalid"],
  ];
  for (const [overrides, expected] of cases) {
    const health = await appHealth({ ...base(), ...overrides });
    assert.equal(health.status, 503, `${expected}:${JSON.stringify(health.json)}`);
    assert.equal(health.json.render_ready, false);
    assert.equal(health.json.nyra_policy_registry.compiler_provenance.error, expected);
  }

  const catalogCases = [
    ["{", "policy_registry_compiler_trust_catalog_json_invalid"],
    [JSON.stringify({ schema_version: "forged" }),
      "policy_registry_compiler_trust_catalog_invalid"],
    [JSON.stringify(trustCatalogFixture({
      issuers: [
        {
          ...trustCatalogFixture().issuers[0],
          public_key: "-----BEGIN PRIVATE KEY-----private-material-----END PRIVATE KEY-----",
        },
        trustCatalogFixture().issuers[1],
      ],
    })), "policy_registry_compiler_trust_catalog_invalid"],
  ];
  for (const [catalogJson, expected] of catalogCases) {
    const options = base();
    delete options.nyraPolicyRegistryCompilerProvenanceVerifier;
    options.nyraPolicyRegistryCompilerTrustCatalogJson = catalogJson;
    const health = await appHealth(options);
    assert.equal(health.status, 503);
    assert.equal(health.json.nyra_policy_registry.compiler_provenance.error, expected);
    assert.equal(JSON.stringify(health.json).includes("private-material"), false);
  }

  const traversal = base();
  delete traversal.nyraPolicyRegistryCompilerProvenanceVerifier;
  traversal.nyraPolicyRegistryCompilerTrustCatalog = trustCatalogFixture();
  traversal.nyraPolicyRegistryCompilerTraversalBudget = "0256";
  const traversalHealth = await appHealth(traversal);
  assert.equal(traversalHealth.status, 503);
  assert.equal(
    traversalHealth.json.nyra_policy_registry.compiler_provenance.error,
    "policy_registry_compiler_traversal_budget_invalid",
  );
});

test("unknown signer configuration errors cannot reflect secrets in health or audit", async () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-config-error-"));
  const reflectedSecret = "signer-super-private-service-token";
  let signerConfigurationReads = 0;
  const proofEnv = {};
  Object.defineProperty(proofEnv, "CORE_NYRA_POLICY_REGISTRY_CORE_KEY_ID", {
    enumerable: true,
    get() {
      signerConfigurationReads += 1;
      throw new Error(`policy_registry_${reflectedSecret}`);
    },
  });
  const options = {
    storageRoot,
    nyraPolicyRegistryProofEnabled: true,
    nyraPolicyRegistryProofRequired: false,
    nyraPolicyRegistryCompilerProvenanceEnabled: true,
    nyraPolicyRegistryCompilerProvenanceRequired: true,
    nyraPolicyRegistryCompilerProvenanceMode: "core_deterministic_recompile",
    nyraPolicyRegistryCompilerCatalogDigest: CATALOG_DIGEST,
    nyraPolicyRegistryCompilerTrustCatalogDigest: TRUST_CATALOG_DIGEST,
    nyraPolicyRegistryCompilerProvenanceVerifier: staticCompilerVerifier(),
    nyraPolicyRegistryCoreSignerMode: "remote",
    nyraPolicyRegistryProofEnv: proofEnv,
    nyraPolicyRegistryPostgresPool: createUnexpectedQueryPool(),
    nyraPolicyRegistryStore: {
      async status() { return { backend: "postgresql", ready: true, restart_durable: true, distributed: true }; },
      evaluate() { return { verdict: "DENY", snapshot_present: false }; },
    },
  };
  const health = await appHealth(options);
  assert.equal(signerConfigurationReads, 1);
  assert.equal(health.status, 503);
  assert.equal(
    health.json.nyra_policy_registry.proof_lifecycle.error,
    "policy_registry_core_signer_configuration_invalid",
  );
  assert.equal(JSON.stringify(health.json).includes(reflectedSecret), false);
  const auditPath = path.join(storageRoot, "audit", "events.jsonl");
  const audit = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf8") : "";
  assert.equal(audit.includes(reflectedSecret), false);
});

test("production compiler is code-dark when disabled and rejects dependency injection with zero initialization", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabase = process.env.GOVERNED_AGENT_DATABASE_URL;
  const previousEvidenceSecret = process.env.CORE_EVIDENCE_SIGNING_SECRET;
  process.env.NODE_ENV = "production";
  process.env.CORE_EVIDENCE_SIGNING_SECRET = "e".repeat(64);
  delete process.env.GOVERNED_AGENT_DATABASE_URL;
  try {
    let codeDarkDependencyAccesses = 0;
    const codeDarkOptions = {
      storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-production-code-dark-")),
      nyraPolicyRegistryProofEnabled: false,
      nyraPolicyRegistryProofRequired: false,
      nyraPolicyRegistryCoreSignerMode: "disabled",
      nyraPolicyRegistryCompilerProvenanceEnabled: false,
      nyraPolicyRegistryCompilerProvenanceRequired: false,
      nyraPolicyRegistryCompilerProvenanceMode: "disabled",
      nyraPolicyRegistryPostgresPool: createUnexpectedQueryPool(),
      nyraPolicyRegistryStore: {
        async status() {
          return { backend: "memory", ready: true, restart_durable: false, distributed: false };
        },
        evaluate() { return { verdict: "DENY", snapshot_present: false }; },
      },
    };
    for (const field of [
      "nyraPolicyRegistryCompilerProvenanceVerifier",
      "nyraPolicyRegistryCompilerTrustCatalog",
      "nyraPolicyRegistryCompilerTrustCatalogJson",
      "nyraPolicyRegistryCompilerNow",
      "nyraPolicyRegistryCompilerTraversalBudget",
      "nyraPolicyRegistryCompilerCatalogDigest",
      "nyraPolicyRegistryCompilerTrustCatalogDigest",
      "nyraPolicyRegistryCoreSigner",
      "nyraPolicyRegistryProofService",
      "nyraPolicyRegistryClient",
      "nyraPolicyRegistryCoordinator",
    ]) {
      codeDarkOptions[field] = createUnreadDependency(
        () => { codeDarkDependencyAccesses += 1; },
        "must_not_read_code_dark",
      );
    }
    const codeDark = await appHealth(codeDarkOptions);
    assert.equal(codeDark.json.nyra_policy_registry.proof_lifecycle.state, "disabled");
    assert.equal(codeDark.json.nyra_policy_registry.proof_lifecycle.error, null);
    assert.equal(codeDark.json.nyra_policy_registry.compiler_provenance.state, "disabled");
    assert.equal(codeDark.json.nyra_policy_registry.compiler_provenance.error, null);
    assert.equal(codeDarkDependencyAccesses, 0);

    let injectionDependencyAccesses = 0;
    const injectionOptions = {
      storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-production-di-")),
      nyraPolicyRegistryProofEnabled: true,
      nyraPolicyRegistryProofRequired: true,
      nyraPolicyRegistryCoreSignerMode: "remote",
      nyraPolicyRegistryCompilerProvenanceEnabled: true,
      nyraPolicyRegistryCompilerProvenanceRequired: true,
      nyraPolicyRegistryCompilerProvenanceMode: "core_deterministic_recompile",
    };
    for (const field of [
      "nyraPolicyRegistryCompilerProvenanceVerifier",
      "nyraPolicyRegistryCompilerTrustCatalog",
      "nyraPolicyRegistryCompilerNow",
      "nyraPolicyRegistryPostgresPool",
      "nyraPolicyRegistryCoreSigner",
      "nyraPolicyRegistryProofService",
      "nyraPolicyRegistryStore",
      "nyraPolicyRegistryClient",
      "nyraPolicyRegistryCoordinator",
    ]) {
      injectionOptions[field] = createUnreadDependency(
        () => { injectionDependencyAccesses += 1; },
        "must_not_initialize_production_di",
      );
    }
    const injectionDenied = await appHealth(injectionOptions);
    assert.equal(injectionDenied.status, 503);
    assert.equal(
      injectionDenied.json.nyra_policy_registry.compiler_provenance.error,
      "policy_registry_compiler_production_injection_forbidden",
    );
    assert.equal(injectionDenied.json.nyra_policy_registry.proof_e2e.e2e_verified, false);
    assert.equal(injectionDependencyAccesses, 0);

    let invalidModeDependencyAccesses = 0;
    const invalidModeOptions = {
      storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-production-mode-")),
      nyraPolicyRegistryProofEnabled: true,
      nyraPolicyRegistryProofRequired: true,
      nyraPolicyRegistryCoreSignerMode: "remote",
      nyraPolicyRegistryCompilerProvenanceEnabled: true,
      nyraPolicyRegistryCompilerProvenanceRequired: true,
      nyraPolicyRegistryCompilerProvenanceMode: "CORE_DETERMINISTIC_RECOMPILE",
    };
    invalidModeOptions.nyraPolicyRegistryPostgresPool = createUnreadDependency(
      () => { invalidModeDependencyAccesses += 1; },
      "must_not_initialize_invalid_config",
    );
    const invalidMode = await appHealth(invalidModeOptions);
    assert.equal(invalidMode.status, 503);
    assert.equal(
      invalidMode.json.nyra_policy_registry.compiler_provenance.error,
      "policy_registry_compiler_mode_invalid",
    );
    assert.equal(invalidModeDependencyAccesses, 0);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDatabase === undefined) delete process.env.GOVERNED_AGENT_DATABASE_URL;
    else process.env.GOVERNED_AGENT_DATABASE_URL = previousDatabase;
    if (previousEvidenceSecret === undefined) delete process.env.CORE_EVIDENCE_SIGNING_SECRET;
    else process.env.CORE_EVIDENCE_SIGNING_SECRET = previousEvidenceSecret;
  }
});
