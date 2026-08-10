import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  createWorkContinuityRuntime,
  digest,
} from "../src/work-continuity-runtime.js";

const databaseUrl = String(process.env.WORK_CONTINUITY_DATABASE_URL || "").trim();
const COMMIT = "c".repeat(40);
const BASE_COMMIT = "a".repeat(40);
const TREE_SHA = "b".repeat(40);

function coordinatorIdentity(tenantId) {
  return {
    tenantId,
    subject: "codex|postgres16-contract",
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      transport_bound: true,
      host_transport_session_fingerprint: "a".repeat(64),
      session_fingerprint: "a".repeat(64),
    },
  };
}

function galleryIdentity(tenantId, subject, sessionId, agentId, clientType = "codex", hex = "b") {
  return {
    tenantId,
    subject,
    agentPresence: {
      session_id: sessionId,
      agent_id: agentId,
      client_type: clientType,
      signature: `ags_${hex.repeat(32)}`,
      transport_bound: true,
      host_transport_session_fingerprint: hex.repeat(24),
      session_fingerprint: hex.repeat(24),
    },
  };
}

function reporterIdentity(tenantId, agentId, fingerprint, signatureHex) {
  return {
    tenantId,
    subject: `codex|${agentId}`,
    agentPresence: {
      agent_id: agentId,
      client_type: "codex",
      transport_bound: true,
      host_transport_session_fingerprint: fingerprint,
      session_fingerprint: fingerprint,
      signature: `ags_${signatureHex.repeat(32)}`,
    },
  };
}

function corePlanFor({ tenantId, work, request, objective }) {
  const payload = {
    tenant_id: tenantId,
    work_id: work.work_id,
    intent_anchor_digest: work.intent_digest,
    repository: request.repository,
    base_branch: request.base_branch,
    objective,
    required_checks: request.required_checks,
    builder_agent_id: "build",
    verifier_agent_ids: ["verify"],
    agents: request.tasks.map((task) => ({
      agent_id: task.task_id,
      role: task.kind,
      task: task.instruction,
      depends_on: task.dependencies || [],
      capabilities: [],
    })),
    maximum_parallel_agents: request.max_parallel,
  };
  const planDigest = digest(payload);
  return {
    schema_version: "host_native_work_plan_v1",
    plan_id: `hnp_${planDigest.slice(0, 40)}`,
    plan_digest: planDigest,
    ...payload,
    execution_adapter: "host_native",
    provider_execution: false,
    provider_api_key_required: false,
    server_model_calls: 0,
    host_materialization_required: true,
    materialization_status: "planned_not_spawned",
    host_policy_override: false,
    host_policy_must_allow: true,
    child_can_issue_action_ticket: false,
    join_authority: "universal_core",
    release_mode: "external_ticket_required",
  };
}

function release() {
  return {
    base_branch: "main",
    delivery_branch: "main",
    base_commit: BASE_COMMIT,
    head_commit: COMMIT,
    tree_sha: TREE_SHA,
    diff_digest: "d".repeat(64),
    changed_files: ["services/skinharmony-core-mcp/src/work-continuity-runtime.js"],
    delivery: {
      method: "github_protected_push_auto_deploy",
      services: [{
        service_id: "srv-core-mcp",
        environment: "production",
        expected_previous_commit: BASE_COMMIT,
        target_commit: null,
        target_resolution: "post_merge_readback",
        health_contract_digest: "e".repeat(64),
      }],
    },
    rollback: {
      mode: "forward_revert",
      target_commit: BASE_COMMIT,
      health_contract_digest: "e".repeat(64),
      ready: true,
    },
  };
}

test("PostgreSQL 16 persists the governed continuity fabric and rejects mutable provenance", {
  skip: databaseUrl ? false : "WORK_CONTINUITY_DATABASE_URL is required for the PostgreSQL 16 integration contract",
}, async () => {
  const runId = crypto.randomUUID().replaceAll("-", "");
  const tenantId = `pg16_${runId.slice(0, 20)}`;
  const projectId = `continuity-${runId.slice(0, 16)}`;
  const firstSession = `session-${runId.slice(0, 16)}`;
  const secondSession = `aggregate-${runId.slice(16, 32)}`;
  const pool = new Pool({ connectionString: databaseUrl, max: 4, statement_timeout: 10_000 });
  const runtime = createWorkContinuityRuntime({
    databaseUrl,
    dttAgentIdentitySigningSecret: "postgres16-continuity-assignment-secret-0123456789",
  }, { pool });
  const coordinator = coordinatorIdentity(tenantId);

  try {
    const version = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10_000), 16);

    const initial = {
      project_id: projectId,
      session_id: firstSession,
      initial_message: "Continue until verified; token=do-not-store.",
      idea: "PostgreSQL 16 durable continuity",
      objective: "Persist only native-agent evidence with no full repository rescan.",
      acceptance_criteria: ["The closure evidence is independently verified."],
      constraints: ["No raw credentials in durable work memory."],
      architecture: { components: [{ id: "core-mcp" }] },
      next_action: "Index the bounded change cone.",
      host_type: "codex_native",
    };
    const firstWork = await runtime.ensure(coordinator, initial, { creationAuthorized: true });
    const tables = await pool.query(`SELECT
      to_regclass('public.core_continuity_works') AS works,
      to_regclass('public.core_continuity_intent_anchors') AS anchors,
      to_regclass('public.core_continuity_atlas_nodes') AS atlas_nodes,
      to_regclass('public.core_continuity_native_agents') AS native_agents`);
    assert.deepEqual(tables.rows[0], {
      works: "core_continuity_works",
      anchors: "core_continuity_intent_anchors",
      atlas_nodes: "core_continuity_atlas_nodes",
      native_agents: "core_continuity_native_agents",
    });

    const anchor = await runtime.readIntent(coordinator, { work_id: firstWork.work_id });
    assert.equal(anchor.intent_digest, firstWork.intent_digest);
    assert.match(anchor.anchor.initial_message, /\[REDACTED\]/);
    await assert.rejects(pool.query(
      "UPDATE core_continuity_intent_anchors SET anchor=anchor WHERE tenant_id=$1 AND work_id=$2",
      [tenantId, firstWork.work_id],
    ), /core_continuity_intent_anchor_immutable/);

    const resumedSession = `resumed-${runId.slice(0, 16)}`;
    const resumeInput = {
      ...initial,
      session_id: resumedSession,
      work_id: firstWork.work_id,
      resume_existing: true,
    };
    const concurrentResume = await Promise.all([
      runtime.ensure(coordinator, resumeInput, { trustedSessionFollowup: true }),
      runtime.ensure(coordinator, resumeInput, { trustedSessionFollowup: true }),
    ]);
    assert.deepEqual(
      concurrentResume.map((result) => result.work_id),
      [firstWork.work_id, firstWork.work_id],
    );
    assert.equal(concurrentResume.filter((result) => result.session_binding_created).length, 1);
    const resumedBindings = await pool.query(`SELECT work_id,create_request_digest FROM core_continuity_session_bindings
      WHERE tenant_id=$1 AND project_id=$2 AND session_id=$3`,
    [tenantId, projectId, resumedSession]);
    assert.equal(resumedBindings.rowCount, 1);
    assert.equal(resumedBindings.rows[0].work_id, firstWork.work_id);
    await pool.query(`UPDATE core_continuity_session_bindings SET create_request_digest=$4
      WHERE tenant_id=$1 AND project_id=$2 AND session_id=$3`,
    [tenantId, projectId, resumedSession, "f".repeat(64)]);
    await assert.rejects(runtime.ensure(coordinator, resumeInput, {
      trustedSessionFollowup: true,
    }), /continuity_session_binding_conflict/);
    await pool.query(`UPDATE core_continuity_session_bindings SET create_request_digest=$4
      WHERE tenant_id=$1 AND project_id=$2 AND session_id=$3`,
    [tenantId, projectId, resumedSession, resumedBindings.rows[0].create_request_digest]);
    const creationEvents = await pool.query(`SELECT event_type FROM core_continuity_events
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number`,
    [tenantId, firstWork.work_id]);
    assert.deepEqual(creationEvents.rows.map((event) => event.event_type), [
      "work_created",
      "intent_anchored",
    ]);

    const memoryCheckpoint = await runtime.checkpoint(coordinator, {
      work_id: firstWork.work_id,
      agent_id: "codex-coordinator",
      evidence: [{ kind: "test", ref: "postgres16-lock-order" }],
      tests: [{ name: "postgres16-lock-order", passed: true }],
      rollback: { ready: true },
      provenance: { source: "postgres16-integration" },
      supervisor_approved: true,
      next_action: "Verify memory without inverting the Work lock order.",
      idempotency_key: `memory-checkpoint-${runId}`,
    });
    const memoryRowLockClient = await pool.connect();
    let memoryVerificationWhileRowLocked;
    try {
      await memoryRowLockClient.query("BEGIN");
      const holder = await memoryRowLockClient.query("SELECT pg_backend_pid() AS pid");
      const holderPid = Number(holder.rows[0].pid);
      await memoryRowLockClient.query(`SELECT work_id FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [tenantId, firstWork.work_id]);
      memoryVerificationWhileRowLocked = runtime.verifyMemory(coordinator, {
        work_id: firstWork.work_id,
        capsule_id: memoryCheckpoint.capsule_id,
        agent_id: "codex-coordinator",
        test_evidence: [{ name: "postgres16-lock-order", passed: true }],
        idempotency_key: `memory-verify-lock-order-${runId}`,
      });
      let workRowWaitObserved = false;
      for (let attempt = 0; attempt < 100 && !workRowWaitObserved; attempt += 1) {
        const waiters = await pool.query(`SELECT 1 FROM pg_stat_activity a
          WHERE $1::int=ANY(pg_blocking_pids(a.pid))
            AND a.wait_event_type='Lock'
            AND a.query LIKE '%core_continuity_works%FOR UPDATE%'
          LIMIT 1`, [holderPid]);
        workRowWaitObserved = waiters.rowCount === 1;
        if (!workRowWaitObserved) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(workRowWaitObserved, true, "memory verification did not wait on the Work row");
      const advisory = await memoryRowLockClient.query(`SELECT
        pg_try_advisory_xact_lock(hashtext($1),hashtext($2)) AS acquired`,
      [tenantId, firstWork.work_id]);
      assert.equal(advisory.rows[0].acquired, true,
        "memory verification acquired the Work advisory before the Work row");
      await memoryRowLockClient.query("COMMIT");
    } catch (error) {
      await memoryRowLockClient.query("ROLLBACK").catch(() => {});
      if (memoryVerificationWhileRowLocked) {
        await Promise.allSettled([memoryVerificationWhileRowLocked]);
      }
      assert.notEqual(error?.code, "40P01");
      throw error;
    } finally {
      memoryRowLockClient.release();
    }
    await memoryVerificationWhileRowLocked;
    await assert.rejects(runtime.ensure(coordinator, {
      ...resumeInput,
      project_id: `other-${runId.slice(0, 16)}`,
      session_id: `wrong-project-${runId.slice(0, 8)}`,
    }, { trustedSessionFollowup: true }), /continuity_project_mismatch/);
    await assert.rejects(runtime.ensure(
      coordinatorIdentity(`${tenantId}_other`),
      {
        ...resumeInput,
        session_id: `cross-tenant-${runId.slice(0, 8)}`,
      },
      { trustedSessionFollowup: true },
    ), /continuity_work_not_found/);

    const secondWork = await runtime.ensure(coordinator, {
      ...initial,
      session_id: secondSession,
      initial_message: "Continue the second indexed native work.",
      idea: "Cross-work Atlas provenance",
    }, { creationAuthorized: true });
    await assert.rejects(runtime.ensure(coordinator, {
      ...resumeInput,
      work_id: secondWork.work_id,
    }, { trustedSessionFollowup: true }), /continuity_session_binding_conflict/);

    const firstParticipant = {
      work_id: firstWork.work_id,
      session_id: `participant-a-${runId.slice(0, 8)}`,
      agent_id: "codex-builder",
      client_type: "codex",
      idempotency_key: `participant-a-${runId}`,
    };
    const secondParticipant = {
      work_id: firstWork.work_id,
      session_id: `participant-b-${runId.slice(0, 8)}`,
      agent_id: "chatgpt-verifier",
      client_type: "chatgpt",
      idempotency_key: `participant-b-${runId}`,
    };
    const firstParticipantIdentity = galleryIdentity(
      tenantId, coordinator.subject, firstParticipant.session_id,
      firstParticipant.agent_id, firstParticipant.client_type,
    );
    await runtime.join(firstParticipantIdentity, firstParticipant);
    await runtime.join(galleryIdentity(
      tenantId, "chatgpt|postgres16-verifier", secondParticipant.session_id,
      secondParticipant.agent_id, secondParticipant.client_type, "c",
    ), secondParticipant);
    const participants = await pool.query(`SELECT session_id FROM core_continuity_participants
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY session_id`,
    [tenantId, firstWork.work_id]);
    assert.deepEqual(participants.rows.map((row) => row.session_id), [
      firstParticipant.session_id,
      secondParticipant.session_id,
    ].sort());
    await assert.rejects(runtime.join(galleryIdentity(
      tenantId, "chatgpt|session-impersonator", firstParticipant.session_id,
      firstParticipant.agent_id, firstParticipant.client_type, "d",
    ), {
      ...firstParticipant,
      idempotency_key: `participant-conflict-${runId}`,
    }), /continuity_session_conflict/);
    await assert.rejects(runtime.join(galleryIdentity(
      tenantId, coordinator.subject, firstParticipant.session_id,
      firstParticipant.agent_id, "chatgpt", "9",
    ), {
      ...firstParticipant,
      client_type: "chatgpt",
      idempotency_key: `participant-client-conflict-${runId}`,
    }), /continuity_session_conflict/);
    await assert.rejects(runtime.join(galleryIdentity(
      `${tenantId}_other`, "chatgpt|cross-tenant", secondParticipant.session_id,
      secondParticipant.agent_id, secondParticipant.client_type, "e",
    ), {
      ...secondParticipant,
      idempotency_key: `participant-cross-tenant-${runId}`,
    }), /continuity_work_not_found/);

    const clientBoundLease = await runtime.acquireLease(firstParticipantIdentity, {
      ...firstParticipant,
      purpose: "Verify the signed participant client binding.",
      surfaces: [{ kind: "file", value: `services/client-bound-${runId.slice(0, 8)}` }],
      ttl_seconds: 3_600,
      idempotency_key: `participant-client-lease-${runId}`,
    });
    const forgedClientIdentity = galleryIdentity(
      tenantId, coordinator.subject, firstParticipant.session_id,
      firstParticipant.agent_id, "chatgpt", "9",
    );
    await assert.rejects(runtime.heartbeat(forgedClientIdentity, {
      ...firstParticipant,
      client_type: "chatgpt",
      ttl_seconds: 300,
      idempotency_key: `participant-wrong-client-heartbeat-${runId}`,
    }), /continuity_participant_not_active/);
    await assert.rejects(runtime.renewLease(forgedClientIdentity, {
      ...firstParticipant,
      client_type: "chatgpt",
      lease_id: clientBoundLease.lease.lease_id,
      ttl_seconds: 300,
      idempotency_key: `participant-wrong-client-renew-${runId}`,
    }), /continuity_participant_not_active/);
    await assert.rejects(runtime.inbox(forgedClientIdentity, {
      ...firstParticipant,
      client_type: "chatgpt",
      limit: 10,
    }), /continuity_participant_not_active/);
    await runtime.releaseLease(firstParticipantIdentity, {
      ...firstParticipant,
      lease_id: clientBoundLease.lease.lease_id,
      idempotency_key: `participant-client-lease-release-${runId}`,
    });

    const branchSession = `branch-promotion-${runId.slice(0, 10)}`;
    const branchIdentity = galleryIdentity(
      tenantId, "codex|branch-promotion", branchSession, "branch-promotion-agent", "codex", "5",
    );
    await runtime.join(branchIdentity, {
      work_id: firstWork.work_id,
      session_id: branchSession,
      agent_id: "branch-promotion-agent",
      client_type: "codex",
      ttl_seconds: 300,
      idempotency_key: `branch-promotion-join-${runId}`,
    });
    const unboundLease = await runtime.acquireLease(branchIdentity, {
      work_id: firstWork.work_id,
      session_id: branchSession,
      agent_id: "branch-promotion-agent",
      client_type: "codex",
      purpose: "Expire this lease when the participant receives a branch.",
      surfaces: [{ kind: "file", value: `services/branch-promotion-${runId.slice(0, 8)}` }],
      ttl_seconds: 3_600,
      idempotency_key: `branch-promotion-lease-${runId}`,
    });
    const openedBranch = await runtime.openBranch(branchIdentity, {
      work_id: firstWork.work_id,
      session_id: branchSession,
      agent_id: "branch-promotion-agent",
      client_type: "codex",
      branch_key: `implementation-${runId.slice(0, 10)}`,
      title: "Implementation",
      objective: "Bind the participant without carrying an unbound lease.",
      idempotency_key: `branch-promotion-open-${runId}`,
    });
    assert.equal(openedBranch.rebound_leases_expired, 1);
    const unboundLeaseState = await pool.query(`SELECT status FROM core_continuity_leases
      WHERE tenant_id=$1 AND work_id=$2 AND lease_id=$3`,
    [tenantId, firstWork.work_id, unboundLease.lease.lease_id]);
    assert.equal(unboundLeaseState.rows[0].status, "expired");
    const promotedParticipant = await pool.query(`SELECT branch_id FROM core_continuity_participants
      WHERE tenant_id=$1 AND work_id=$2 AND session_id=$3`,
    [tenantId, firstWork.work_id, branchSession]);
    assert.equal(promotedParticipant.rows[0].branch_id, openedBranch.branch.branch_id);

    const raceSession = `race-${runId.slice(0, 16)}`;
    const raceOwner = galleryIdentity(
      tenantId, "codex|race-owner", raceSession, "race-owner", "codex", "f",
    );
    const raceSuccessor = galleryIdentity(
      tenantId, "chatgpt|race-successor", raceSession, "race-successor", "chatgpt", "a",
    );
    await runtime.join(raceOwner, {
      work_id: firstWork.work_id,
      session_id: raceSession,
      agent_id: "race-owner",
      client_type: "codex",
      ttl_seconds: 300,
      idempotency_key: `race-owner-join-${runId}`,
    });
    const raceLease = await runtime.acquireLease(raceOwner, {
      work_id: firstWork.work_id,
      session_id: raceSession,
      agent_id: "race-owner",
      client_type: "codex",
      purpose: "Verify participant/work lock order.",
      surfaces: [{ kind: "file", value: `services/race-${runId.slice(0, 8)}` }],
      ttl_seconds: 3_600,
      idempotency_key: `race-owner-lease-${runId}`,
    });
    await pool.query(`UPDATE core_continuity_participants SET expires_at=now()-interval '1 second'
      WHERE tenant_id=$1 AND work_id=$2 AND session_id=$3`,
    [tenantId, firstWork.work_id, raceSession]);
    const raceResults = await Promise.allSettled([
      runtime.heartbeat(raceOwner, {
        work_id: firstWork.work_id,
        session_id: raceSession,
        agent_id: "race-owner",
        client_type: "codex",
        ttl_seconds: 300,
        idempotency_key: `race-owner-heartbeat-${runId}`,
      }),
      runtime.join(raceSuccessor, {
        work_id: firstWork.work_id,
        session_id: raceSession,
        agent_id: "race-successor",
        client_type: "chatgpt",
        ttl_seconds: 300,
        idempotency_key: `race-successor-join-${runId}`,
      }),
    ]);
    assert.equal(raceResults.filter((result) => result.status === "fulfilled").length, 1);
    for (const result of raceResults.filter((candidate) => candidate.status === "rejected")) {
      assert.notEqual(result.reason?.code, "40P01");
      assert.doesNotMatch(String(result.reason?.message || result.reason), /deadlock detected/i);
    }
    const raceState = await pool.query(`SELECT p.actor_subject,l.status AS lease_status
      FROM core_continuity_participants p JOIN core_continuity_leases l
        ON l.tenant_id=p.tenant_id AND l.work_id=p.work_id AND l.session_id=p.session_id
      WHERE p.tenant_id=$1 AND p.work_id=$2 AND p.session_id=$3 AND l.lease_id=$4`,
    [tenantId, firstWork.work_id, raceSession, raceLease.lease.lease_id]);
    assert.equal(raceState.rowCount, 1);
    assert.equal(
      raceState.rows[0].lease_status,
      raceState.rows[0].actor_subject === raceSuccessor.subject ? "expired" : "active",
    );

    const sameSubjectSession = `same-subject-${runId.slice(0, 12)}`;
    const sameSubject = "codex|same-subject-rebind";
    const originalAgent = galleryIdentity(
      tenantId, sameSubject, sameSubjectSession, "same-subject-agent-a", "codex", "7",
    );
    const replacementAgent = galleryIdentity(
      tenantId, sameSubject, sameSubjectSession, "same-subject-agent-b", "chatgpt", "8",
    );
    await runtime.join(originalAgent, {
      work_id: firstWork.work_id,
      session_id: sameSubjectSession,
      agent_id: "same-subject-agent-a",
      client_type: "codex",
      ttl_seconds: 300,
      idempotency_key: `same-subject-agent-a-join-${runId}`,
    });
    const inheritedLease = await runtime.acquireLease(originalAgent, {
      work_id: firstWork.work_id,
      session_id: sameSubjectSession,
      agent_id: "same-subject-agent-a",
      client_type: "codex",
      purpose: "Reject lease inheritance after same-subject agent change.",
      surfaces: [{ kind: "file", value: `services/same-subject-${runId.slice(0, 8)}` }],
      ttl_seconds: 3_600,
      idempotency_key: `same-subject-agent-a-lease-${runId}`,
    });
    await pool.query(`UPDATE core_continuity_participants SET expires_at=now()-interval '1 second'
      WHERE tenant_id=$1 AND work_id=$2 AND session_id=$3`,
    [tenantId, firstWork.work_id, sameSubjectSession]);
    const sameSubjectRebound = await runtime.join(replacementAgent, {
      work_id: firstWork.work_id,
      session_id: sameSubjectSession,
      agent_id: "same-subject-agent-b",
      client_type: "chatgpt",
      ttl_seconds: 300,
      idempotency_key: `same-subject-agent-b-join-${runId}`,
    });
    assert.equal(sameSubjectRebound.rebound_leases_expired, 1);
    const inheritedLeaseState = await pool.query(`SELECT status FROM core_continuity_leases
      WHERE tenant_id=$1 AND work_id=$2 AND lease_id=$3`,
    [tenantId, firstWork.work_id, inheritedLease.lease.lease_id]);
    assert.equal(inheritedLeaseState.rows[0].status, "expired");
    await assert.rejects(runtime.renewLease(replacementAgent, {
      work_id: firstWork.work_id,
      session_id: sameSubjectSession,
      agent_id: "same-subject-agent-b",
      client_type: "chatgpt",
      lease_id: inheritedLease.lease.lease_id,
      ttl_seconds: 300,
      idempotency_key: `same-subject-agent-b-renew-${runId}`,
    }), /continuity_lease_not_active/);

    const lockOrderSession = `lock-order-${runId.slice(0, 12)}`;
    const lockOrderIdentity = galleryIdentity(
      tenantId, "codex|lock-order", lockOrderSession, "lock-order-agent", "codex", "6",
    );
    await runtime.join(lockOrderIdentity, {
      work_id: firstWork.work_id,
      session_id: lockOrderSession,
      agent_id: "lock-order-agent",
      client_type: "codex",
      ttl_seconds: 300,
      idempotency_key: `lock-order-join-${runId}`,
    });
    const rowLockClient = await pool.connect();
    let heartbeatWhileRowLocked;
    try {
      await rowLockClient.query("BEGIN");
      const holder = await rowLockClient.query("SELECT pg_backend_pid() AS pid");
      const holderPid = Number(holder.rows[0].pid);
      await rowLockClient.query(`SELECT work_id FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [tenantId, firstWork.work_id]);
      heartbeatWhileRowLocked = runtime.heartbeat(lockOrderIdentity, {
        work_id: firstWork.work_id,
        session_id: lockOrderSession,
        agent_id: "lock-order-agent",
        client_type: "codex",
        ttl_seconds: 300,
        idempotency_key: `lock-order-heartbeat-${runId}`,
      });
      let workRowWaitObserved = false;
      for (let attempt = 0; attempt < 100 && !workRowWaitObserved; attempt += 1) {
        const waiters = await pool.query(`SELECT 1 FROM pg_stat_activity a
          WHERE $1::int=ANY(pg_blocking_pids(a.pid))
            AND a.wait_event_type='Lock'
            AND a.query LIKE '%core_continuity_works%FOR UPDATE%'
          LIMIT 1`, [holderPid]);
        workRowWaitObserved = waiters.rowCount === 1;
        if (!workRowWaitObserved) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(workRowWaitObserved, true, "heartbeat did not wait on the Work row");
      const advisory = await rowLockClient.query(`SELECT
        pg_try_advisory_xact_lock(hashtext($1),hashtext($2)) AS acquired`,
      [tenantId, firstWork.work_id]);
      assert.equal(advisory.rows[0].acquired, true,
        "heartbeat acquired the work advisory before the Work row");
      await rowLockClient.query("COMMIT");
    } catch (error) {
      await rowLockClient.query("ROLLBACK").catch(() => {});
      if (heartbeatWhileRowLocked) await Promise.allSettled([heartbeatWhileRowLocked]);
      assert.notEqual(error?.code, "40P01");
      throw error;
    } finally {
      rowLockClient.release();
    }
    await heartbeatWhileRowLocked;
    const atlasInput = (workId, idempotencyKey, summarySuffix) => runtime.upsertAtlas(coordinator, {
      work_id: workId,
      nodes: [
        {
          node_id: "router",
          kind: "file",
          path: "services/skinharmony-core-mcp/src/work-continuity-runtime.js",
          summary: `Native continuity router ${summarySuffix}.`,
        },
        {
          node_id: "verification",
          kind: "test",
          path: "services/skinharmony-core-mcp/test/work-continuity-postgres16.test.js",
          summary: `Independent PostgreSQL verification ${summarySuffix}.`,
        },
      ],
      edges: [{
        from_node_id: "router",
        to_node_id: "verification",
        edge_type: "covered_by",
      }],
      replace: true,
      source_hash: idempotencyKey.slice(-64),
      idempotency_key: idempotencyKey,
    });
    await atlasInput(firstWork.work_id, `atlas-${"1".repeat(64)}`, "first work");
    await atlasInput(secondWork.work_id, `atlas-${"2".repeat(64)}`, "second work");
    const atlas = await runtime.selectAtlas(coordinator, {
      project_id: projectId,
      seed_node_ids: ["router"],
      max_depth: 2,
      max_bytes: 12_000,
    });
    assert.equal(atlas.aggregate, true);
    assert.deepEqual(atlas.source_work_ids.sort(), [firstWork.work_id, secondWork.work_id].sort());
    assert.deepEqual(
      atlas.nodes.find((node) => node.node_id === "router").source_work_ids.sort(),
      [firstWork.work_id, secondWork.work_id].sort(),
    );
    assert.deepEqual(atlas.edges, [{
      from_node_id: "router",
      to_node_id: "verification",
      edge_type: "covered_by",
      source_work_ids: [firstWork.work_id, secondWork.work_id].sort(),
    }]);
    assert.equal(atlas.metrics.traversal_depth, 2);
    assert.equal(atlas.metrics.full_scan_performed, false);

    const request = {
      work_id: firstWork.work_id,
      repository: "owner/repo",
      base_branch: "main",
      host_type: "codex_native",
      required_checks: ["core-mcp"],
      max_parallel: 1,
      tasks: [
        { task_id: "build", kind: "builder", instruction: "Implement the bounded database contract." },
        {
          task_id: "verify",
          kind: "verifier",
          instruction: "Independently verify the persisted evidence.",
          dependencies: ["build"],
        },
      ],
      idempotency_key: `native-plan-${runId}`,
    };
    const planned = await runtime.planNativeAgents(coordinator, request, {
      corePlan: corePlanFor({
        tenantId,
        work: firstWork,
        request,
        objective: initial.objective,
      }),
    });
    const builder = await runtime.bindNativeAgent(coordinator, {
      work_id: firstWork.work_id,
      plan_id: planned.plan.plan_id,
      task_id: "build",
      native_agent_id: "codex-builder",
      host_type: "codex_native",
      host_task_id: "/root/postgres16-build",
    });
    await runtime.reportNativeAgent(
      reporterIdentity(tenantId, "codex-builder", "b".repeat(64), "b"),
      {
        work_id: firstWork.work_id,
        plan_id: planned.plan.plan_id,
        native_agent_id: "codex-builder",
        host_task_id: "/root/postgres16-build",
        assignment_capability: builder.assignment_capability,
        status: "completed",
        report: {
          summary: "Bounded implementation completed.",
          commit_sha: COMMIT,
          tests: [{ name: "PostgreSQL 16 schema contract", passed: true }],
          evidence_refs: ["commit:postgres16"],
        },
      },
    );
    const verifier = await runtime.bindNativeAgent(coordinator, {
      work_id: firstWork.work_id,
      plan_id: planned.plan.plan_id,
      task_id: "verify",
      native_agent_id: "codex-verifier",
      host_type: "codex_native",
      host_task_id: "/root/postgres16-verify",
    });
    await runtime.reportNativeAgent(
      reporterIdentity(tenantId, "codex-verifier", "d".repeat(64), "d"),
      {
        work_id: firstWork.work_id,
        plan_id: planned.plan.plan_id,
        native_agent_id: "codex-verifier",
        host_task_id: "/root/postgres16-verify",
        assignment_capability: verifier.assignment_capability,
        status: "completed",
        report: {
          summary: "Independent PostgreSQL verification approved.",
          verdict: "approved",
          commit_sha: COMMIT,
          verifies_task_ids: ["build"],
          tests: [{ name: "PostgreSQL 16 immutable event contract", passed: true }],
          evidence_refs: ["review:postgres16"],
          acceptance_evidence: planned.plan.acceptance_contract.criteria.map((criterion) => ({
            criterion_digest: criterion.criterion_digest,
            passed: true,
            evidence_refs: [`evidence:${criterion.criterion_id}`],
          })),
        },
      },
    );
    const persistedAgents = await pool.query(`SELECT task_id,native_session_fingerprint,native_presence_signature
      FROM core_continuity_native_agents
      WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 ORDER BY task_id`,
    [tenantId, firstWork.work_id, planned.plan.plan_id]);
    assert.equal(persistedAgents.rowCount, 2);
    assert.notEqual(
      persistedAgents.rows[0].native_session_fingerprint,
      persistedAgents.rows[1].native_session_fingerprint,
    );
    assert.ok(persistedAgents.rows.every((row) => /^ags_[a-f0-9]{32}$/.test(row.native_presence_signature)));

    const evaluation = await runtime.evaluateClosure(coordinator, {
      work_id: firstWork.work_id,
      plan_id: planned.plan.plan_id,
      release: release(),
      idempotency_key: `closure-${runId}`,
    });
    assert.equal(evaluation.closed, true);
    assert.equal(evaluation.core_join_required, true);
    assert.equal(evaluation.independent_verifier_count, 1);
    assert.equal(evaluation.acceptance_criteria_proven, planned.plan.acceptance_contract.criteria.length);
    assert.match(evaluation.core_join_material.material_digest, /^[a-f0-9]{64}$/);

    const events = await pool.query(`SELECT sequence_number,event_hash,previous_event_hash,event_type
      FROM core_continuity_events
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number`, [tenantId, firstWork.work_id]);
    assert.ok(events.rowCount >= 8);
    for (let index = 0; index < events.rows.length; index += 1) {
      assert.equal(Number(events.rows[index].sequence_number), index + 1);
      assert.equal(events.rows[index].previous_event_hash, index ? events.rows[index - 1].event_hash : null);
    }
    await assert.rejects(pool.query(
      "UPDATE core_continuity_events SET event_type='work_created' WHERE tenant_id=$1 AND work_id=$2 AND sequence_number=1",
      [tenantId, firstWork.work_id],
    ), /core_continuity_events_append_only/);
  } finally {
    await runtime.close();
  }
});
