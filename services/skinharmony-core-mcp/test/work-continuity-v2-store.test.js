import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  ADDITIVE_SCHEMA_SQL,
  actorFromIdentity,
  canAdminister,
  canClose,
  canContributeEvidence,
  canRead,
  canRecordTask,
  createGenericWorkCoreJoinVerifier,
  createWorkContinuityV2Store,
  deriveAuthenticatedTenantWorkAcl,
  verifyGenericCoreJoinVerdict,
} from "../src/work-continuity-v2-store.js";

const acl = ({ user_id = "user-a", tenant_id = "tenant-a", ...rest } = {}) => ({
  server_derived: true, user_id, tenant_id, team_ids: [], managed_team_ids: [],
  is_tenant_owner: false, is_super_admin: false, ...rest,
});

test("v2 store schema is additive and preserves legacy tables", () => {
  assert.match(ADDITIVE_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS tenant_work/);
  assert.match(ADDITIVE_SCHEMA_SQL, /ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS legacy_work_id/);
  assert.match(ADDITIVE_SCHEMA_SQL, /tenant_work_code_sequence/);
  assert.match(ADDITIVE_SCHEMA_SQL, /tenant_work_core_join/);
  assert.doesNotMatch(ADDITIVE_SCHEMA_SQL, /DROP\s+TABLE|DELETE\s+FROM/i);
});

test("actor requires a server-derived tenant ACL envelope", () => {
  const actor = actorFromIdentity({ tenantId: "tenant-a", subject: "user-a", tenant_work_acl: acl({ team_ids: ["team-a"] }), agentPresence: { agent_id: "agent-a" } });
  assert.deepEqual(actor, {
    tenant_id: "tenant-a", user_id: "user-a", agent_id: "agent-a", session_fingerprint: null,
    team_ids: ["team-a"], managed_team_ids: [],
    is_tenant_owner: false, is_super_admin: false, core_join_trusted: false,
  });
  assert.throws(() => actorFromIdentity({ tenantId: "tenant-a", subject: "user-a" }), /work_server_acl_required/);
  assert.throws(() => actorFromIdentity({ tenantId: "tenant-a", subject: "user-a", tenant_work_acl: acl({ user_id: "user-b" }) }), /work_server_acl_subject_mismatch/);
  assert.throws(() => actorFromIdentity({ tenantId: "tenant-b", subject: "user-a", tenant_work_acl: acl() }), /work_server_acl_tenant_mismatch/);
});

test("shared visibility is read-only and cross-user writes are denied", () => {
  const owner = actorFromIdentity({ tenantId: "tenant-a", subject: "owner", tenant_work_acl: acl({ user_id: "owner" }) });
  const reader = actorFromIdentity({ tenantId: "tenant-a", subject: "reader", tenant_work_acl: acl({ user_id: "reader" }) });
  const foreignTenant = actorFromIdentity({ tenantId: "tenant-b", subject: "reader", tenant_work_acl: acl({ user_id: "reader", tenant_id: "tenant-b" }) });
  const work = { tenant_id: "tenant-a", owner_user_id: "owner", created_by_user_id: "owner", assigned_user_ids: [], supervising_user_ids: [], visibility_scope: "shared" };
  assert.equal(canRead(work, reader), true);
  assert.equal(canRecordTask(work, reader), false);
  assert.equal(canContributeEvidence(work, reader), false);
  assert.equal(canClose(work, reader), false);
  assert.equal(canAdminister(work, reader), false);
  assert.equal(canRecordTask(work, owner), true);
  assert.equal(canClose(work, owner), true);
  assert.equal(canRead(work, foreignTenant), false);
});

test("team manager reads managed team but only explicit principals mutate or close", () => {
  const manager = actorFromIdentity({ tenantId: "tenant-a", subject: "manager", tenant_work_acl: acl({ user_id: "manager", managed_team_ids: ["team-a"] }) });
  const work = { tenant_id: "tenant-a", owner_user_id: "owner", created_by_user_id: "owner", assigned_user_ids: [], supervising_user_ids: [], team_id: "team-a", visibility_scope: "team" };
  assert.equal(canRead(work, manager), true);
  assert.equal(canRecordTask(work, manager), false);
  assert.equal(canClose(work, manager), false);
});

test("authenticated membership binding maps OAuth owner, member, Team Manager and Super Admin", () => {
  const identity = (subject, binding) => ({ tenantId: "tenant-a", subject, authenticatedTenantMembership: {
    schema_version: "tenant_membership_binding_v1", authenticated: true, tenant_id: "tenant-a", subject,
    expires_at: "2030-01-01T00:00:00.000Z", team_ids: [], managed_team_ids: [], assigned_work_ids: [], ...binding,
  } });
  const member = deriveAuthenticatedTenantWorkAcl(identity("member", { role: "member" }), 0);
  const manager = deriveAuthenticatedTenantWorkAcl(identity("manager", { role: "team_manager", managed_team_ids: ["team-a"] }), 0);
  const owner = deriveAuthenticatedTenantWorkAcl(identity("owner", { role: "tenant_owner" }), 0);
  const admin = deriveAuthenticatedTenantWorkAcl(identity("admin", { role: "super_admin" }), 0);
  assert.equal(member.is_tenant_owner, false);
  assert.deepEqual(manager.managed_team_ids, ["team-a"]);
  assert.equal(owner.is_tenant_owner, true);
  assert.equal(admin.is_super_admin, true);
});

test("legacy or caller-supplied role flags cannot mint a tenant work ACL", () => {
  const forged = {
    tenantId: "tenant-a", subject: "attacker", kind: "codex", oauthOwnerBound: true,
    selfServiceTenant: true, isTenantOwner: true, isSuperAdmin: true, teamIds: ["team-a"],
  };
  assert.throws(() => deriveAuthenticatedTenantWorkAcl(forged, 0), /tenant_work_membership_binding_required/);
  assert.throws(() => deriveAuthenticatedTenantWorkAcl({ ...forged, authenticatedTenantMembership: {
    schema_version: "tenant_membership_binding_v1", authenticated: true, tenant_id: "tenant-a", subject: "different",
    role: "super_admin", expires_at: "2030-01-01T00:00:00.000Z", team_ids: [], managed_team_ids: [], assigned_work_ids: [],
  } }, 0), /tenant_work_membership_binding_scope_mismatch/);
});

test("initialization sends one additive schema statement to the injected pool", async () => {
  const calls = [];
  const pool = { query: async (sql) => { calls.push(sql); return { rows: [] }; } };
  const store = createWorkContinuityV2Store({ pool });
  await store.initialize();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], ADDITIVE_SCHEMA_SQL);
});

test("exact Work ACL reads accept RFC UUIDv8 identifiers", async () => {
  const workId = "11111111-1111-8111-8111-111111111111";
  const pool = {
    async query(sql) {
      if (sql === ADDITIVE_SCHEMA_SQL) return { rows: [] };
      if (/SELECT \* FROM tenant_work WHERE tenant_id=\$1 AND work_id=\$2/.test(sql)) {
        return { rows: [{
          tenant_id: "tenant-a",
          work_id: workId,
          owner_user_id: "user-a",
          created_by_user_id: "user-a",
          assigned_user_ids: [],
          supervising_user_ids: [],
          agent_ids: [],
          visibility_scope: "private",
        }] };
      }
      return { rows: [] };
    },
  };
  const store = createWorkContinuityV2Store({ pool });
  const result = await store.readWork({
    tenantId: "tenant-a",
    subject: "user-a",
    tenant_work_acl: acl(),
  }, { work_id: workId });
  assert.equal(result.work.work_id, workId);
});

test("Generic Core Join requires the exact v1 contract, canonical signature and request binding", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const unsigned = {
    schema_version: "generic_work_core_join_v1",
    verdict_id: `gwcj_${"1".repeat(40)}`,
    tenant_id: "tenant-a",
    work_id: "11111111-1111-4111-8111-111111111111",
    adapter: "research",
    acceptance_criteria_digest: "1".repeat(64),
    task_state_digest: "2".repeat(64),
    evidence_digest: "3".repeat(64),
    independent_verifier_receipt_digest: "4".repeat(64),
    idempotency_digest: "5".repeat(64),
    issued_at: "2026-08-10T12:00:00.000Z",
    authority: "universal_core",
    decision: "GENERIC_WORK_CORE_JOIN_ELIGIBLE",
    execution_authorized: false,
    host_action_authorized: false,
    key_id: "core-20260808",
    signature_algorithm: "ed25519",
  };
  const verdict_digest = crypto.createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.keys(unsigned).sort().map((key) => [key, unsigned[key]])))).digest("hex");
  const signature = crypto.sign(null, Buffer.from(`generic_work_core_join_v1\0${verdict_digest}`), privateKey).toString("base64url");
  const verdict = { ...unsigned, verdict_digest, signature };
  const verifierInput = {
    publicKey: publicKey.export({ format: "pem", type: "spki" }),
    keyId: "core-20260808",
  };
  const expected = {
    tenant_id: unsigned.tenant_id,
    work_id: unsigned.work_id,
    adapter: unsigned.adapter,
    idempotency_digest: unsigned.idempotency_digest,
  };
  assert.equal(verifyGenericCoreJoinVerdict(verdict, { ...verifierInput, expected }), true);
  assert.equal(verifyGenericCoreJoinVerdict({ ...verdict, schema_version: "generic_work_core_join_v2" }, verifierInput), false);
  assert.equal(verifyGenericCoreJoinVerdict({ ...verdict, unexpected: true }, verifierInput), false);
  assert.equal(verifyGenericCoreJoinVerdict({ ...verdict, signature: `${signature}=` }, verifierInput), false);
  assert.equal(verifyGenericCoreJoinVerdict(verdict, {
    ...verifierInput,
    expected: { ...expected, adapter: "document" },
  }), false);
  assert.equal(verifyGenericCoreJoinVerdict(verdict, { ...verifierInput, keyId: "other" }), false);
});

test("Generic Core Join verifier accepts only pinned public Ed25519 PEM or public JWK", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const keyId = "core-key-20260810";
  const publicPem = publicKey.export({ format: "pem", type: "spki" });
  const verifier = createGenericWorkCoreJoinVerifier({ publicKey: publicPem, keyId });
  const fingerprint = crypto.createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex");
  assert.deepEqual(verifier.metadata, {
    key_id: keyId,
    public_key_fingerprint: fingerprint,
  });
  assert.equal(verifier.schema_version, "generic_work_core_join_v1");
  assert.equal(verifier.algorithm, "Ed25519");

  const publicJwk = { ...publicKey.export({ format: "jwk" }), alg: "EdDSA", use: "sig", kid: keyId };
  assert.equal(
    createGenericWorkCoreJoinVerifier({ publicKey: JSON.stringify(publicJwk), keyId })
      .public_key_fingerprint,
    fingerprint,
  );
  for (const input of [
    privateKey.export({ format: "pem", type: "pkcs8" }),
    privateKey.export({ format: "jwk" }),
    crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "pem", type: "spki" }),
  ]) {
    assert.throws(
      () => createGenericWorkCoreJoinVerifier({ publicKey: input, keyId }),
      /generic_work_core_join_verifier_unavailable/,
    );
  }
  assert.throws(
    () => createGenericWorkCoreJoinVerifier({ publicKey: publicPem, keyId: "x" }),
    /generic_work_core_join_verifier_unavailable/,
  );
  assert.throws(
    () => createGenericWorkCoreJoinVerifier({
      publicKey: { ...publicJwk, kid: "different-key" },
      keyId,
    }),
    /generic_work_core_join_verifier_unavailable/,
  );
});
