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

const PURPOSE = Object.freeze({
  activate: "nyra_policy_registry_snapshot_activate_v2",
  rollback: "nyra_policy_registry_snapshot_rollback_v2",
  reconcile: "nyra_policy_registry_snapshot_reconcile_v2",
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
    ? { ...common, domain_pack_id: "generic", snapshot: policySnapshot() }
    : kind === "rollback"
      ? { ...common, domain_pack_id: "generic", target_snapshot_digest: "2".repeat(64) }
      : common;
  return { ...body, ...overrides };
}

async function startFixture({
  proofRequired = true,
  coordinatorReady = true,
  proofStatus = async () => ({ ready: true, backend: "postgresql" }),
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
  };
  let activationError = null;
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
      };
    },
    async reconcile(input) {
      calls.reconcile.push(structuredClone(input));
      return {
        reconciled: true,
        snapshot_digest: "4".repeat(64),
        idempotent_replay: true,
        proof_status: "consumed",
      };
    },
  };
  const registryStore = {
    evaluate: () => ({ verdict: "DENY", reasons: ["policy_snapshot_missing"], snapshot_present: false }),
    async status() {
      return { configured: true, backend: "postgresql", restart_durable: true, distributed: true, state: "ready", ready: true };
    },
    async activate() {}, async rollback() {}, async reconcile() {},
  };
  const proofService = { status: proofStatus };
  const client = { async probe() { return true; }, status() { return { ready: true, upstream_verified: true }; } };
  const signer = {
    algorithm: "Ed25519", custody: "external_remote_signer", key_id: "core-key",
    public_key: crypto.generateKeyPairSync("ed25519").publicKey,
    async signPayload() {}, async probe() { return true; }, health() { return { signer_state: "ready" }; },
  };
  const { app } = createUniversalCoreService({
    storageRoot,
    mcpTenantGatewayKey: GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_SECRET,
    ownerContextSigningSecret: OWNER_SECRET,
    dttAgentIdentitySigningSecret: WORK_SECRET,
    nyraPolicyRegistryProofEnabled: true,
    nyraPolicyRegistryProofRequired: proofRequired,
    nyraPolicyRegistryCoreSignerMode: "remote",
    nyraPolicyRegistryPostgresPool: {},
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
    assert.equal(Object.hasOwn(first.json.activation, "receipt"), false);
    assert.equal(Object.hasOwn(first.json.activation, "activation_attestation"), false);
    assert.equal(JSON.stringify(first.json).includes("must-not-leak"), false);
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

    const rollbackBody = operationBody("rollback");
    const rollback = await fixture.send("rollback", withOwner("rollback", rollbackBody));
    assert.equal(rollback.status, 200, JSON.stringify(rollback.json));
    assert.equal(fixture.calls.rollback[0].work_id, WORK_A);

    const reconcileBody = operationBody("reconcile");
    const reconciliation = await fixture.send("reconcile", withOwner("reconcile", reconcileBody));
    assert.equal(reconciliation.status, 200, JSON.stringify(reconciliation.json));
    assert.deepEqual(fixture.calls.reconcile[0], {
      tenant_id: TENANT,
      operation_id: "reconcile-operation-0001",
      expected_work_id: WORK_A,
    });
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
});

test("required lifecycle health follows refreshed proof availability", async () => {
  let proofReady = true;
  let proofStatusCalls = 0;
  const fixture = await startFixture({
    proofRequired: true,
    proofStatus: async () => {
      proofStatusCalls += 1;
      return { ready: proofReady, backend: "postgresql" };
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

test("unknown signer configuration errors cannot reflect secrets in health or audit", async () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-config-error-"));
  const reflectedSecret = "signer-super-private-service-token";
  const options = {
    storageRoot,
    nyraPolicyRegistryProofEnabled: true,
    nyraPolicyRegistryProofRequired: false,
    nyraPolicyRegistryCoreSignerMode: "remote",
    nyraPolicyRegistryPostgresPool: {},
    nyraPolicyRegistryStore: {
      async status() { return { backend: "postgresql", ready: true, restart_durable: true, distributed: true }; },
      evaluate() { return { verdict: "DENY", snapshot_present: false }; },
    },
  };
  Object.defineProperty(options, "nyraPolicyRegistryCoreSigner", {
    enumerable: true,
    get() { throw new Error(`policy_registry_${reflectedSecret}`); },
  });
  const health = await appHealth(options);
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

test("production proof is code-dark when disabled and rejects unpinned signer or private material with zero initialization", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabase = process.env.GOVERNED_AGENT_DATABASE_URL;
  const previousPrivate = process.env.CORE_NYRA_POLICY_REGISTRY_CORE_PRIVATE_KEY;
  const previousTargetCommit = process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_TARGET_COMMIT;
  const previousEvidenceSecret = process.env.CORE_EVIDENCE_SIGNING_SECRET;
  process.env.NODE_ENV = "production";
  process.env.CORE_EVIDENCE_SIGNING_SECRET = "e".repeat(64);
  delete process.env.GOVERNED_AGENT_DATABASE_URL;
  delete process.env.CORE_NYRA_POLICY_REGISTRY_CORE_PRIVATE_KEY;
  delete process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_TARGET_COMMIT;
  try {
    const codeDark = await appHealth({
      storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-production-code-dark-")),
      nyraPolicyRegistryProofEnabled: false,
      nyraPolicyRegistryProofRequired: false,
      nyraPolicyRegistryCoreSignerMode: "disabled",
    });
    assert.equal(codeDark.json.nyra_policy_registry.proof_lifecycle.state, "disabled");
    assert.equal(codeDark.json.nyra_policy_registry.proof_lifecycle.error, null);

    const missingPin = await appHealth({
      storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-production-no-pin-")),
      nyraPolicyRegistryProofEnabled: true,
      nyraPolicyRegistryProofRequired: true,
      nyraPolicyRegistryCoreSignerMode: "remote",
    });
    assert.equal(missingPin.status, 503);
    assert.equal(
      missingPin.json.nyra_policy_registry.proof_lifecycle.error,
      "policy_registry_core_signer_target_commit_mismatch",
    );
    assert.equal(missingPin.json.nyra_policy_registry.proof_e2e.e2e_verified, false);

    const buildCommit = String(
      process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "",
    ).trim().toLowerCase();
    const mismatchTarget = buildCommit === "f".repeat(40) ? "a".repeat(40) : "f".repeat(40);
    process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_TARGET_COMMIT = mismatchTarget;
    let mismatchCalls = 0;
    const mismatchNever = () => { mismatchCalls += 1; throw new Error("must_not_run"); };
    const mismatch = await appHealth({
      storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-production-pin-mismatch-")),
      nyraPolicyRegistryProofEnabled: true,
      nyraPolicyRegistryProofRequired: true,
      nyraPolicyRegistryCoreSignerMode: "remote",
      nyraPolicyRegistryPostgresPool: { query: mismatchNever, connect: mismatchNever },
      nyraPolicyRegistryCoreSigner: { probe: mismatchNever, health: mismatchNever },
      nyraPolicyRegistryProofService: { status: mismatchNever },
      nyraPolicyRegistryStore: { status: mismatchNever, evaluate: mismatchNever },
      nyraPolicyRegistryClient: { status: mismatchNever, probe: mismatchNever },
      nyraPolicyRegistryCoordinator: { status: mismatchNever },
    });
    assert.equal(mismatch.status, 503);
    assert.equal(
      mismatch.json.nyra_policy_registry.proof_lifecycle.error,
      "policy_registry_core_signer_target_commit_mismatch",
    );
    assert.equal(mismatch.json.nyra_policy_registry.proof_e2e.e2e_verified, false);
    assert.equal(mismatchCalls, 0);
    assert.equal(JSON.stringify(mismatch.json).includes(mismatchTarget), false);

    process.env.CORE_NYRA_POLICY_REGISTRY_CORE_PRIVATE_KEY = "private-material-must-not-be-read";
    let calls = 0;
    const never = () => { calls += 1; throw new Error("must_not_run"); };
    const privateDenied = await appHealth({
      storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "policy-registry-production-private-")),
      nyraPolicyRegistryProofEnabled: true,
      nyraPolicyRegistryProofRequired: true,
      nyraPolicyRegistryCoreSignerMode: "remote",
      nyraPolicyRegistryPostgresPool: { query: never, connect: never },
      nyraPolicyRegistryCoreSigner: { probe: never, health: never },
      nyraPolicyRegistryProofService: { status: never },
      nyraPolicyRegistryStore: { status: never, evaluate: never },
      nyraPolicyRegistryClient: { status: never, probe: never },
      nyraPolicyRegistryCoordinator: { status: never },
    });
    assert.equal(privateDenied.status, 503);
    assert.equal(
      privateDenied.json.nyra_policy_registry.proof_lifecycle.error,
      "policy_registry_core_private_key_forbidden",
    );
    assert.equal(calls, 0);
    assert.equal(JSON.stringify(privateDenied.json).includes("private-material"), false);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDatabase === undefined) delete process.env.GOVERNED_AGENT_DATABASE_URL;
    else process.env.GOVERNED_AGENT_DATABASE_URL = previousDatabase;
    if (previousPrivate === undefined) delete process.env.CORE_NYRA_POLICY_REGISTRY_CORE_PRIVATE_KEY;
    else process.env.CORE_NYRA_POLICY_REGISTRY_CORE_PRIVATE_KEY = previousPrivate;
    if (previousTargetCommit === undefined) {
      delete process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_TARGET_COMMIT;
    } else {
      process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_TARGET_COMMIT = previousTargetCommit;
    }
    if (previousEvidenceSecret === undefined) delete process.env.CORE_EVIDENCE_SIGNING_SECRET;
    else process.env.CORE_EVIDENCE_SIGNING_SECRET = previousEvidenceSecret;
  }
});
