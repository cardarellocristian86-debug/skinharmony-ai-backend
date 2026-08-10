import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import pg from "pg";

import {
  NYRA_POLICY_PRIMARY_SOURCES,
  POLICY_PACK_SCHEMA_VERSION,
  compilePolicySnapshot,
  createPolicyPackCandidate,
  policyPackDigest,
} from "../src/nyraPolicyRegistry.js";
import { createPostgresNyraPolicyRegistryStore } from "../src/nyraPolicyRegistryStore.js";

const DATABASE_URL = String(process.env.POLICY_REGISTRY_DATABASE_URL ||
  process.env.GOVERNED_AGENT_DATABASE_URL || process.env.WORK_CONTINUITY_DATABASE_URL || "").trim();
const NOW = new Date("2026-08-03T12:00:00.000Z");
const PG16 = { skip: DATABASE_URL ? false : "PostgreSQL integration URL not configured" };

function tenant(label) {
  return `policy-registry-pg16-${label}-${process.pid}-${crypto.randomUUID()}`;
}

function fixture(tenantId) {
  const coreKeys = crypto.generateKeyPairSync("ed25519");
  const nyraKeys = crypto.generateKeyPairSync("ed25519");
  const registered = NYRA_POLICY_PRIMARY_SOURCES.find((item) => item.source_id === "cedar_authorization");
  const sources = [{ source_id: registered.source_id, url: registered.url,
    claim: "PostgreSQL integration evidence", reviewed_at: "2026-08-03" }];
  const bindings = { core_branch_ids: ["nyra_policy_registry"],
    nyra_branch_ids: ["risk_governance"], domain_pack_ids: ["generic"] };
  const corePack = {
    schema_version: POLICY_PACK_SCHEMA_VERSION, pack_id: "core/invariants", version: "1.0.0",
    status: "active", scope: { kind: "core", value: "universal-core", tenant_id: null },
    parent_refs: [], bindings,
    privacy: { raw_customer_data_allowed: false, data_classification: "policy_metadata_only" },
    policy: { allow_mode: "inherit", allow_actions: [], deny_actions: ["cross_tenant_access"],
      required_gates: ["core_allow"], constraints: { nested: { jsonb: [true, 7, "stable"] } } },
    tests: [{ id: "allow", expected: "ALLOW" }, { id: "deny", expected: "DENY" }],
    sources, freshness_sla_days: 365, provenance: { builder: "pg16-test" },
    valid_from: "2026-08-03T00:00:00.000Z", expires_at: "2027-08-03T00:00:00.000Z",
    rollback_to: null, compatibility: {}, trust_mode: "compiled_core", signatures: [],
  };
  corePack.artifact_digest = policyPackDigest(corePack);
  const action = "tenant_work_coordination";
  const candidate = createPolicyPackCandidate({
    pack_id: `tenant/${tenantId}/action/${action}`, version: "1.0.0",
    scope: { kind: "action", value: action, tenant_id: tenantId },
    parent_refs: [{ pack_id: corePack.pack_id, version: corePack.version, digest: policyPackDigest(corePack) }],
    bindings, policy: { allow_actions: [action], deny_actions: [`${action}.dangerous`],
      required_gates: ["core_allow"], constraints: { nested: [1, { stable: true }] } },
    tests: [{ id: "positive", expected: "ALLOW" }, { id: "negative", expected: "DENY" }],
    sources, freshness_sla_days: 365, valid_from: "2026-08-03T00:00:00.000Z",
    expires_at: "2027-08-03T00:00:00.000Z",
  });
  const signable = { ...candidate, status: "active", signatures: [] };
  const payload = Buffer.from(policyPackDigest(signable), "utf8");
  const active = { ...signable, signatures: [
    { issuer_id: "core", algorithm: "Ed25519", signature: crypto.sign(null, payload, coreKeys.privateKey).toString("base64") },
    { issuer_id: "nyra", algorithm: "Ed25519", signature: crypto.sign(null, payload, nyraKeys.privateKey).toString("base64") },
  ] };
  active.artifact_digest = policyPackDigest(active);
  const snapshot = compilePolicySnapshot({ tenant_id: tenantId,
    leaf_pack_ids: [`${candidate.pack_id}@${candidate.version}`], packs: [corePack, active],
    trusted_issuers: { core: { public_key: coreKeys.publicKey, role: "core" },
      nyra: { public_key: nyraKeys.publicKey, role: "nyra" } },
    trusted_core_pack_digests: [policyPackDigest(corePack)], domain_pack_id: "generic", now: NOW });
  return { action, snapshot };
}

function options(pool, tenantId, snapshot, consumed = { count: 0 }) {
  return { pool,
    verifyActivationSnapshot: (value, binding) => ({ ok: true, signature_verified: true,
      tenant_id: binding.tenant_id, snapshot_digest: value.snapshot_digest,
      verified_roles: ["core", "nyra"], independent_key_count: 2,
      jsonb_proof: ["roundtrip", { valid: true }] }),
    consumeCoreReceipt: async (_receipt, binding) => {
      consumed.count += 1;
      return { ok: true, consumed: true, single_use: true, signature_verified: true,
        issuer_role: "universal_core", ...binding,
        consumption_id: `consumption-${crypto.randomUUID()}` };
    } };
}

function proofBinding(tenantId, operationId, snapshotDigest, action = "policy.snapshot.activate") {
  return {
    tenant_id: tenantId,
    operation_id: operationId,
    action,
    operation: action === "policy.snapshot.activate"
      ? "activate_policy_snapshot"
      : "rollback_policy_snapshot",
    work_id: crypto.randomUUID(),
    preflight_id: `preflight-${crypto.randomUUID()}`,
    intent_digest: crypto.randomBytes(32).toString("hex"),
    domain_pack_id: "generic",
    snapshot_digest: snapshotDigest,
    owner_approval_hash: crypto.randomBytes(32).toString("hex"),
    core_key_id: "core-policy-pg16-v2",
    nyra_key_id: "nyra-policy-pg16-v2",
    core_public_key_fingerprint: "a".repeat(64),
    nyra_public_key_fingerprint: "b".repeat(64),
  };
}

function activation(tenantId, snapshot, operationId = `activate-${crypto.randomUUID()}`) {
  return { tenant_id: tenantId, operation_id: operationId, snapshot,
    activation_attestation: { schema_version: "pg16-test-attestation-v2" },
    proof_binding: proofBinding(tenantId, operationId, snapshot.snapshot_digest),
    core_receipt: { ticket_id: `ticket-${crypto.randomUUID()}`, nested: { one_use: true } },
    core_branch_id: "nyra_policy_registry", nyra_branch_id: "risk_governance",
    domain_pack_id: "generic", now: NOW };
}

async function postgres16(pool) {
  const version = await pool.query("SHOW server_version_num");
  assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10_000), 16);
}

async function cleanup(pool, tenantIds) {
  await pool.query("DELETE FROM nyra_policy_registry_operations WHERE tenant_id = ANY($1::text[])", [tenantIds]);
  await pool.query("DELETE FROM nyra_policy_registry_state WHERE tenant_id = ANY($1::text[])", [tenantIds]);
}

test("Policy Registry PostgreSQL 16 preserves JSONB and state across store restart", PG16, async () => {
  const tenantId = tenant("restart");
  const sentinel = tenant("sentinel");
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  try {
    await postgres16(pool);
    const { action, snapshot } = fixture(tenantId);
    const storeOptions = options(pool, tenantId, snapshot);
    const store = createPostgresNyraPolicyRegistryStore(storeOptions);
    assert.equal((await store.activate(activation(tenantId, snapshot))).activated, true);
    const raw = await pool.query("SELECT active_snapshot, active_attestation, history FROM nyra_policy_registry_state WHERE tenant_id=$1", [tenantId]);
    assert.equal(raw.rowCount, 1);
    assert.equal(raw.rows[0].active_snapshot.snapshot_digest, snapshot.snapshot_digest);
    assert.deepEqual(raw.rows[0].active_attestation.jsonb_proof, ["roundtrip", { valid: true }]);
    assert.deepEqual(raw.rows[0].history, []);

    const restarted = createPostgresNyraPolicyRegistryStore(storeOptions);
    const result = await restarted.evaluate({ tenant_id: tenantId, action,
      core_branch_id: "nyra_policy_registry", nyra_branch_id: "risk_governance",
      domain_pack_id: "generic", satisfied_gates: ["core_allow"], now: NOW });
    assert.equal(result.verdict, "ALLOW");
    assert.equal(result.snapshot_verified, true);
    assert.equal((await restarted.status()).restart_durable, true);

    await pool.query("INSERT INTO nyra_policy_registry_state(tenant_id) VALUES($1) ON CONFLICT (tenant_id) DO NOTHING", [sentinel]);
    await cleanup(pool, [tenantId]);
    assert.equal((await pool.query("SELECT 1 FROM nyra_policy_registry_state WHERE tenant_id=$1", [tenantId])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM nyra_policy_registry_state WHERE tenant_id=$1", [sentinel])).rowCount, 1);
  } finally {
    await cleanup(pool, [tenantId, sentinel]).catch(() => {});
    await pool.end();
  }
});

test("Policy Registry PostgreSQL 16 serializes multi-connection replay with CAS", PG16, async () => {
  const tenantId = tenant("race");
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8 });
  try {
    await postgres16(pool);
    const { snapshot } = fixture(tenantId);
    const consumed = { count: 0 };
    const storeOptions = options(pool, tenantId, snapshot, consumed);
    const input = activation(tenantId, snapshot, `race-${crypto.randomUUID()}`);
    const stores = Array.from({ length: 6 }, () => createPostgresNyraPolicyRegistryStore(storeOptions));
    const results = await Promise.all(stores.map((store) => store.activate(input)));
    assert.equal(results.filter((item) => item.idempotent_replay === false).length, 1);
    assert.equal(results.filter((item) => item.idempotent_replay === true).length, 5);
    assert.equal(results.every((item) => item.snapshot_digest === snapshot.snapshot_digest), true);

    const persisted = await pool.query(`SELECT s.revision, s.state_status, o.status, o.result, o.consumption_proof
      FROM nyra_policy_registry_state s JOIN nyra_policy_registry_operations o USING (tenant_id)
      WHERE s.tenant_id=$1 AND o.operation_id=$2`, [tenantId, input.operation_id]);
    assert.equal(persisted.rowCount, 1);
    assert.equal(Number(persisted.rows[0].revision), 1);
    assert.equal(persisted.rows[0].state_status, "ready");
    assert.equal(persisted.rows[0].status, "completed");
    assert.equal(persisted.rows[0].result.snapshot_digest, snapshot.snapshot_digest);
    assert.equal(persisted.rows[0].consumption_proof.single_use, true);
    await assert.rejects(createPostgresNyraPolicyRegistryStore(storeOptions).activate({
      ...input, core_receipt: { ticket_id: "conflicting-receipt" },
    }), /policy_operation_idempotency_conflict/);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM nyra_policy_registry_operations WHERE tenant_id=$1 AND operation_id=$2",
      [tenantId, input.operation_id])).rows[0].count, 1);
    assert.equal(consumed.count >= 1, true);
  } finally {
    await cleanup(pool, [tenantId]).catch(() => {});
    await pool.end();
  }
});
