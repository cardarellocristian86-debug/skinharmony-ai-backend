import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import pg from "pg";

import { createGenericWorkCoreJoinAuthority, genericWorkCoreJoinDigest } from "../src/genericWorkCoreJoin.js";
import { createPostgresGenericWorkCoreJoinStore } from "../src/genericWorkCoreJoinStore.js";

const DATABASE_URL = String(process.env.GENERIC_WORK_CORE_JOIN_DATABASE_URL || "").trim();
const digest = (value) => genericWorkCoreJoinDigest({ value });

function inputFor({ tenant_id, nonce = "nonce-001", idempotency_digest = digest("idem-001"), evidence = "evidence-001" }) {
  const acceptance_criteria = [{ criterion_id: "criterion-001", criterion_digest: digest("criterion"), evidence_digest: digest("criterion-evidence"), verification_digest: digest("criterion-verification") }];
  const task_state = [{ task_id: "task-001", completion_evidence_digest: digest("task-evidence"), task_state_digest: digest("task-state"), verification_digest: digest("task-verification") }];
  const evidence_digests = [digest(evidence)];
  return {
    tenant_id,
    work_id: "work-postgres-001",
    adapter: "research",
    requester_identity: "builder-001",
    requester_session_id: "builder-session-001",
    idempotency_digest,
    acceptance_criteria,
    task_state,
    evidence_digests,
    independent_verifier_receipt: {
      schema_version: "generic_work_independent_verifier_receipt_v1",
      tenant_id,
      work_id: "work-postgres-001",
      adapter: "research",
      acceptance_criteria_digest: genericWorkCoreJoinDigest(acceptance_criteria),
      task_state_digest: genericWorkCoreJoinDigest(task_state),
      evidence_digest: genericWorkCoreJoinDigest([...evidence_digests].sort()),
      verification_digest: digest("verification"),
      verifier_identity: "verifier-001",
      session_id: "verifier-session-001",
      nonce,
      issued_at: "2026-08-08T09:59:00.000Z",
      expires_at: "2099-08-08T10:05:00.000Z",
      signature: "independent-verifier-signature",
    },
  };
}

test("PostgreSQL 16 Generic Core Join is durable, idempotent, isolated, and append-only", async (t) => {
  if (!DATABASE_URL) {
    t.skip("GENERIC_WORK_CORE_JOIN_DATABASE_URL is absent; PostgreSQL 16 integration not run");
    return;
  }
  const tenant = `gwcj_${crypto.randomUUID().replaceAll("-", "")}`;
  const otherTenant = `gwcj_${crypto.randomUUID().replaceAll("-", "")}`;
  const keys = crypto.generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" });
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const version = await pool.query("SHOW server_version_num");
    assert.match(String(version.rows[0]?.server_version_num || ""), /^16\d{4}$/);

    const store = createPostgresGenericWorkCoreJoinStore({ pool });
    await store.initialize();
    const authority = createGenericWorkCoreJoinAuthority({
      signingPrivateKey: privateKey,
      signingKeyId: "generic-work-core-join-postgres16-key",
      store,
      verifyIndependentVerifierReceipt: () => true,
    });
    const firstInput = inputFor({ tenant_id: tenant });
    const first = await authority.issue(firstInput);
    assert.equal(first.signature_algorithm, "ed25519");

    // A fresh store object simulates a service restart over the same durable schema.
    const restartedStore = createPostgresGenericWorkCoreJoinStore({ pool });
    await restartedStore.initialize();
    const restartedAuthority = createGenericWorkCoreJoinAuthority({
      signingPrivateKey: privateKey,
      signingKeyId: "generic-work-core-join-postgres16-key",
      store: restartedStore,
      verifyIndependentVerifierReceipt: () => true,
    });
    const replay = await restartedAuthority.issue(structuredClone(firstInput));
    assert.deepEqual(replay, first);

    const conflict = inputFor({ tenant_id: tenant, evidence: "different-evidence" });
    await assert.rejects(restartedAuthority.issue(conflict), /generic_work_core_join_idempotency_conflict/);
    const nonceReplay = inputFor({ tenant_id: tenant, idempotency_digest: digest("idem-002") });
    await assert.rejects(restartedAuthority.issue(nonceReplay), /generic_work_core_join_nonce_replayed/);

    const isolated = await restartedAuthority.issue(inputFor({ tenant_id: otherTenant }));
    assert.notEqual(isolated.verdict_id, first.verdict_id);
    const persisted = await pool.query(
      "SELECT request_canonical, independent_verifier_receipt_digest, verdict FROM generic_work_core_joins WHERE tenant_id=$1",
      [tenant],
    );
    assert.equal(persisted.rowCount, 1);
    assert.equal(persisted.rows[0].independent_verifier_receipt_digest, first.independent_verifier_receipt_digest);
    assert.equal(persisted.rows[0].verdict.verdict_id, first.verdict_id);
    const events = await pool.query("SELECT event_type, verdict_id, receipt_digest FROM generic_work_core_join_events WHERE tenant_id=$1", [tenant]);
    assert.equal(events.rowCount, 1);
    assert.equal(events.rows[0].event_type, "generic_work_core_join_issued");
    assert.equal(events.rows[0].verdict_id, first.verdict_id);

    const mutatedLocalCopy = structuredClone(first);
    mutatedLocalCopy.signature = "mutated-local-copy";
    const immutableReplay = await restartedAuthority.issue(structuredClone(firstInput));
    assert.notEqual(immutableReplay.signature, "mutated-local-copy");
  } finally {
    await pool.query("DELETE FROM generic_work_core_join_events WHERE tenant_id = ANY($1::text[])", [[tenant, otherTenant]]);
    await pool.query("DELETE FROM generic_work_core_joins WHERE tenant_id = ANY($1::text[])", [[tenant, otherTenant]]);
    await pool.end();
  }
});
