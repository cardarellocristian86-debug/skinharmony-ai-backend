import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createPostgresCausalActionLeaseVerifier } from "../../universal-core-service/src/app.js";
import { createWorkContinuityRuntime, digest, normalizeSurfaces } from "../src/work-continuity-runtime.js";

const databaseUrl = String(process.env.WORK_CONTINUITY_DATABASE_URL || "").trim();

test("PostgreSQL 16 persists and enforces causal lease session binding", {
  skip: databaseUrl ? false : "WORK_CONTINUITY_DATABASE_URL is required",
}, async () => {
  const suffix = crypto.randomBytes(8).toString("hex");
  const schema = `causal_lease_session_${suffix}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 10_000 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, max: 2, statement_timeout: 10_000, options: `-c search_path=${schema}` });
  const runtime = createWorkContinuityRuntime({}, { pool });
  const tenantId = `tenant_${suffix}`;
  const workId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const changeId = crypto.randomUUID();
  const obligationId = crypto.randomUUID();
  const sessionFingerprint = crypto.createHash("sha256").update(`session-a:${suffix}`).digest("hex").slice(0, 24);
  const identity = {
    tenantId, subject: "oauth|lease-session-test",
    agentPresence: {
      session_id: "logical-session-a", agent_id: "same-agent", client_type: "codex",
      signature: `ags_${"a".repeat(32)}`, transport_bound: true,
      host_transport_session_fingerprint: "b".repeat(24), session_fingerprint: sessionFingerprint,
    },
  };
  const surfaces = normalizeSurfaces([
    { kind: "causal_project", value: projectId },
    { kind: "causal_change", value: changeId },
    { kind: "causal_obligation", value: obligationId },
  ]);
  try {
    const version = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10_000), 16);
    await runtime.initialize();
    await pool.query("ALTER TABLE core_continuity_works ADD COLUMN project_uuid uuid");
    await pool.query(`INSERT INTO core_continuity_works
      (tenant_id,project_id,project_uuid,work_id,session_id,idea,objective,next_action,created_by)
      VALUES ($1,$2,$3,$4,$5,'test','test','test',$6)`,
    [tenantId, "project-alias", projectId, workId, "logical-session-a", "same-agent"]);
    await pool.query(`INSERT INTO core_continuity_participants
      (tenant_id,work_id,session_id,actor_subject,agent_id,client_type,
       transport_session_fingerprint,expires_at)
      VALUES ($1,$2,$3,$4,$5,'codex',$6,now()+interval '10 minutes')`,
    [tenantId, workId, "logical-session-a", identity.subject, "same-agent",
      identity.agentPresence.host_transport_session_fingerprint]);
    await pool.query(`CREATE TABLE core_changes (
      tenant_id text NOT NULL,project_id uuid NOT NULL,work_id uuid NOT NULL,change_id uuid NOT NULL,
      PRIMARY KEY (tenant_id,change_id))`);
    await pool.query(`CREATE TABLE core_causal_obligations (
      tenant_id text NOT NULL,project_id uuid NOT NULL,work_id uuid NOT NULL,change_id uuid NOT NULL,obligation_id uuid NOT NULL,
      PRIMARY KEY (tenant_id,obligation_id))`);
    await pool.query("INSERT INTO core_changes VALUES ($1,$2,$3,$4)", [tenantId, projectId, workId, changeId]);
    await pool.query("INSERT INTO core_causal_obligations VALUES ($1,$2,$3,$4,$5)", [tenantId, projectId, workId, changeId, obligationId]);

    const acquired = await runtime.acquireLease(identity, {
      work_id: workId, session_id: "logical-session-a", agent_id: "same-agent", client_type: "codex",
      purpose: "causal_context_issue", surfaces, ttl_seconds: 300, idempotency_key: `lease-${suffix}`,
    });
    assert.equal(acquired.acquired, true);
    const persisted = (await pool.query(`SELECT policy_session_fingerprint,policy_authority_scope,
      policy_authority_binding_digest FROM core_continuity_leases WHERE tenant_id=$1 AND work_id=$2 AND lease_id=$3`,
    [tenantId, workId, acquired.lease.lease_id])).rows[0];
    assert.equal(persisted.policy_session_fingerprint, sessionFingerprint);
    assert.equal(persisted.policy_authority_binding_digest, digest({
      schema_version: "persisted_lease_authority_v1", tenant_id: tenantId, lease_id: acquired.lease.lease_id,
      actor_id: "same-agent", purpose: "causal_context_issue", surfaces,
      persisted_authority_scope: persisted.policy_authority_scope,
      policy_session_fingerprint: sessionFingerprint,
    }));

    const verify = createPostgresCausalActionLeaseVerifier(pool);
    const request = {
      tenant_id: tenantId, project_id: projectId, work_id: workId, change_id: changeId,
      obligation_ids: [obligationId], lease_id: acquired.lease.lease_id, actor_id: "same-agent",
      actor_session_fingerprint: sessionFingerprint,
    };
    assert.equal((await verify(request)).policy_session_fingerprint, sessionFingerprint);
    assert.equal(await verify({ ...request, actor_session_fingerprint: "c".repeat(24) }), null);
    const secondSessionIdentity = {
      ...identity,
      agentPresence: { ...identity.agentPresence, session_fingerprint: "c".repeat(24) },
    };
    await assert.rejects(
      () => runtime.acquireLease(secondSessionIdentity, {
        work_id: workId, session_id: "logical-session-a", agent_id: "same-agent", client_type: "codex",
        purpose: "causal_context_issue", surfaces, ttl_seconds: 300, idempotency_key: `lease-${suffix}`,
      }),
      /idempotency_key_conflict/,
    );
    await pool.query("UPDATE core_continuity_leases SET policy_session_fingerprint=NULL WHERE tenant_id=$1 AND work_id=$2 AND lease_id=$3",
      [tenantId, workId, acquired.lease.lease_id]);
    assert.equal(await verify(request), null);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
