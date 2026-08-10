import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  NYRA_POLICY_PRIMARY_SOURCES,
  POLICY_PACK_SCHEMA_VERSION,
  compilePolicySnapshot,
  createPolicyPackCandidate,
  describeNyraPolicyRegistry,
  evaluatePolicySnapshot,
  policyPackDigest,
  validatePolicyPack,
  validatePolicySnapshot,
} from "../src/nyraPolicyRegistry.js";
import { createNyraPolicyRegistryStore, createPostgresNyraPolicyRegistryStore } from "../src/nyraPolicyRegistryStore.js";
import { createUniversalCoreService } from "../src/app.js";
import { composeBranchContext, deterministicBranchRegistry } from "../branches/index.js";

const NOW = new Date("2026-08-02T12:00:00.000Z");
const coreKeys = crypto.generateKeyPairSync("ed25519");
const nyraKeys = crypto.generateKeyPairSync("ed25519");
const trustedIssuers = {
  core: { public_key: coreKeys.publicKey, role: "core" },
  nyra: { public_key: nyraKeys.publicKey, role: "nyra" },
};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function recalculateSnapshotDigest(snapshot) {
  const body = structuredClone(snapshot);
  delete body.snapshot_digest;
  return {
    ...body,
    snapshot_digest: crypto.createHash("sha256").update(canonical(body)).digest("hex"),
  };
}

function registryProofBinding({ operationId, snapshotDigest, action = "policy.snapshot.activate", overrides = {} }) {
  return {
    tenant_id: "codexai",
    operation_id: operationId,
    action,
    operation: action === "policy.snapshot.activate" ? "activate_policy_snapshot" : "rollback_policy_snapshot",
    work_id: "00000000-0000-4000-8000-000000000001",
    preflight_id: "preflight_policy_registry_0001",
    intent_digest: "a".repeat(64),
    domain_pack_id: "generic",
    snapshot_digest: snapshotDigest,
    owner_approval_hash: "b".repeat(64),
    core_key_id: "core-policy-key-v2",
    nyra_key_id: "nyra-policy-key-v2",
    core_public_key_fingerprint: "c".repeat(64),
    nyra_public_key_fingerprint: "d".repeat(64),
    ...overrides,
  };
}

function registryConsumption(binding, id) {
  return {
    ok: true,
    consumed: true,
    single_use: true,
    signature_verified: true,
    issuer_role: "universal_core",
    ...binding,
    consumption_id: `policy-consumption-${id}`,
  };
}

class FakePolicyRegistryPgPool {
  constructor() {
    this.states = new Map();
    this.operations = new Map();
    this.schemaFailures = 0;
    this.schemaAttempts = 0;
    this.healthFailures = 0;
    this.healthProbeAttempts = 0;
  }
  async query(sql, params = []) { return this.#query(sql, params); }
  async connect() { return { query: (sql, params = []) => this.#query(sql, params), release() {} }; }
  async #query(sql, params) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (q.startsWith("CREATE TABLE")) {
      this.schemaAttempts += 1;
      if (this.schemaFailures > 0) {
        this.schemaFailures -= 1;
        throw new Error("transient schema backend secret");
      }
      return { rowCount: 0, rows: [] };
    }
    if (q === "BEGIN" || q === "COMMIT" || q === "ROLLBACK" || q.startsWith("SELECT pg_advisory")) return { rowCount: 0, rows: [] };
    if (q === "SELECT 1") {
      this.healthProbeAttempts += 1;
      if (this.healthFailures > 0) {
        this.healthFailures -= 1;
        throw new Error("transient health backend secret");
      }
      return { rowCount: 1, rows: [{ "?column?": 1 }] };
    }
    if (q.startsWith("INSERT INTO nyra_policy_registry_state")) {
      if (!this.states.has(params[0])) this.states.set(params[0], { revision: 0, active_snapshot: null, active_attestation: null, history: [], state_status: "ready" });
      return { rowCount: 1, rows: [] };
    }
    if (q.startsWith("SELECT request_digest")) {
      const row = this.operations.get(`${params[0]}:${params[1]}`);
      return { rowCount: row ? 1 : 0, rows: row ? [structuredClone(row)] : [] };
    }
    if (q.startsWith("SELECT revision")) {
      const row = this.states.get(params[0]);
      return { rowCount: row ? 1 : 0, rows: row ? [structuredClone(row)] : [] };
    }
    if (q.startsWith("UPDATE nyra_policy_registry_state SET state_status='pending'")) {
      const row = this.states.get(params[0]);
      if (!row || Number(row.revision) !== Number(params[1])) return { rowCount: 0, rows: [] };
      row.state_status = "pending";
      return { rowCount: 1, rows: [] };
    }
    if (q.startsWith("SELECT active_snapshot")) {
      const row = this.states.get(params[0]);
      return { rowCount: row ? 1 : 0, rows: row ? [structuredClone(row)] : [] };
    }
    if (q.startsWith("UPDATE nyra_policy_registry_state")) {
      const row = this.states.get(params[0]);
      if (!row || Number(row.revision) !== Number(params[4])) return { rowCount: 0, rows: [] };
      this.states.set(params[0], {
        revision: Number(row.revision) + 1,
        active_snapshot: JSON.parse(params[1]),
        active_attestation: JSON.parse(params[2]),
        history: JSON.parse(params[3]),
        state_status: "ready",
      });
      return { rowCount: 1, rows: [] };
    }
    if (q.startsWith("INSERT INTO nyra_policy_registry_operations")) {
      this.operations.set(`${params[0]}:${params[1]}`, {
        request_digest: params[2], receipt_digest: params[3], status: "pending",
        proposed_state: JSON.parse(params[4]), result: {},
      });
      return { rowCount: 1, rows: [] };
    }
    if (q.startsWith("UPDATE nyra_policy_registry_operations SET status='completed'")) {
      const row = this.operations.get(`${params[0]}:${params[1]}`);
      if (!row || row.status !== "pending") return { rowCount: 0, rows: [] };
      row.status = "completed";
      row.result = JSON.parse(params[2]);
      row.consumption_proof = JSON.parse(params[3]);
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected_query:${q}`);
  }
}

function source(sourceId = "cedar_authorization") {
  const registered = NYRA_POLICY_PRIMARY_SOURCES.find((item) => item.source_id === sourceId);
  return {
    source_id: sourceId,
    url: registered.url,
    claim: `Primary evidence for ${sourceId}`,
    reviewed_at: "2026-08-02",
  };
}

const corePack = {
  schema_version: POLICY_PACK_SCHEMA_VERSION,
  pack_id: "core/invariants",
  version: "1.0.0",
  status: "active",
  scope: { kind: "core", value: "universal-core", tenant_id: null },
  parent_refs: [],
  bindings: {
    core_branch_ids: ["nyra_policy_registry"],
    nyra_branch_ids: ["risk_governance"],
    domain_pack_ids: ["generic"],
  },
  privacy: { raw_customer_data_allowed: false, data_classification: "policy_metadata_only" },
  policy: {
    allow_mode: "inherit",
    allow_actions: [],
    deny_actions: ["cross_tenant_access"],
    required_gates: ["core_allow"],
    constraints: {},
  },
  tests: [{ id: "allow", expected: "ALLOW" }, { id: "deny", expected: "DENY" }],
  sources: [source("nist_zero_trust")],
  freshness_sla_days: 365,
  provenance: { builder: "universal-core-binary" },
  valid_from: "2026-08-02T00:00:00.000Z",
  expires_at: "2027-08-02T00:00:00.000Z",
  rollback_to: null,
  compatibility: {},
  trust_mode: "compiled_core",
  signatures: [],
};
corePack.artifact_digest = policyPackDigest(corePack);

function candidate({ action = "new.action", packId = "tenant/codexai/action/new-action" } = {}) {
  return createPolicyPackCandidate({
    pack_id: packId,
    version: "1.0.0",
    scope: { kind: "action", value: action, tenant_id: "codexai" },
    parent_refs: [{
      pack_id: corePack.pack_id,
      version: corePack.version,
      digest: policyPackDigest(corePack),
    }],
    bindings: {
      core_branch_ids: ["nyra_policy_registry"],
      nyra_branch_ids: ["risk_governance"],
      domain_pack_ids: ["generic"],
    },
    policy: {
      allow_actions: [action],
      deny_actions: [`${action}.dangerous`],
      required_gates: ["core_allow"],
    },
    tests: [{ id: "positive", expected: "ALLOW" }, { id: "negative", expected: "DENY" }],
    sources: [source()],
    freshness_sla_days: 365,
    valid_from: "2026-08-02T00:00:00.000Z",
    expires_at: "2027-08-02T00:00:00.000Z",
  });
}

function activate(pack) {
  const signable = { ...pack, status: "active", signatures: [] };
  const payload = Buffer.from(policyPackDigest(signable), "utf8");
  const active = {
    ...signable,
    signatures: [
      { issuer_id: "core", algorithm: "Ed25519", signature: crypto.sign(null, payload, coreKeys.privateKey).toString("base64") },
      { issuer_id: "nyra", algorithm: "Ed25519", signature: crypto.sign(null, payload, nyraKeys.privateKey).toString("base64") },
    ],
  };
  active.artifact_digest = policyPackDigest(active);
  return active;
}

test("policy registry is exposed as an advisory horizontal branch", () => {
  const branch = deterministicBranchRegistry().nyra_policy_registry;
  assert.equal(branch.production_status, "advisory");
  assert.equal(branch.policy_registry.dtt.activation_authority, "universal_core");
  const context = composeBranchContext({
    keyRecord: { tenant_id: "codexai", metadata: { tier: "base" } },
    requestedBranches: ["nyra_policy_registry"],
  });
  assert.equal(context.policy_registry.primary_sources.length, NYRA_POLICY_PRIMARY_SOURCES.length);
});

test("candidate validation is tenant scoped and requires positive and negative tests", () => {
  const pack = candidate();
  assert.equal(validatePolicyPack(pack, { tenant_id: "codexai", now: NOW }).ok, true);
  assert.deepEqual(validatePolicyPack(pack, { tenant_id: "other", now: NOW }).errors, ["cross_tenant_pack_denied"]);
  assert.throws(() => createPolicyPackCandidate({
    ...pack,
    tests: [{ id: "positive", expected: "ALLOW" }],
  }), /positive_and_negative_tests_required/);
});

test("pack validation rejects non-canonical identifiers before snapshot compilation", () => {
  const withDigest = (pack) => ({ ...pack, artifact_digest: policyPackDigest(pack) });
  const upperPack = structuredClone(candidate());
  upperPack.pack_id = "Tenant/CodexAI/Action/New-Action";
  assert.deepEqual(validatePolicyPack(withDigest(upperPack), {
    tenant_id: "codexai", now: NOW,
  }).errors, ["pack_id_invalid"]);

  const upperParent = structuredClone(candidate());
  upperParent.parent_refs[0].pack_id = "CORE/Invariants";
  assert.deepEqual(validatePolicyPack(withDigest(upperParent), {
    tenant_id: "codexai", now: NOW,
  }).errors, ["parent_pack_id_invalid"]);

  const upperSource = structuredClone(candidate());
  upperSource.sources[0].source_id = "Cedar_Authorization";
  upperSource.artifact_digest = policyPackDigest(upperSource);
  assert.deepEqual(validatePolicyPack(upperSource, {
    tenant_id: "codexai", now: NOW,
  }).errors, ["source_id_invalid"]);
  assert.throws(() => compilePolicySnapshot({
    tenant_id: "codexai",
    leaf_pack_ids: [`${upperSource.pack_id}@${upperSource.version}`],
    packs: [corePack, upperSource],
    trusted_issuers: trustedIssuers,
    trusted_core_pack_digests: [policyPackDigest(corePack)],
    domain_pack_id: "generic",
    now: NOW,
  }), /policy_pack_invalid:.*source_id_invalid/);
});

test("compiled snapshot is immutable, deny-wins and default-deny", () => {
  const snapshot = compilePolicySnapshot({
    tenant_id: "codexai",
    leaf_pack_ids: ["tenant/codexai/action/new-action@1.0.0"],
    packs: [corePack, activate(candidate())],
    trusted_issuers: trustedIssuers,
    trusted_core_pack_digests: [policyPackDigest(corePack)],
    domain_pack_id: "generic",
    now: NOW,
  });
  const evaluate = (action) => evaluatePolicySnapshot(snapshot, {
    tenant_id: "codexai",
    action,
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    satisfied_gates: ["core_allow"],
    now: NOW,
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(evaluate("new.action").verdict, "ALLOW");
  assert.deepEqual(evaluate("unknown.action").reasons, ["default_deny"]);
  assert.deepEqual(evaluate("new.action.dangerous").reasons, ["explicit_deny", "default_deny"]);
});

test("registry description forbids autonomous activation", () => {
  const description = describeNyraPolicyRegistry();
  assert.equal(description.dtt.activation_authority, "universal_core");
  assert.equal(description.dtt.missing_branch_mode, "candidate_only");
  assert(description.update_policy.gated.includes("activation"));
});

test("snapshot validation binds immutable digest, tenant, domain and branches", () => {
  const snapshot = compilePolicySnapshot({
    tenant_id: "codexai",
    leaf_pack_ids: ["tenant/codexai/action/new-action@1.0.0"],
    packs: [corePack, activate(candidate())],
    trusted_issuers: trustedIssuers,
    trusted_core_pack_digests: [policyPackDigest(corePack)],
    domain_pack_id: "generic",
    now: NOW,
  });
  assert.equal(validatePolicySnapshot(snapshot, {
    tenant_id: "codexai",
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    domain_pack_id: "generic",
    now: NOW,
  }).ok, true);
  assert.deepEqual(validatePolicySnapshot(snapshot, {
    tenant_id: "attacker",
    core_branch_id: "other",
    nyra_branch_id: "other",
    domain_pack_id: "other",
    now: NOW,
  }).reasons, [
    "cross_tenant_snapshot_denied",
    "core_branch_binding_denied",
    "nyra_branch_binding_denied",
    "domain_pack_binding_denied",
  ]);
  const tampered = JSON.parse(JSON.stringify(snapshot));
  tampered.policy.allow_actions.push("forged.action");
  assert(validatePolicySnapshot(tampered, {
    tenant_id: "codexai",
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    now: NOW,
  }).reasons.includes("invalid_policy_snapshot"));
});

test("snapshot validation enforces the compiler's exact semantic structure", () => {
  const snapshot = compilePolicySnapshot({
    tenant_id: "codexai",
    leaf_pack_ids: ["tenant/codexai/action/new-action@1.0.0"],
    packs: [corePack, activate(candidate())],
    trusted_issuers: trustedIssuers,
    trusted_core_pack_digests: [policyPackDigest(corePack)],
    domain_pack_id: "generic",
    now: NOW,
  });
  const validate = (value) => validatePolicySnapshot(value, {
    tenant_id: "codexai",
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    domain_pack_id: "generic",
    now: NOW,
  });
  assert.equal(validate(snapshot).ok, true);

  const constraintExtension = structuredClone(snapshot);
  constraintExtension.policy.constraints.customer_region = {
    allowed: ["eu", "it"],
    strict: true,
  };
  assert.equal(validate(recalculateSnapshotDigest(constraintExtension)).ok, true);

  const mutations = [
    (value) => { value.schema_version = "nyra_policy_registry_v999"; },
    (value) => { value.core_receipt = { forged: true }; },
    (value) => { value.raw_customer_secret = "must-never-be-accepted"; },
    (value) => { value.policy.raw_customer_secret = "nested-extra"; },
    (value) => { value.ancestry[0].scope.structural_extra = true; },
    (value) => { value.sources = []; },
    (value) => { value.sources = ["unregistered_policy_source"]; },
    (value) => { value.ancestry[0].scope.kind = "global"; },
    (value) => { value.policy.required_gates = ["z_gate", "a_gate"]; },
    (value) => { value.leaf_packs[0].digest = "e".repeat(64); },
    (value) => { value.resolution.logical_depth += 1; },
    (value) => { value.resolution.traversed = value.resolution.traversal_budget + 1; },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(snapshot);
    mutate(forged);
    const result = validate(recalculateSnapshotDigest(forged));
    assert.equal(result.ok, false);
    assert(result.reasons.includes("invalid_policy_snapshot"));
  }
});

test("registry activation is Core-receipt-bound, atomic, idempotent and deny-only", () => {
  const snapshot = compilePolicySnapshot({
    tenant_id: "codexai",
    leaf_pack_ids: ["tenant/codexai/action/new-action@1.0.0"],
    packs: [corePack, activate(candidate())],
    trusted_issuers: trustedIssuers,
    trusted_core_pack_digests: [policyPackDigest(corePack)],
    domain_pack_id: "generic",
    now: NOW,
  });
  const consumed = new Set();
  const firstBinding = registryProofBinding({
    operationId: "activate-00000001",
    snapshotDigest: snapshot.snapshot_digest,
  });
  assert.throws(() => createNyraPolicyRegistryStore().activate({
    tenant_id: "codexai",
    operation_id: "unsigned-activation",
    snapshot,
    activation_attestation: { proof: "missing-verifier" },
    proof_binding: registryProofBinding({
      operationId: "unsigned-activation",
      snapshotDigest: snapshot.snapshot_digest,
    }),
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    domain_pack_id: "generic",
    now: NOW,
  }), /policy_snapshot_signature_quorum_invalid/);
  const store = createNyraPolicyRegistryStore({
    verifyActivationSnapshot: (value, binding) => ({
      ok: true,
      signature_verified: true,
      tenant_id: binding.tenant_id,
      snapshot_digest: value.snapshot_digest,
      verified_roles: ["core", "nyra"],
      independent_key_count: 2,
    }),
    consumeCoreReceipt: (receipt, binding) => {
      if (consumed.has(receipt.id)) throw new Error("core_receipt_replayed");
      consumed.add(receipt.id);
      return registryConsumption(binding, receipt.id);
    },
  });
  assert.deepEqual(store.evaluate({
    tenant_id: "codexai",
    action: "new.action",
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    domain_pack_id: "generic",
    now: NOW,
  }).reasons, ["policy_snapshot_missing"]);
  const first = store.activate({
    tenant_id: "codexai",
    operation_id: "activate-00000001",
    snapshot,
    activation_attestation: { proof: "activation-1" },
    proof_binding: firstBinding,
    core_receipt: { id: "receipt-00000001" },
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    domain_pack_id: "generic",
    now: NOW,
  });
  assert.equal(first.activated, true);
  const replay = store.activate({
    tenant_id: "codexai",
    operation_id: "activate-00000001",
    snapshot,
    activation_attestation: { proof: "activation-1" },
    proof_binding: firstBinding,
    core_receipt: { id: "receipt-00000001" },
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    domain_pack_id: "generic",
    now: NOW,
  });
  assert.equal(replay.idempotent_replay, true);
  assert.throws(() => store.activate({
    tenant_id: "codexai",
    operation_id: "activate-00000001",
    snapshot,
    activation_attestation: { proof: "activation-1" },
    proof_binding: firstBinding,
    core_receipt: { id: "different-receipt" },
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    domain_pack_id: "generic",
    now: NOW,
  }), /policy_operation_idempotency_conflict/);
  const secondCandidate = activate(candidate({
    action: "second.action",
    packId: "tenant/codexai/action/second-action",
  }));
  const secondSnapshot = compilePolicySnapshot({
    tenant_id: "codexai",
    leaf_pack_ids: ["tenant/codexai/action/second-action@1.0.0"],
    packs: [corePack, secondCandidate],
    trusted_issuers: trustedIssuers,
    trusted_core_pack_digests: [policyPackDigest(corePack)],
    domain_pack_id: "generic",
    now: NOW,
  });
  const secondBinding = registryProofBinding({
    operationId: "activate-00000002",
    snapshotDigest: secondSnapshot.snapshot_digest,
    overrides: { owner_approval_hash: "e".repeat(64), intent_digest: "f".repeat(64) },
  });
  store.activate({
    tenant_id: "codexai",
    operation_id: "activate-00000002",
    snapshot: secondSnapshot,
    activation_attestation: { proof: "activation-2" },
    proof_binding: secondBinding,
    core_receipt: { id: "receipt-00000002" },
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    domain_pack_id: "generic",
    now: NOW,
  });
  const rollbackBinding = registryProofBinding({
    operationId: "rollback-00000001",
    snapshotDigest: snapshot.snapshot_digest,
    action: "policy.snapshot.rollback",
    overrides: { owner_approval_hash: "1".repeat(64), intent_digest: "2".repeat(64) },
  });
  assert.equal(store.rollback({
    tenant_id: "codexai",
    operation_id: "rollback-00000001",
    target_snapshot_digest: snapshot.snapshot_digest,
    activation_attestation: { proof: "rollback-1" },
    proof_binding: rollbackBinding,
    core_receipt: { id: "receipt-rollback-00000001" },
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    domain_pack_id: "generic",
    now: NOW,
  }).rolled_back, true);
  assert.equal(store.evaluate({
    tenant_id: "codexai",
    action: "new.action",
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    domain_pack_id: "generic",
    satisfied_gates: ["core_allow"],
    now: NOW,
  }).verdict, "ALLOW");
  assert.equal(store.evaluate({
    tenant_id: "codexai",
    action: "unknown.action",
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    domain_pack_id: "generic",
    satisfied_gates: ["core_allow"],
    now: NOW,
  }).verdict, "DENY");
  assert.deepEqual(store.evaluate({
    tenant_id: "other",
    action: "new.action",
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    domain_pack_id: "generic",
    satisfied_gates: ["core_allow"],
    now: NOW,
  }).reasons, ["policy_snapshot_missing"]);
});

test("PostgreSQL registry persists activation, request-bound replay and restart evaluation", async () => {
  const snapshot = compilePolicySnapshot({
    tenant_id: "codexai",
    leaf_pack_ids: ["tenant/codexai/action/new-action@1.0.0"],
    packs: [corePack, activate(candidate())],
    trusted_issuers: trustedIssuers,
    trusted_core_pack_digests: [policyPackDigest(corePack)],
    domain_pack_id: "generic",
    now: NOW,
  });
  const pool = new FakePolicyRegistryPgPool();
  const consumed = new Set();
  const options = {
    pool,
    verifyActivationSnapshot: (value, binding) => ({
      ok: true, signature_verified: true, tenant_id: binding.tenant_id,
      snapshot_digest: value.snapshot_digest, verified_roles: ["core", "nyra"], independent_key_count: 2,
    }),
    consumeCoreReceipt: (receipt, binding) => {
      if (consumed.has(receipt.id)) throw new Error("core_receipt_replayed");
      consumed.add(receipt.id);
      return registryConsumption(binding, `pg-${receipt.id}`);
    },
  };
  const store = createPostgresNyraPolicyRegistryStore(options);
  const input = {
    tenant_id: "codexai", operation_id: "pg-activate-000001", snapshot,
    activation_attestation: { proof: "pg-activation-1" },
    proof_binding: registryProofBinding({
      operationId: "pg-activate-000001",
      snapshotDigest: snapshot.snapshot_digest,
    }),
    core_receipt: { id: "pg-receipt-000001" }, core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance", domain_pack_id: "generic", now: NOW,
  };
  assert.equal((await store.activate(input)).activated, true);
  assert.equal((await store.activate(input)).idempotent_replay, true);
  await assert.rejects(store.activate({ ...input, core_receipt: { id: "changed-receipt" } }), /policy_operation_idempotency_conflict/);
  const restarted = createPostgresNyraPolicyRegistryStore(options);
  const evaluated = await restarted.evaluate({
    tenant_id: "codexai", action: "new.action", core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance", domain_pack_id: "generic", satisfied_gates: ["core_allow"], now: NOW,
  });
  assert.equal(evaluated.verdict, "ALLOW");
  assert.equal(evaluated.snapshot_verified, true);
  assert.equal((await restarted.status()).ready, true);
});

test("PostgreSQL registry retries transient schema initialization safely", async () => {
  const pool = new FakePolicyRegistryPgPool();
  pool.schemaFailures = 1;
  const store = createPostgresNyraPolicyRegistryStore({ pool });
  assert.equal((await store.status()).ready, false);
  assert.equal((await store.status()).ready, true);
  assert.equal(pool.schemaAttempts, 2);
  assert.equal(JSON.stringify(await store.status()).includes("secret"), false);
});

test("PostgreSQL registry re-probes transient backend failure single-flight and recovers", async () => {
  const pool = new FakePolicyRegistryPgPool();
  pool.healthFailures = 1;
  const store = createPostgresNyraPolicyRegistryStore({ pool });

  const unavailable = await store.status();
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.reason, "policy_registry_postgres_unavailable");
  assert.equal(pool.healthProbeAttempts, 1);

  const recovered = await Promise.all(Array.from({ length: 8 }, () => store.status()));
  assert.equal(recovered.every((status) => status.ready === true), true);
  assert.equal(pool.healthProbeAttempts, 2);
  const evaluated = await store.evaluate({ tenant_id: "codexai" });
  assert.deepEqual(evaluated.reasons, ["policy_snapshot_missing"]);
  assert.equal(JSON.stringify(recovered).includes("secret"), false);
});

test("PostgreSQL registry integrity corruption cannot be cleared by a backend probe", async () => {
  const pool = new FakePolicyRegistryPgPool();
  pool.states.set("codexai", {
    revision: 1,
    active_snapshot: { forged: true },
    active_attestation: { forged: true },
    history: [],
    state_status: "corrupt",
  });
  const store = createPostgresNyraPolicyRegistryStore({ pool });
  const evaluated = await store.evaluate({ tenant_id: "codexai" });
  assert.deepEqual(evaluated.reasons, ["policy_registry_state_corrupt"]);
  const probesBeforeStatus = pool.healthProbeAttempts;
  const status = await store.status();
  assert.equal(status.state, "corrupt");
  assert.equal(status.ready, false);
  assert.equal(pool.healthProbeAttempts, probesBeforeStatus);
});

test("PostgreSQL registry latches persisted snapshot, binding and quorum tamper as corrupt", async () => {
  const snapshot = compilePolicySnapshot({
    tenant_id: "codexai",
    leaf_pack_ids: ["tenant/codexai/action/new-action@1.0.0"],
    packs: [corePack, activate(candidate())],
    trusted_issuers: trustedIssuers,
    trusted_core_pack_digests: [policyPackDigest(corePack)],
    domain_pack_id: "generic",
    now: NOW,
  });
  const binding = registryProofBinding({
    operationId: "persisted-integrity-000001",
    snapshotDigest: snapshot.snapshot_digest,
  });
  const cases = [
    {
      name: "snapshot",
      mutate(row) { row.active_snapshot.policy.raw_customer_secret = "tampered"; },
      quorumReady: true,
    },
    {
      name: "binding",
      mutate(row) { row.active_attestation.binding.structural_extra = true; },
      quorumReady: true,
    },
    {
      name: "quorum",
      mutate() {},
      quorumReady: false,
    },
  ];

  for (const scenario of cases) {
    const pool = new FakePolicyRegistryPgPool();
    const row = {
      revision: 1,
      active_snapshot: structuredClone(snapshot),
      active_attestation: {
        binding: structuredClone(binding),
        policy_registry_attestation: { proof: `persisted-${scenario.name}` },
      },
      history: [],
      state_status: "ready",
    };
    scenario.mutate(row);
    pool.states.set("codexai", row);
    const store = createPostgresNyraPolicyRegistryStore({
      pool,
      verifyActivationSnapshot: (value, supplied) => ({
        ok: scenario.quorumReady,
        signature_verified: scenario.quorumReady,
        tenant_id: supplied.tenant_id,
        snapshot_digest: value.snapshot_digest,
        verified_roles: scenario.quorumReady ? ["core", "nyra"] : ["core"],
        independent_key_count: scenario.quorumReady ? 2 : 1,
      }),
    });
    const input = {
      tenant_id: "codexai",
      action: "new.action",
      core_branch_id: "nyra_policy_registry",
      nyra_branch_id: "risk_governance",
      domain_pack_id: "generic",
      satisfied_gates: ["core_allow"],
      now: NOW,
    };
    const first = await store.evaluate(input);
    assert.deepEqual(first.reasons, ["policy_registry_state_corrupt"], scenario.name);
    assert.equal(first.verdict, "DENY", scenario.name);
    const probesBeforeStatus = pool.healthProbeAttempts;
    const status = await store.status();
    assert.equal(status.state, "corrupt", scenario.name);
    assert.equal(status.ready, false, scenario.name);
    assert.equal(pool.healthProbeAttempts, probesBeforeStatus, scenario.name);
    const repeated = await store.evaluate(input);
    assert.equal(repeated.verdict, "DENY", scenario.name);
    assert.deepEqual(repeated.reasons, ["policy_registry_state_corrupt"], scenario.name);
  }
});

test("PostgreSQL registry fails closed while a consumed-receipt boundary is pending and reconciles the same operation", async () => {
  const snapshot = compilePolicySnapshot({
    tenant_id: "codexai",
    leaf_pack_ids: ["tenant/codexai/action/new-action@1.0.0"],
    packs: [corePack, activate(candidate())],
    trusted_issuers: trustedIssuers,
    trusted_core_pack_digests: [policyPackDigest(corePack)],
    domain_pack_id: "generic",
    now: NOW,
  });
  const pool = new FakePolicyRegistryPgPool();
  const verifyActivationSnapshot = (value, binding) => ({
    ok: true, signature_verified: true, tenant_id: binding.tenant_id,
    snapshot_digest: value.snapshot_digest, verified_roles: ["core", "nyra"], independent_key_count: 2,
  });
  const coreReceipt = { id: "pg-receipt-crash-000001" };
  const input = {
    tenant_id: "codexai", operation_id: "pg-activate-crash-000001", snapshot,
    activation_attestation: { proof: "pg-crash-activation" },
    proof_binding: registryProofBinding({
      operationId: "pg-activate-crash-000001",
      snapshotDigest: snapshot.snapshot_digest,
    }),
    core_receipt: coreReceipt, core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance", domain_pack_id: "generic", now: NOW,
  };
  const interrupted = createPostgresNyraPolicyRegistryStore({
    pool, verifyActivationSnapshot,
    consumeCoreReceipt: () => { throw new Error("simulated_receipt_boundary_interruption"); },
  });
  await assert.rejects(interrupted.activate(input), /simulated_receipt_boundary_interruption/);
  assert.deepEqual((await interrupted.evaluate({ tenant_id: "codexai" })).reasons,
    ["policy_registry_reconciliation_required"]);

  const consumptionProof = registryConsumption(
    input.proof_binding,
    "crash-recovery-000001",
  );
  const restarted = createPostgresNyraPolicyRegistryStore({ pool, verifyActivationSnapshot });
  const reconciled = await restarted.reconcile({
    tenant_id: "codexai", operation_id: input.operation_id,
    operation: "activate_policy_snapshot", snapshot_digest: snapshot.snapshot_digest,
    core_receipt: coreReceipt, consumption_proof: consumptionProof,
    proof_binding: input.proof_binding,
  });
  assert.equal(reconciled.activated, true);
  assert.equal((await restarted.evaluate({
    tenant_id: "codexai", action: "new.action", core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance", domain_pack_id: "generic",
    satisfied_gates: ["core_allow"], now: NOW,
  })).verdict, "ALLOW");
});

test("PostgreSQL registry serializes concurrent activation replay for one tenant operation", async () => {
  const snapshot = compilePolicySnapshot({
    tenant_id: "codexai", leaf_pack_ids: ["tenant/codexai/action/new-action@1.0.0"],
    packs: [corePack, activate(candidate())], trusted_issuers: trustedIssuers,
    trusted_core_pack_digests: [policyPackDigest(corePack)], domain_pack_id: "generic", now: NOW,
  });
  const pool = new FakePolicyRegistryPgPool();
  const proofBinding = registryProofBinding({
    operationId: "pg-concurrent-000001",
    snapshotDigest: snapshot.snapshot_digest,
  });
  const proof = registryConsumption(proofBinding, "concurrent-000001");
  const options = {
    pool,
    verifyActivationSnapshot: (value, binding) => ({
      ok: true, signature_verified: true, tenant_id: binding.tenant_id,
      snapshot_digest: value.snapshot_digest, verified_roles: ["core", "nyra"], independent_key_count: 2,
    }),
    consumeCoreReceipt: async () => proof,
  };
  const input = {
    tenant_id: "codexai", operation_id: "pg-concurrent-000001", snapshot,
    activation_attestation: { proof: "pg-concurrent-activation" },
    proof_binding: proofBinding,
    core_receipt: { id: "pg-concurrent-receipt-000001" }, core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance", domain_pack_id: "generic", now: NOW,
  };
  const raced = await Promise.allSettled([
    createPostgresNyraPolicyRegistryStore(options).activate(input),
    createPostgresNyraPolicyRegistryStore(options).activate(input),
  ]);
  assert(raced.some((entry) => entry.status === "fulfilled"));
  const replay = await createPostgresNyraPolicyRegistryStore(options).activate(input);
  assert.equal(replay.idempotent_replay, true);
});

test("action evaluator applies the registry only as a deny-only Core constraint", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "policy-registry-test-admin";
  let registryVerdict = "ALLOW";
  let snapshotPresent = false;
  const registry = {
    evaluate: () => ({
      verdict: registryVerdict,
      reasons: registryVerdict === "ALLOW" ? [] : [snapshotPresent ? "explicit_deny" : "policy_snapshot_missing"],
      snapshot_digest: snapshotPresent ? "a".repeat(64) : null,
      snapshot_present: snapshotPresent,
      snapshot_verified: snapshotPresent,
      fail_closed: true,
    }),
    status: () => ({ configured: true, backend: "injected", restart_durable: true }),
  };
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `policy-registry-api-${Date.now()}-${Math.random()}`),
    nyraPolicyRegistryStore: registry,
    nyraPolicyRegistryEnforcementMode: "advisory_evaluate",
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (pathname, body, key = "policy-registry-test-admin") => {
    const response = await fetch(`${base}${pathname}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };
  try {
    const healthResponse = await fetch(`${base}/healthz`);
    const health = await healthResponse.json();
    assert.equal(health.nyra_policy_registry.evaluation, "active");
    assert.equal(health.nyra_policy_registry.enforcement, "conditional_on_active_snapshot");
    assert.equal(Object.hasOwn(health.nyra_policy_registry, "tenant_id"), false);
    assert.equal(Object.hasOwn(health.nyra_policy_registry, "snapshot_digest"), false);
    const generated = await request("/v1/keys/generate", { tenant_id: "codexai", preset: "codex_automation" });
    const key = generated.json.key;
    const bounded = {
      action_type: "task.claim",
      action_label: "Claim bounded tenant task",
      operation_class: "bounded_internal_coordination_write",
      target: "tenant_task_queue",
      idempotency_key: "policy-registry-task-claim-0001",
      external_side_effect: false,
      contains_customer_data: false,
      contains_secret: false,
      secret_value_transmitted: false,
      cross_tenant: false,
      configuration_changes: false,
      destructive: false,
      bypass_orchestrator: false,
      provider_execution: false,
      bounded_scope: true,
      low_impact: true,
      idempotent_or_compensable: true,
      audit_ready: true,
      target_authority_verified: true,
      actor_authorized_for_target: true,
    };
    registryVerdict = "DENY";
    const allowed = await request("/v1/action-evaluator", bounded, key);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.json.authorization.allowed, true);
    assert.equal(allowed.json.policy_registry.deny_only, true);
    assert.equal(allowed.json.policy_registry.evaluation, "active");
    assert.equal(allowed.json.policy_registry.enforcement, "advisory_until_snapshot");

    snapshotPresent = true;
    registryVerdict = "DENY";
    const narrowed = await request("/v1/action-evaluator", bounded, key);
    assert.equal(narrowed.json.authorization.allowed, false);
    assert.equal(narrowed.json.authorization.policy_registry_denied, true);

    registryVerdict = "ALLOW";
    const coreDenied = await request("/v1/action-evaluator", {
      action_type: "publish",
      operation_class: "unknown_untrusted_operation",
      external_side_effect: true,
      cross_tenant: false,
    }, key);
    assert.equal(coreDenied.json.policy_registry.verdict, "ALLOW");
    assert.equal(coreDenied.json.authorization.allowed, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});
