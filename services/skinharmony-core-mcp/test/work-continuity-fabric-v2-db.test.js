import assert from "node:assert/strict";
import test from "node:test";
import {
  coreJoinIdempotencyKey,
  createWorkContinuityRuntime,
  digest,
} from "../src/work-continuity-runtime.js";
import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  buildHostReleaseManifestV2,
  buildHostReleaseIntentV1,
  createHostNativeGovernance,
  createInMemoryHostNativeGovernanceStore,
  hostNativeDigest,
  hostNativeGithubDiffDigest,
} from "../../universal-core-service/src/hostNativeGovernance.js";

function key(...parts) {
  return parts.join("\u0000");
}

function galleryIdentity(subject, sessionId, agentId, clientType = "codex", tenantId = "tenant-a") {
  return {
    tenantId,
    subject,
    agentPresence: {
      session_id: sessionId,
      agent_id: agentId,
      client_type: clientType,
      signature: `ags_${"a".repeat(32)}`,
      transport_bound: true,
      host_transport_session_fingerprint: "b".repeat(24),
    },
  };
}

class ContinuityPool {
  constructor(clock) {
    this.clock = clock;
    this.works = new Map();
    this.bindings = new Map();
    this.anchors = new Map();
    this.events = new Map();
    this.idempotency = new Map();
    this.participants = new Map();
    this.branches = new Map();
    this.leases = new Map();
    this.plans = new Map();
    this.nativeAgents = new Map();
    this.evaluations = new Map();
    this.releaseJoins = new Map();
    this.incidents = new Map();
    this.capsules = new Map();
  }

  async query(sql, parameters = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.includes("CREATE TABLE IF NOT EXISTS core_continuity_works")) return { rows: [], rowCount: 0 };
    if (q.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };

    if (q.startsWith("SELECT work_id,create_request_digest FROM core_continuity_session_bindings")) {
      const row = this.bindings.get(key(parameters[0], parameters[1], parameters[2]));
      const matchesWork = !parameters[3] || row?.work_id === parameters[3];
      return { rows: row && matchesWork ? [{ ...row }] : [], rowCount: row && matchesWork ? 1 : 0 };
    }
    if (q.startsWith("SELECT a.intent_digest,a.create_request_digest,")) {
      const anchor = this.anchors.get(key(parameters[0], parameters[1]));
      const work = this.works.get(key(parameters[0], parameters[1]));
      const row = anchor && work ? {
        intent_digest: anchor.intent_digest,
        create_request_digest: anchor.create_request_digest,
        project_id: work.project_id,
        status: work.status,
        current_version: work.current_version,
        next_action: work.next_action,
      } : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT w.*,c.capsule_id,c.capsule,c.capsule_digest,c.supervisor_approved")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      const capsule = this.capsules.get(key(parameters[0], parameters[1]));
      const row = work ? { ...work, ...(capsule || {}) } : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT intent_digest FROM core_continuity_intent_anchors")) {
      const row = this.anchors.get(key(parameters[0], parameters[1]));
      return { rows: row ? [{ intent_digest: row.intent_digest }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT project_id,session_id,anchor,intent_digest,created_by,created_at")) {
      const row = this.anchors.get(key(parameters[0], parameters[1]));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO core_continuity_works")) {
      const [
        tenantId, projectId, workId, sessionId, parentWorkId, idea, objective,
        repositoryHash, policyHash, liveStateHash, nextAction, createdBy,
      ] = parameters;
      const timestamp = this.clock().toISOString();
      this.works.set(key(tenantId, workId), {
        tenant_id: tenantId,
        project_id: projectId,
        work_id: workId,
        session_id: sessionId,
        parent_work_id: parentWorkId,
        idea,
        objective,
        status: "active",
        current_version: 1,
        repository_hash: repositoryHash,
        policy_hash: policyHash,
        live_state_hash: liveStateHash,
        next_action: nextAction,
        created_by: createdBy,
        created_at: timestamp,
        updated_at: timestamp,
      });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO core_continuity_architecture_versions")) {
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO core_continuity_intent_anchors")) {
      const [tenantId, workId, projectId, sessionId, anchor, intentDigest,
        createRequestDigest, createdBy] = parameters;
      this.anchors.set(key(tenantId, workId), {
        project_id: projectId,
        session_id: sessionId,
        anchor: JSON.parse(anchor),
        intent_digest: intentDigest,
        create_request_digest: createRequestDigest,
        created_by: createdBy,
        created_at: this.clock().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO core_continuity_session_bindings")) {
      const [tenantId, projectId, sessionId, workId, createRequestDigest] = parameters;
      const bindingKey = key(tenantId, projectId, sessionId);
      const current = this.bindings.get(bindingKey);
      if (current && q.includes("ON CONFLICT") && q.includes("DO NOTHING")) {
        return { rows: [], rowCount: 0 };
      }
      const row = {
        work_id: workId,
        create_request_digest: createRequestDigest,
      };
      this.bindings.set(bindingKey, row);
      return {
        rows: q.includes("RETURNING") ? [{ ...row }] : [],
        rowCount: 1,
      };
    }

    if (q.startsWith("SELECT sequence_number,event_hash FROM core_continuity_events")) {
      const rows = this.events.get(key(parameters[0], parameters[1])) || [];
      return { rows: rows.length ? [{ ...rows.at(-1) }] : [], rowCount: rows.length ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO core_continuity_events")) {
      const [tenantId, workId, eventId, sequenceNumber, eventType, payload,
        previousEventHash, eventHash, createdBy] = parameters;
      const eventKey = key(tenantId, workId);
      const rows = this.events.get(eventKey) || [];
      rows.push({
        event_id: eventId,
        sequence_number: sequenceNumber,
        event_type: eventType,
        payload: JSON.parse(payload),
        previous_event_hash: previousEventHash,
        event_hash: eventHash,
        created_by: createdBy,
      });
      this.events.set(eventKey, rows);
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith("SELECT w.work_id,w.project_id,w.session_id,w.status,w.current_version")) {
      const tenantId = parameters[0];
      const limit = Number(parameters.at(-1));
      const rows = [...this.works.values()]
        .filter((work) => work.tenant_id === tenantId)
        .sort((left, right) =>
          String(right.updated_at).localeCompare(String(left.updated_at)) ||
          right.work_id.localeCompare(left.work_id))
        .slice(0, limit)
        .map((work) => {
          const plans = [...this.plans.values()]
            .filter((plan) => plan.tenant_id === tenantId && plan.work_id === work.work_id)
            .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
          const plan = plans[0];
          return {
            ...work,
            latest_plan_id: plan?.plan_id || null,
            latest_plan_status: plan?.status || null,
            latest_plan_created_at: plan?.created_at || null,
            latest_incident_fingerprint: null,
            latest_incident_status: null,
            latest_incident_updated_at: null,
            atlas_revision: null,
            atlas_source_hash: null,
            atlas_updated_at: null,
          };
        });
      return { rows, rowCount: rows.length };
    }

    if (q.startsWith("SELECT operation,request_digest,result FROM core_continuity_idempotency")) {
      const row = this.idempotency.get(key(parameters[0], parameters[1], parameters[2]));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO core_continuity_idempotency")) {
      const [tenantId, workId, idempotencyKey, operation, requestDigest, result] = parameters;
      this.idempotency.set(key(tenantId, workId, idempotencyKey), {
        operation,
        request_digest: requestDigest,
        result: JSON.parse(result),
      });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT work_id FROM core_continuity_works")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      return { rows: work ? [{ work_id: work.work_id }] : [], rowCount: work ? 1 : 0 };
    }
    if (q.startsWith("SELECT branch_id FROM core_continuity_branches")) {
      const branch = this.branches.get(key(parameters[0], parameters[1], parameters[2]));
      const active = branch?.status === "active";
      return { rows: active ? [{ branch_id: branch.branch_id }] : [], rowCount: active ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO core_continuity_branches")) {
      const [tenantId, workId, branchId, parentBranchId, branchKey, title, objective, createdBy] = parameters;
      const existing = [...this.branches.values()].find((branch) =>
        branch.tenant_id === tenantId && branch.work_id === workId && branch.branch_key === branchKey);
      const timestamp = this.clock().toISOString();
      const row = existing || {
        tenant_id: tenantId,
        work_id: workId,
        branch_id: branchId,
        parent_branch_id: parentBranchId,
        branch_key: branchKey,
        title,
        objective,
        status: "active",
        created_by: createdBy,
        created_at: timestamp,
        updated_at: timestamp,
      };
      if (!existing) this.branches.set(key(tenantId, workId, branchId), row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (q.startsWith("SELECT actor_subject,agent_id,client_type,branch_id,expires_at FROM core_continuity_participants")) {
      const row = this.participants.get(key(parameters[0], parameters[1], parameters[2]));
      return { rows: row ? [{
        actor_subject: row.actor_subject,
        agent_id: row.agent_id,
        client_type: row.client_type,
        branch_id: row.branch_id,
        expires_at: row.expires_at,
      }] : [],
        rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("UPDATE core_continuity_leases l")) {
      const [tenantId, workId, sessionId, actorSubject, agentId, clientType, branchId] = parameters;
      const participant = this.participants.get(key(tenantId, workId, sessionId));
      const bindingChanged = participant && (
        participant.actor_subject !== actorSubject ||
        participant.agent_id !== agentId ||
        participant.client_type !== clientType ||
        participant.branch_id !== branchId
      );
      const activeBranchPromotion = participant &&
        participant.actor_subject === actorSubject &&
        participant.agent_id === agentId &&
        participant.client_type === clientType &&
        participant.branch_id === null && branchId !== null;
      const canRebind = (bindingChanged &&
        Date.parse(participant.expires_at) <= this.clock().getTime()) ||
        activeBranchPromotion;
      const rows = [];
      if (canRebind) {
        for (const lease of this.leases.values()) {
          if (lease.tenant_id === tenantId && lease.work_id === workId &&
            lease.session_id === sessionId && lease.status === "active") {
            lease.status = "expired";
            lease.released_at ||= this.clock().toISOString();
            rows.push({ lease_id: lease.lease_id, session_id: lease.session_id });
          }
        }
      }
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("INSERT INTO core_continuity_participants")) {
      const [tenantId, workId, sessionId, actorSubject, agentId, clientType,
        branchId, ttlSeconds, metadata] = parameters;
      const participantKey = key(tenantId, workId, sessionId);
      const current = this.participants.get(participantKey);
      const currentExpired = current &&
        Date.parse(current.expires_at) <= this.clock().getTime();
      const compatibleActiveBinding = current &&
        current.actor_subject === actorSubject &&
        current.agent_id === agentId &&
        current.client_type === clientType &&
        (current.branch_id === null || branchId === null || current.branch_id === branchId);
      if (current && !currentExpired && !compatibleActiveBinding) {
        return { rows: [], rowCount: 0 };
      }
      const timestamp = this.clock().toISOString();
      const row = {
        tenant_id: tenantId,
        work_id: workId,
        session_id: sessionId,
        actor_subject: actorSubject,
        agent_id: agentId,
        client_type: clientType,
        branch_id: currentExpired ? branchId : (current?.branch_id ?? branchId),
        status: "active",
        joined_at: current?.joined_at || timestamp,
        last_seen_at: timestamp,
        expires_at: new Date(this.clock().getTime() + (Number(ttlSeconds) * 1_000)).toISOString(),
        metadata: JSON.parse(metadata),
      };
      this.participants.set(participantKey, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (q.startsWith("SELECT session_id,agent_id,client_type,branch_id,status,expires_at,actor_subject")) {
      const row = this.participants.get(key(parameters[0], parameters[1], parameters[2]));
      const requireActive = parameters[4] === true;
      const active = row?.status === "active" && Date.parse(row.expires_at) > this.clock().getTime();
      const matchesAgent = !parameters[5] || row?.agent_id === parameters[5];
      const matchesClient = !parameters[6] || row?.client_type === parameters[6];
      const matches = row?.actor_subject === parameters[3] && matchesAgent && matchesClient &&
        (!requireActive || active);
      return { rows: matches ? [{ ...row }] : [], rowCount: matches ? 1 : 0 };
    }
    if (q.startsWith("UPDATE core_continuity_leases SET status='expired'")) {
      const [tenantId, workId, sessionId, branchId] = parameters;
      const rows = [];
      for (const lease of this.leases.values()) {
        if (lease.tenant_id === tenantId && lease.work_id === workId &&
          lease.session_id === sessionId && lease.status === "active" &&
          lease.branch_id !== branchId) {
          lease.status = "expired";
          lease.released_at ||= this.clock().toISOString();
          rows.push({ lease_id: lease.lease_id, session_id: lease.session_id });
        }
      }
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("UPDATE core_continuity_participants SET branch_id")) {
      const [tenantId, workId, sessionId, branchId] = parameters;
      const participant = this.participants.get(key(tenantId, workId, sessionId));
      if (!participant || (participant.branch_id !== null && participant.branch_id !== branchId)) {
        return { rows: [], rowCount: 0 };
      }
      participant.branch_id = branchId;
      participant.last_seen_at = this.clock().toISOString();
      return { rows: [{ branch_id: branchId }], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_leases SET renewed_at")) {
      const [tenantId, workId, leaseId, sessionId, ttlSeconds, agentId, branchId] = parameters;
      const lease = this.leases.get(key(tenantId, workId, leaseId));
      const active = lease?.session_id === sessionId && lease.status === "active" &&
        Date.parse(lease.expires_at) > this.clock().getTime() &&
        lease.created_by === agentId && lease.branch_id === branchId;
      if (!active) return { rows: [], rowCount: 0 };
      lease.renewed_at = this.clock().toISOString();
      lease.expires_at = new Date(this.clock().getTime() + Number(ttlSeconds) * 1_000).toISOString();
      return { rows: [{ ...lease }], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_leases SET status='released'")) {
      const [tenantId, workId, leaseId, sessionId, agentId, branchId] = parameters;
      const lease = this.leases.get(key(tenantId, workId, leaseId));
      if (!lease || lease.session_id !== sessionId || lease.status !== "active" ||
        lease.created_by !== agentId || lease.branch_id !== branchId) {
        return { rows: [], rowCount: 0 };
      }
      lease.status = "released";
      lease.released_at = this.clock().toISOString();
      return { rows: [{ ...lease }], rowCount: 1 };
    }
    if (q.startsWith("SELECT project_id FROM core_continuity_works")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      return {
        rows: work ? [{ project_id: work.project_id }] : [],
        rowCount: work ? 1 : 0,
      };
    }
    if (q.startsWith("SELECT w.work_id,a.anchor,a.intent_digest")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      const anchor = this.anchors.get(key(parameters[0], parameters[1]));
      const row = work && anchor ? {
        work_id: work.work_id,
        anchor: anchor.anchor,
        intent_digest: anchor.intent_digest,
      } : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO core_continuity_native_plans")) {
      const [tenantId, workId, planId, plan, planDigest, createdBy] = parameters;
      this.plans.set(key(tenantId, planId), {
        tenant_id: tenantId,
        work_id: workId,
        plan_id: planId,
        plan: JSON.parse(plan),
        plan_digest: planDigest,
        status: "planned",
        created_by: createdBy,
        created_at: this.clock().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO core_continuity_native_receipts")) {
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT plan,status FROM core_continuity_native_plans")) {
      const row = this.plans.get(key(parameters[0], parameters[2]));
      if (!row || row.work_id !== parameters[1]) return { rows: [], rowCount: 0 };
      return { rows: [{ plan: row.plan, status: row.status }], rowCount: 1 };
    }
    if (q.startsWith("SELECT plan_id,plan,status FROM core_continuity_native_plans")) {
      const rows = [...this.plans.values()]
        .filter((row) =>
          row.tenant_id === parameters[0] &&
          row.work_id === parameters[1] &&
          ["planned", "verified"].includes(row.status))
        .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))
        .map((row) => ({ plan_id: row.plan_id, plan: row.plan, status: row.status }));
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("SELECT plan FROM core_continuity_native_plans")) {
      const rows = [...this.plans.values()]
        .filter((row) =>
          row.tenant_id === parameters[0] &&
          row.work_id === parameters[1])
        .sort((left, right) =>
          String(right.created_at).localeCompare(String(left.created_at)));
      return {
        rows: rows.length ? [{ plan: rows[0].plan }] : [],
        rowCount: rows.length ? 1 : 0,
      };
    }
    if (q.startsWith("UPDATE core_continuity_native_plans SET status='superseded'")) {
      const selected = new Set(parameters[2]);
      for (const row of this.plans.values()) {
        if (
          row.tenant_id === parameters[0] &&
          row.work_id === parameters[1] &&
          selected.has(row.plan_id)
        ) {
          row.status = "superseded";
          row.closed_at = this.clock().toISOString();
        }
      }
      return { rows: [], rowCount: selected.size };
    }
    if (q.startsWith("UPDATE core_continuity_native_agents SET status='superseded'")) {
      const selected = new Set(parameters[2]);
      let count = 0;
      for (const row of this.nativeAgents.values()) {
        if (
          row.tenant_id === parameters[0] &&
          row.work_id === parameters[1] &&
          selected.has(row.plan_id) &&
          row.status === "bound"
        ) {
          row.status = "superseded";
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (q.startsWith("UPDATE core_continuity_native_agents SET status='expired'")) {
      const rows = [...this.nativeAgents.values()].filter((candidate) =>
        candidate.tenant_id === parameters[0] &&
        candidate.work_id === parameters[1] &&
        candidate.plan_id === parameters[2] &&
        candidate.status === "bound" &&
        candidate.lease_expires_at &&
        Date.parse(candidate.lease_expires_at) <= this.clock().getTime());
      for (const row of rows) {
        row.status = "expired";
        row.reported_at = this.clock().toISOString();
      }
      return {
        rows: rows.map((row) => ({ task_id: row.task_id, agent_id: row.agent_id })),
        rowCount: rows.length,
      };
    }
    if (q.startsWith("UPDATE core_continuity_native_plans SET status='blocked'")) {
      const plan = this.plans.get(key(parameters[0], parameters[2]));
      if (plan?.work_id === parameters[1] && plan.status === "planned") {
        plan.status = "blocked";
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (q.startsWith("UPDATE core_continuity_works SET status='blocked'")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      if (work && work.status !== "completed") {
        work.status = "blocked";
        work.next_action = parameters[2];
        work.updated_at = this.clock().toISOString();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (q.startsWith("SELECT task_id,status FROM core_continuity_native_agents")) {
      const rows = [...this.nativeAgents.values()]
        .filter((candidate) =>
          candidate.tenant_id === parameters[0] &&
          candidate.work_id === parameters[1] &&
          candidate.plan_id === parameters[2])
        .sort((left, right) => left.task_id.localeCompare(right.task_id))
        .map((row) => ({ task_id: row.task_id, status: row.status }));
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("SELECT task_id,agent_id,host_type,host_task_id,task_digest,")) {
      const [tenantId, planId, taskId, agentId, hostTaskId] = parameters;
      const row = [...this.nativeAgents.values()].find((candidate) =>
        candidate.tenant_id === tenantId &&
        candidate.plan_id === planId &&
        (candidate.task_id === taskId ||
          candidate.agent_id === agentId ||
          candidate.host_task_id === hostTaskId));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO core_continuity_native_agents")) {
      const [tenantId, workId, planId, taskId, agentId, hostType, hostTaskId,
        taskKind, taskDigest, coordinatorFingerprint, assignmentCapabilityDigest,
        boundBy, leaseExpiresAt] = parameters;
      this.nativeAgents.set(key(tenantId, planId, taskId), {
        tenant_id: tenantId,
        work_id: workId,
        plan_id: planId,
        task_id: taskId,
        agent_id: agentId,
        host_type: hostType,
        host_task_id: hostTaskId,
        task_kind: taskKind,
        task_digest: taskDigest,
        coordinator_session_fingerprint: coordinatorFingerprint,
        assignment_capability_digest: assignmentCapabilityDigest,
        native_session_fingerprint: null,
        native_presence_signature: null,
        status: "bound",
        report: null,
        report_digest: null,
        bound_by: boundBy,
        lease_expires_at: leaseExpiresAt,
      });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT a.task_id,a.task_kind,a.task_digest,a.status,a.report_digest,")) {
      const [tenantId, workId, planId, agentId] = parameters;
      const row = [...this.nativeAgents.values()].find((candidate) =>
        candidate.tenant_id === tenantId &&
        candidate.work_id === workId &&
        candidate.plan_id === planId &&
        candidate.agent_id === agentId);
      const plan = this.plans.get(key(tenantId, planId));
      return {
        rows: row && plan ? [{
          ...row,
          plan: plan.plan,
          plan_status: plan.status,
        }] : [],
        rowCount: row && plan ? 1 : 0,
      };
    }
    if (q.startsWith("UPDATE core_continuity_native_agents SET status=")) {
      const [
        tenantId, workId, planId, agentId, status, report, reportDigest,
        nativeSessionFingerprint, nativePresenceSignature,
      ] = parameters;
      const row = [...this.nativeAgents.values()].find((candidate) =>
        candidate.tenant_id === tenantId &&
        candidate.work_id === workId &&
        candidate.plan_id === planId &&
        candidate.agent_id === agentId);
      row.status = status;
      row.report = JSON.parse(report);
      row.report_digest = reportDigest;
      row.native_session_fingerprint = nativeSessionFingerprint;
      row.native_presence_signature = nativePresenceSignature;
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT task_id FROM core_continuity_native_agents")) {
      const [tenantId, planId, nativeSessionFingerprint, agentId] = parameters;
      const row = [...this.nativeAgents.values()].find((candidate) =>
        candidate.tenant_id === tenantId &&
        candidate.plan_id === planId &&
        candidate.native_session_fingerprint === nativeSessionFingerprint &&
        candidate.agent_id !== agentId);
      return { rows: row ? [{ task_id: row.task_id }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT task_id,agent_id,task_kind,status,report,report_digest")) {
      const rows = [...this.nativeAgents.values()]
        .filter((row) =>
          row.tenant_id === parameters[0] &&
          row.work_id === parameters[1] &&
          row.plan_id === parameters[2])
        .sort((left, right) => left.task_id.localeCompare(right.task_id))
        .map((row) => ({ ...row }));
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("SELECT p.plan,p.plan_digest,p.status, e.evaluation_id")) {
      const plan = this.plans.get(key(parameters[0], parameters[2]));
      const joins = [...this.releaseJoins.values()]
        .filter((candidate) =>
          candidate.tenant_id === parameters[0] &&
          candidate.work_id === parameters[1] &&
          candidate.plan_id === parameters[2])
        .sort((left, right) =>
          String(right.created_at).localeCompare(String(left.created_at)));
      const join = joins[0];
      const evaluations =
        this.evaluations.get(key(parameters[0], parameters[1], parameters[2])) || [];
      const evaluation = evaluations.find((candidate) =>
        candidate.evaluation_id === join?.evaluation_id);
      if (!plan || !join || !evaluation) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          plan: plan.plan,
          plan_digest: plan.plan_digest,
          status: plan.status,
          evaluation_id: evaluation.evaluation_id,
          evaluation: evaluation.evaluation,
          evaluation_digest: evaluation.evaluation_digest,
          verdict_id: join.verdict_id,
          release_intent: join.release_intent,
          release_intent_digest: join.release_intent_digest,
          core_join_record: join.core_join_record,
          core_join_record_digest: join.core_join_record_digest,
        }],
        rowCount: 1,
      };
    }
    if (
      q.startsWith("SELECT p.plan,p.plan_digest,p.status,a.intent_digest,e.evaluation")
    ) {
      const plan = this.plans.get(key(parameters[0], parameters[2]));
      const anchor = this.anchors.get(key(parameters[0], parameters[1]));
      const evaluations =
        this.evaluations.get(key(parameters[0], parameters[1], parameters[2])) || [];
      const evaluation = evaluations.find((candidate) =>
        candidate.evaluation_id === parameters[3]);
      if (!plan || plan.work_id !== parameters[1] || !anchor || !evaluation) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{
          plan: plan.plan,
          plan_digest: plan.plan_digest,
          status: plan.status,
          intent_digest: anchor.intent_digest,
          evaluation: evaluation.evaluation,
          evaluation_digest: evaluation.evaluation_digest,
        }],
        rowCount: 1,
      };
    }
    if (q.startsWith("SELECT p.plan,p.plan_digest,p.status,a.intent_digest")) {
      const plan = this.plans.get(key(parameters[0], parameters[2]));
      const anchor = this.anchors.get(key(parameters[0], parameters[1]));
      if (!plan || plan.work_id !== parameters[1] || !anchor) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{
          plan: plan.plan,
          plan_digest: plan.plan_digest,
          status: plan.status,
          intent_digest: anchor.intent_digest,
        }],
        rowCount: 1,
      };
    }
    if (q.startsWith("INSERT INTO core_continuity_closure_evaluations")) {
      const [tenantId, workId, planId, evaluationId, evaluation, evaluationDigest, evaluatedBy] = parameters;
      const evaluationKey = key(tenantId, workId, planId);
      const rows = this.evaluations.get(evaluationKey) || [];
      rows.push({
        evaluation_id: evaluationId,
        evaluation: JSON.parse(evaluation),
        evaluation_digest: evaluationDigest,
        evaluated_by: evaluatedBy,
        created_at: this.clock().toISOString(),
      });
      this.evaluations.set(evaluationKey, rows);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_native_plans SET status='verified'")) {
      this.plans.get(key(parameters[0], parameters[2])).status = "verified";
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT verdict_id,release_intent_digest,")) {
      const row = this.releaseJoins.get(key(parameters[0], parameters[1]));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO core_continuity_release_joins")) {
      const [
        tenantId, workId, planId, evaluationId, verdictId, releaseIntent,
        releaseIntentDigest, coreJoinRecord, coreJoinRecordDigest, createdBy,
      ] = parameters;
      this.releaseJoins.set(key(tenantId, evaluationId), {
        tenant_id: tenantId,
        work_id: workId,
        plan_id: planId,
        evaluation_id: evaluationId,
        verdict_id: verdictId,
        release_intent: JSON.parse(releaseIntent),
        release_intent_digest: releaseIntentDigest,
        core_join_record: JSON.parse(coreJoinRecord),
        core_join_record_digest: coreJoinRecordDigest,
        created_by: createdBy,
        created_at: this.clock().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_works SET status='release_ready'")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      work.status = "release_ready";
      work.next_action =
        "Obtain a fresh Core release verdict, execute through host policy, then verify live readback.";
      work.updated_at = this.clock().toISOString();
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_works SET session_id=")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      work.session_id = parameters[2];
      work.status = "active";
      work.updated_at = this.clock().toISOString();
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_works SET next_action=")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      work.next_action = parameters[2];
      work.updated_at = this.clock().toISOString();
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT evaluation,evaluation_digest FROM core_continuity_closure_evaluations")) {
      const rows = this.evaluations.get(key(parameters[0], parameters[1], parameters[2])) || [];
      return {
        rows: rows.length ? [{
          evaluation: rows.at(-1).evaluation,
          evaluation_digest: rows.at(-1).evaluation_digest,
        }] : [],
        rowCount: rows.length ? 1 : 0,
      };
    }
    if (q.startsWith("UPDATE core_continuity_native_plans SET status='closed'")) {
      const plan = this.plans.get(key(parameters[0], parameters[2]));
      plan.status = "closed";
      plan.closed_at = this.clock().toISOString();
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_works SET status='completed'")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      work.status = "completed";
      work.next_action = "";
      work.live_state_hash = parameters[2];
      work.updated_at = this.clock().toISOString();
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT runbook_digest,status,created_by FROM core_continuity_incident_runbooks")) {
      const row = this.incidents.get(key(parameters[0], parameters[1], parameters[2]));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO core_continuity_incident_runbooks")) {
      const [tenantId, projectId, fingerprint, scope, runbook, runbookDigest,
        createdBy] = parameters;
      this.incidents.set(key(tenantId, projectId, fingerprint), {
        tenant_id: tenantId,
        project_id: projectId,
        fingerprint,
        scope: JSON.parse(scope),
        runbook: JSON.parse(runbook),
        runbook_digest: runbookDigest,
        status: "candidate",
        created_by: createdBy,
      });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`fake_pool_query_not_implemented:${q.slice(0, 180)}`);
  }

  async end() {}
}

const initialInput = {
  project_id: "skinharmony",
  session_id: "chat-session-1",
  initial_message: "Continue until verified; token=do-not-store",
  idea: "Persistent governed work",
  objective: "Resume without repository rescans",
  acceptance_criteria: ["Exact resume"],
  constraints: ["No raw credentials"],
  architecture: { components: [{ id: "core" }] },
  next_action: "Plan native agents",
  host_type: "codex_native",
};

function corePlanFor(work, request) {
  const payload = {
    tenant_id: "tenant-a",
    work_id: work.work_id,
    intent_anchor_digest: work.intent_digest,
    repository: request.repository,
    objective: initialInput.objective,
    required_checks: request.required_checks,
    builder_agent_id: request.tasks.find((task) => task.kind === "builder")?.task_id,
    verifier_agent_ids: request.tasks
      .filter((task) => task.kind === "verifier")
      .map((task) => task.task_id)
      .sort(),
    agents: request.tasks.map((task) => ({
      agent_id: task.task_id,
      role: task.kind,
      task: task.instruction,
      depends_on: task.dependencies || [],
      capabilities: [],
    })),
    maximum_parallel_agents: request.max_parallel || 1,
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

test("ensure survives runtime restart, is strict by default and isolates tenants", async () => {
  let instant = new Date("2026-07-29T12:00:00.000Z");
  const clock = () => new Date(instant);
  const pool = new ContinuityPool(clock);
  const firstRuntime = createWorkContinuityRuntime({}, { pool, now: clock });
  const tenantA = { tenantId: "tenant-a", subject: "codex" };

  const created = await firstRuntime.ensure(tenantA, initialInput, { creationAuthorized: true });
  const replay = await firstRuntime.ensure(tenantA, initialInput);
  assert.equal(created.project_id, initialInput.project_id);
  assert.equal(replay.project_id, initialInput.project_id);
  assert.equal(replay.work_id, created.work_id);
  assert.equal(replay.idempotent_replay, true);
  await assert.rejects(firstRuntime.ensure(tenantA, {
    ...initialInput,
    objective: "Silently replace the original objective",
  }), /continuity_session_intent_conflict/);

  const restartedRuntime = createWorkContinuityRuntime({}, { pool, now: clock });
  const resumed = await restartedRuntime.ensure(tenantA, {
    ...initialInput,
    resume_existing: true,
  });
  assert.equal(resumed.project_id, initialInput.project_id);
  assert.equal(resumed.work_id, created.work_id);
  assert.equal(resumed.resumed_existing, true);
  await assert.rejects(restartedRuntime.ensure(tenantA, {
    ...initialInput,
    objective: "Replace the immutable objective during explicit resume",
    resume_existing: true,
  }), /continuity_resume_intent_mismatch/);
  const trustedFollowup = await restartedRuntime.ensure(tenantA, {
    ...initialInput,
    initial_message: "Short internal follow-up tool command",
    idea: "Short follow-up",
    objective: "Short follow-up",
    resume_existing: true,
  }, { trustedSessionFollowup: true });
  assert.equal(trustedFollowup.project_id, initialInput.project_id);
  assert.equal(trustedFollowup.work_id, created.work_id);
  assert.equal(trustedFollowup.intent_digest, created.intent_digest);

  instant = new Date("2026-07-29T12:01:00.000Z");
  const tenantBWork = await restartedRuntime.ensure({
    tenantId: "tenant-b",
    subject: "codex",
  }, initialInput, { creationAuthorized: true });
  assert.notEqual(tenantBWork.work_id, created.work_id);

  const anchor = await restartedRuntime.readIntent(tenantA, { work_id: created.work_id });
  assert.match(anchor.anchor.initial_message, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(anchor), /do-not-store/);

  const catalog = await restartedRuntime.listWorks(tenantA, { limit: 10 });
  assert.deepEqual(catalog.works.map((work) => work.work_id), [created.work_id]);
  assert.equal(catalog.raw_prompt_fields_returned, false);
  assert.equal("idea" in catalog.works[0], false);
  assert.equal("objective" in catalog.works[0], false);
  assert.equal("anchor" in catalog.works[0], false);
});

test("exact Work resume binds new sessions idempotently without duplicating Work events", async () => {
  const clock = () => new Date("2026-07-31T10:00:00.000Z");
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const tenantA = { tenantId: "tenant-a", subject: "codex" };
  const created = await runtime.ensure(tenantA, initialInput, { creationAuthorized: true });
  const eventKey = key("tenant-a", created.work_id);
  assert.deepEqual(pool.events.get(eventKey).map((event) => event.event_type), [
    "work_created",
    "intent_anchored",
  ]);

  const freshSession = {
    ...initialInput,
    session_id: "chat-session-after-restart",
    work_id: created.work_id,
    resume_existing: true,
  };
  const restartedRuntime = createWorkContinuityRuntime({}, { pool, now: clock });
  const firstResume = await restartedRuntime.ensure(tenantA, freshSession, {
    trustedSessionFollowup: true,
  });
  const secondResume = await restartedRuntime.ensure(tenantA, freshSession, {
    trustedSessionFollowup: true,
  });
  assert.equal(firstResume.work_id, created.work_id);
  assert.equal(firstResume.session_binding_created, true);
  assert.equal(firstResume.idempotent_replay, false);
  assert.equal(secondResume.work_id, created.work_id);
  assert.equal(secondResume.session_binding_created, false);
  assert.equal(secondResume.idempotent_replay, true);
  const freshBindingKey = key(
    "tenant-a",
    initialInput.project_id,
    freshSession.session_id,
  );
  assert.equal(pool.bindings.get(freshBindingKey).work_id, created.work_id);
  const originalBindingDigest = pool.bindings.get(freshBindingKey).create_request_digest;
  pool.bindings.get(freshBindingKey).create_request_digest = "f".repeat(64);
  await assert.rejects(restartedRuntime.ensure(tenantA, freshSession, {
    trustedSessionFollowup: true,
  }), /continuity_session_binding_conflict/);
  pool.bindings.get(freshBindingKey).create_request_digest = originalBindingDigest;
  assert.deepEqual(pool.events.get(eventKey).map((event) => event.event_type), [
    "work_created",
    "intent_anchored",
  ]);

  await assert.rejects(restartedRuntime.ensure(tenantA, {
    ...freshSession,
    project_id: "different-project",
    session_id: "wrong-project-session",
  }, { trustedSessionFollowup: true }), /continuity_project_mismatch/);
  await assert.rejects(restartedRuntime.ensure({
    tenantId: "tenant-b",
    subject: "codex",
  }, {
    ...freshSession,
    session_id: "cross-tenant-session",
  }, { trustedSessionFollowup: true }), /continuity_work_not_found/);

  const secondWork = await restartedRuntime.ensure(tenantA, {
    ...initialInput,
    session_id: "second-work-creator",
  }, { creationAuthorized: true });
  await assert.rejects(restartedRuntime.ensure(tenantA, {
    ...freshSession,
    work_id: secondWork.work_id,
  }, { trustedSessionFollowup: true }), /continuity_session_binding_conflict/);

  const concurrentSession = {
    ...freshSession,
    session_id: "concurrent-resume-session",
  };
  const concurrent = await Promise.all([
    restartedRuntime.ensure(tenantA, concurrentSession, { trustedSessionFollowup: true }),
    restartedRuntime.ensure(tenantA, concurrentSession, { trustedSessionFollowup: true }),
  ]);
  assert.deepEqual(concurrent.map((result) => result.work_id), [created.work_id, created.work_id]);
  assert.equal(concurrent.filter((result) => result.session_binding_created).length, 1);
  assert.equal(pool.bindings.get(key(
    "tenant-a",
    initialInput.project_id,
    concurrentSession.session_id,
  )).work_id, created.work_id);
});

test("Gallery admits multiple tenant-scoped participants and rejects session impersonation", async () => {
  const clock = () => new Date("2026-07-31T11:00:00.000Z");
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const owner = { tenantId: "tenant-a", subject: "owner-subject" };
  const created = await runtime.ensure(owner, initialInput, { creationAuthorized: true });
  const firstJoin = {
    work_id: created.work_id,
    session_id: "participant-session-1",
    agent_id: "codex-builder",
    client_type: "codex",
    ttl_seconds: 300,
    idempotency_key: "participant-join-1",
  };
  const secondJoin = {
    work_id: created.work_id,
    session_id: "participant-session-2",
    agent_id: "chatgpt-verifier",
    client_type: "chatgpt",
    ttl_seconds: 300,
    idempotency_key: "participant-join-2",
  };

  const firstIdentity = galleryIdentity(
    owner.subject, firstJoin.session_id, firstJoin.agent_id, firstJoin.client_type,
  );
  const secondIdentity = galleryIdentity(
    "verifier-subject", secondJoin.session_id, secondJoin.agent_id, secondJoin.client_type,
  );
  const first = await runtime.join(firstIdentity, firstJoin);
  const second = await runtime.join(secondIdentity, secondJoin);
  const replay = await runtime.join(firstIdentity, firstJoin);
  assert.equal(first.participant.session_id, firstJoin.session_id);
  assert.equal(second.participant.session_id, secondJoin.session_id);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(pool.participants.size, 2);

  await assert.rejects(runtime.join(galleryIdentity(
    "cross-tenant-subject", secondJoin.session_id, secondJoin.agent_id,
    secondJoin.client_type, "tenant-b",
  ), {
    ...secondJoin,
    idempotency_key: "cross-tenant-join",
  }), /continuity_work_not_found/);
  await assert.rejects(runtime.join(galleryIdentity(
    "impersonator-subject", firstJoin.session_id, firstJoin.agent_id, firstJoin.client_type,
  ), {
    ...firstJoin,
    idempotency_key: "session-impersonation-attempt",
  }), /continuity_session_conflict/);
  await assert.rejects(runtime.join(galleryIdentity(
    owner.subject, firstJoin.session_id, firstJoin.agent_id, "chatgpt",
  ), {
    ...firstJoin,
    client_type: "chatgpt",
    idempotency_key: "active-client-binding-switch-attempt",
  }), /continuity_session_conflict/);

  assert.deepEqual(pool.events.get(key("tenant-a", created.work_id))
    .map((event) => event.event_type), [
    "work_created",
    "intent_anchored",
    "participant_joined",
    "participant_joined",
  ]);
});

test("Gallery rejects every participant operation from a different signed client type", async () => {
  const clock = () => new Date("2026-07-31T11:15:00.000Z");
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const subject = "client-bound-subject";
  const sessionId = "client-bound-session";
  const agentId = "client-bound-agent";
  const created = await runtime.ensure({ tenantId: "tenant-a", subject }, initialInput, {
    creationAuthorized: true,
  });
  const originalIdentity = galleryIdentity(subject, sessionId, agentId, "codex");
  await runtime.join(originalIdentity, {
    work_id: created.work_id,
    session_id: sessionId,
    agent_id: agentId,
    client_type: "codex",
    ttl_seconds: 300,
    idempotency_key: "client-bound-original-join",
  });

  const forgedClientIdentity = galleryIdentity(subject, sessionId, agentId, "chatgpt");
  const common = {
    work_id: created.work_id,
    session_id: sessionId,
    agent_id: agentId,
    client_type: "chatgpt",
  };
  const cases = [
    ["heartbeat", {
      ttl_seconds: 300,
      idempotency_key: "wrong-client-heartbeat",
    }],
    ["openBranch", {
      branch_key: "wrong-client-branch",
      title: "Wrong client",
      objective: "Must not open",
      idempotency_key: "wrong-client-open-branch",
    }],
    ["acquireLease", {
      purpose: "Must not acquire",
      surfaces: [{ kind: "file", value: "services/client-bound" }],
      ttl_seconds: 300,
      idempotency_key: "wrong-client-acquire",
    }],
    ["renewLease", {
      lease_id: "99999999-9999-4999-8999-999999999999",
      ttl_seconds: 300,
      idempotency_key: "wrong-client-renew",
    }],
    ["releaseLease", {
      lease_id: "99999999-9999-4999-8999-999999999999",
      idempotency_key: "wrong-client-release",
    }],
    ["postMessage", {
      message_type: "update",
      subject: "Wrong client",
      payload: { allowed: false },
      idempotency_key: "wrong-client-message",
    }],
    ["inbox", { limit: 10 }],
  ];
  for (const [method, input] of cases) {
    await assert.rejects(
      runtime[method](forgedClientIdentity, { ...common, ...input }),
      /continuity_participant_not_active/,
      method,
    );
  }
});

test("Gallery idempotency is bound to both operation and authenticated subject", async () => {
  const clock = () => new Date("2026-07-31T11:30:00.000Z");
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const owner = { tenantId: "tenant-a", subject: "idempotency-owner" };
  const created = await runtime.ensure(owner, initialInput, { creationAuthorized: true });
  const input = {
    work_id: created.work_id,
    session_id: "idempotency-bound-session",
    agent_id: "idempotency-bound-agent",
    client_type: "codex",
    ttl_seconds: 300,
    idempotency_key: "shared-operation-idempotency-key",
  };
  const identity = galleryIdentity(
    owner.subject, input.session_id, input.agent_id, input.client_type,
  );
  await runtime.join(identity, input);
  await assert.rejects(runtime.heartbeat(identity, input), /idempotency_key_conflict/);
  await assert.rejects(runtime.join(galleryIdentity(
    "different-authenticated-subject", input.session_id, input.agent_id, input.client_type,
  ), input), /idempotency_key_conflict/);
  assert.equal(pool.participants.size, 1);
});

test("Gallery expires prior-subject leases before reassigning an expired session", async () => {
  let timestamp = Date.parse("2026-07-31T11:00:00.000Z");
  const clock = () => new Date(timestamp);
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const firstSubject = { tenantId: "tenant-a", subject: "subject-a" };
  const secondSubject = { tenantId: "tenant-a", subject: "subject-b" };
  const created = await runtime.ensure(firstSubject, initialInput, { creationAuthorized: true });
  const sessionId = "rebound-participant-session";
  const leaseId = "33333333-3333-4333-8333-333333333333";

  const firstGalleryIdentity = galleryIdentity(
    firstSubject.subject, sessionId, "codex-builder-a", "codex",
  );
  await runtime.join(firstGalleryIdentity, {
    work_id: created.work_id,
    session_id: sessionId,
    agent_id: "codex-builder-a",
    client_type: "codex",
    ttl_seconds: 1,
    idempotency_key: "rebound-participant-a",
  });
  pool.leases.set(key("tenant-a", created.work_id, leaseId), {
    tenant_id: "tenant-a",
    work_id: created.work_id,
    lease_id: leaseId,
    session_id: sessionId,
    branch_id: null,
    purpose: "protect the original subject work",
    status: "active",
    renewed_at: clock().toISOString(),
    expires_at: new Date(timestamp + 3_600_000).toISOString(),
    released_at: null,
  });

  timestamp += 2_000;
  const secondGalleryIdentity = galleryIdentity(
    secondSubject.subject, sessionId, "chatgpt-verifier-b", "chatgpt",
  );
  const rebound = await runtime.join(secondGalleryIdentity, {
    work_id: created.work_id,
    session_id: sessionId,
    agent_id: "chatgpt-verifier-b",
    client_type: "chatgpt",
    ttl_seconds: 300,
    idempotency_key: "rebound-participant-b",
  });

  assert.equal(rebound.rebound_leases_expired, 1);
  assert.equal(pool.participants.get(key("tenant-a", created.work_id, sessionId)).actor_subject,
    secondSubject.subject);
  assert.equal(pool.leases.get(key("tenant-a", created.work_id, leaseId)).status, "expired");
  await assert.rejects(runtime.renewLease(secondGalleryIdentity, {
    work_id: created.work_id,
    session_id: sessionId,
    agent_id: "chatgpt-verifier-b",
    client_type: "chatgpt",
    lease_id: leaseId,
    ttl_seconds: 300,
    idempotency_key: "rebound-renew-denied",
  }), /continuity_lease_not_active/);
  await assert.rejects(runtime.releaseLease(secondGalleryIdentity, {
    work_id: created.work_id,
    session_id: sessionId,
    agent_id: "chatgpt-verifier-b",
    client_type: "chatgpt",
    lease_id: leaseId,
    idempotency_key: "rebound-release-denied",
  }), /continuity_lease_not_active/);
  assert.deepEqual(pool.events.get(key("tenant-a", created.work_id))
    .map((event) => event.event_type), [
    "work_created",
    "intent_anchored",
    "participant_joined",
    "lease_expired",
    "participant_joined",
  ]);
});

test("Gallery expires leases when an expired session changes agent under the same subject", async () => {
  let timestamp = Date.parse("2026-07-31T12:00:00.000Z");
  const clock = () => new Date(timestamp);
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const identitySubject = "stable-oauth-subject";
  const owner = { tenantId: "tenant-a", subject: identitySubject };
  const created = await runtime.ensure(owner, initialInput, { creationAuthorized: true });
  const sessionId = "same-subject-agent-rebind";
  const leaseId = "44444444-4444-4444-8444-444444444444";
  const originalIdentity = galleryIdentity(identitySubject, sessionId, "codex-agent-a", "codex");

  await runtime.join(originalIdentity, {
    work_id: created.work_id,
    session_id: sessionId,
    agent_id: "codex-agent-a",
    client_type: "codex",
    ttl_seconds: 1,
    idempotency_key: "same-subject-original-join",
  });
  pool.leases.set(key("tenant-a", created.work_id, leaseId), {
    tenant_id: "tenant-a",
    work_id: created.work_id,
    lease_id: leaseId,
    session_id: sessionId,
    branch_id: null,
    purpose: "protect the original agent work",
    status: "active",
    renewed_at: clock().toISOString(),
    expires_at: new Date(timestamp + 3_600_000).toISOString(),
    released_at: null,
    created_by: "codex-agent-a",
  });

  timestamp += 2_000;
  const replacementIdentity = galleryIdentity(
    identitySubject, sessionId, "chatgpt-agent-b", "chatgpt",
  );
  const rebound = await runtime.join(replacementIdentity, {
    work_id: created.work_id,
    session_id: sessionId,
    agent_id: "chatgpt-agent-b",
    client_type: "chatgpt",
    ttl_seconds: 300,
    idempotency_key: "same-subject-replacement-join",
  });

  assert.equal(rebound.rebound_leases_expired, 1);
  assert.equal(pool.leases.get(key("tenant-a", created.work_id, leaseId)).status, "expired");
  await assert.rejects(runtime.renewLease(replacementIdentity, {
    work_id: created.work_id,
    session_id: sessionId,
    agent_id: "chatgpt-agent-b",
    client_type: "chatgpt",
    lease_id: leaseId,
    ttl_seconds: 300,
    idempotency_key: "same-subject-old-lease-renew-denied",
  }), /continuity_lease_not_active/);
});

test("Gallery clears cross-branch leases but preserves an exact expired-session resume", async () => {
  let timestamp = Date.parse("2026-07-31T13:00:00.000Z");
  const clock = () => new Date(timestamp);
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const subject = "branch-bound-subject";
  const owner = { tenantId: "tenant-a", subject };
  const created = await runtime.ensure(owner, initialInput, { creationAuthorized: true });
  const branchA = "55555555-5555-4555-8555-555555555555";
  const branchB = "66666666-6666-4666-8666-666666666666";
  for (const branchId of [branchA, branchB]) {
    pool.branches.set(key("tenant-a", created.work_id, branchId), {
      branch_id: branchId,
      status: "active",
    });
  }

  const switchedSession = "cross-branch-rebind-session";
  const switchedIdentity = galleryIdentity(subject, switchedSession, "codex-branch-agent", "codex");
  await runtime.join(switchedIdentity, {
    work_id: created.work_id,
    session_id: switchedSession,
    agent_id: "codex-branch-agent",
    client_type: "codex",
    branch_id: branchA,
    ttl_seconds: 1,
    idempotency_key: "cross-branch-original-join",
  });
  const switchedLeaseId = "77777777-7777-4777-8777-777777777777";
  pool.leases.set(key("tenant-a", created.work_id, switchedLeaseId), {
    tenant_id: "tenant-a",
    work_id: created.work_id,
    lease_id: switchedLeaseId,
    session_id: switchedSession,
    branch_id: branchA,
    purpose: "branch A lease",
    status: "active",
    renewed_at: clock().toISOString(),
    expires_at: new Date(timestamp + 3_600_000).toISOString(),
    released_at: null,
    created_by: "codex-branch-agent",
  });
  timestamp += 2_000;
  const switched = await runtime.join(switchedIdentity, {
    work_id: created.work_id,
    session_id: switchedSession,
    agent_id: "codex-branch-agent",
    client_type: "codex",
    branch_id: branchB,
    ttl_seconds: 300,
    idempotency_key: "cross-branch-replacement-join",
  });
  assert.equal(switched.rebound_leases_expired, 1);
  assert.equal(pool.leases.get(key("tenant-a", created.work_id, switchedLeaseId)).status, "expired");

  const stableSession = "exact-binding-resume-session";
  const stableIdentity = galleryIdentity(subject, stableSession, "codex-stable-agent", "codex");
  await runtime.join(stableIdentity, {
    work_id: created.work_id,
    session_id: stableSession,
    agent_id: "codex-stable-agent",
    client_type: "codex",
    branch_id: branchA,
    ttl_seconds: 1,
    idempotency_key: "exact-binding-original-join",
  });
  const stableLeaseId = "88888888-8888-4888-8888-888888888888";
  pool.leases.set(key("tenant-a", created.work_id, stableLeaseId), {
    tenant_id: "tenant-a",
    work_id: created.work_id,
    lease_id: stableLeaseId,
    session_id: stableSession,
    branch_id: branchA,
    purpose: "same binding lease",
    status: "active",
    renewed_at: clock().toISOString(),
    expires_at: new Date(timestamp + 3_600_000).toISOString(),
    released_at: null,
    created_by: "codex-stable-agent",
  });
  timestamp += 2_000;
  const resumed = await runtime.join(stableIdentity, {
    work_id: created.work_id,
    session_id: stableSession,
    agent_id: "codex-stable-agent",
    client_type: "codex",
    branch_id: branchA,
    ttl_seconds: 300,
    idempotency_key: "exact-binding-resume-join",
  });
  assert.equal(resumed.rebound_leases_expired, 0);
  assert.equal(pool.leases.get(key("tenant-a", created.work_id, stableLeaseId)).status, "active");
  const renewed = await runtime.renewLease(stableIdentity, {
    work_id: created.work_id,
    session_id: stableSession,
    agent_id: "codex-stable-agent",
    client_type: "codex",
    lease_id: stableLeaseId,
    ttl_seconds: 300,
    idempotency_key: "exact-binding-lease-renew",
  });
  assert.equal(renewed.lease.lease_id, stableLeaseId);
  assert.equal(renewed.lease.branch_id, branchA);
  const participantEvents = pool.events.get(key("tenant-a", created.work_id))
    .filter((event) => event.event_type === "participant_joined");
  assert.equal(participantEvents.find((event) =>
    event.payload.session_id === switchedSession &&
    event.payload.branch_id === branchB)?.payload.branch_id, branchB);
  assert.equal(participantEvents.findLast((event) =>
    event.payload.session_id === stableSession)?.payload.branch_id, branchA);
});

test("Gallery expires unbound leases before assigning an active participant branch", async () => {
  const clock = () => new Date("2026-07-31T14:00:00.000Z");
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const subject = "branch-promotion-subject";
  const sessionId = "branch-promotion-session";
  const agentId = "branch-promotion-agent";
  const identity = galleryIdentity(subject, sessionId, agentId, "codex");
  const created = await runtime.ensure({ tenantId: "tenant-a", subject }, initialInput, {
    creationAuthorized: true,
  });
  await runtime.join(identity, {
    work_id: created.work_id,
    session_id: sessionId,
    agent_id: agentId,
    client_type: "codex",
    ttl_seconds: 300,
    idempotency_key: "branch-promotion-join",
  });
  const leaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  pool.leases.set(key("tenant-a", created.work_id, leaseId), {
    tenant_id: "tenant-a",
    work_id: created.work_id,
    lease_id: leaseId,
    session_id: sessionId,
    branch_id: null,
    purpose: "unbound work before branch selection",
    status: "active",
    renewed_at: clock().toISOString(),
    expires_at: "2026-07-31T15:00:00.000Z",
    released_at: null,
    created_by: agentId,
  });

  const opened = await runtime.openBranch(identity, {
    work_id: created.work_id,
    session_id: sessionId,
    agent_id: agentId,
    client_type: "codex",
    branch_key: "implementation",
    title: "Implementation",
    objective: "Bind the participant without inheriting its unbound lease.",
    idempotency_key: "branch-promotion-open",
  });

  assert.equal(opened.rebound_leases_expired, 1);
  assert.equal(pool.leases.get(key("tenant-a", created.work_id, leaseId)).status, "expired");
  assert.equal(
    pool.participants.get(key("tenant-a", created.work_id, sessionId)).branch_id,
    opened.branch.branch_id,
  );
  const events = pool.events.get(key("tenant-a", created.work_id));
  assert.deepEqual(events.map((event) => event.event_type), [
    "work_created",
    "intent_anchored",
    "participant_joined",
    "lease_expired",
    "branch_opened",
  ]);
  assert.equal(events.at(-2).payload.reason, "participant_branch_bound");

  const joinSessionId = "active-join-branch-promotion";
  const joinAgentId = "active-join-branch-agent";
  const joinIdentity = galleryIdentity(subject, joinSessionId, joinAgentId, "codex");
  await runtime.join(joinIdentity, {
    work_id: created.work_id,
    session_id: joinSessionId,
    agent_id: joinAgentId,
    client_type: "codex",
    ttl_seconds: 300,
    idempotency_key: "active-join-before-branch",
  });
  const joinLeaseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  pool.leases.set(key("tenant-a", created.work_id, joinLeaseId), {
    tenant_id: "tenant-a",
    work_id: created.work_id,
    lease_id: joinLeaseId,
    session_id: joinSessionId,
    branch_id: null,
    purpose: "unbound lease before join branch promotion",
    status: "active",
    renewed_at: clock().toISOString(),
    expires_at: "2026-07-31T15:00:00.000Z",
    released_at: null,
    created_by: joinAgentId,
  });
  const promoted = await runtime.join(joinIdentity, {
    work_id: created.work_id,
    session_id: joinSessionId,
    agent_id: joinAgentId,
    client_type: "codex",
    branch_id: opened.branch.branch_id,
    ttl_seconds: 300,
    idempotency_key: "active-join-with-branch",
  });
  assert.equal(promoted.rebound_leases_expired, 1);
  assert.equal(pool.leases.get(key("tenant-a", created.work_id, joinLeaseId)).status, "expired");
  assert.equal(promoted.participant.branch_id, opened.branch.branch_id);
});

test("first Work Identity fails closed without owner creation authorization", async () => {
  const pool = new ContinuityPool(() => new Date("2026-07-30T12:00:00.000Z"));
  const runtime = createWorkContinuityRuntime({}, { pool });
  const owner = { tenantId: "tenant-a", subject: "owner-subject" };
  const baseline = {
    ...initialInput,
    session_id: "owner-bound-session",
  };
  const created = await runtime.ensure(owner, baseline, { creationAuthorized: true });
  assert.equal(pool.works.size, 1);

  for (const [role, identity] of [
    ["member", { tenantId: "tenant-a", subject: "member-subject", tenantMembershipRole: "member" }],
    ["self_service", { tenantId: "tenant-a", subject: "self-service-subject", selfServiceTenant: true }],
    ["support_delegate", { tenantId: "tenant-a", subject: "support-subject", tenantMembershipRole: "support_delegate" }],
  ]) {
    await assert.rejects(
      runtime.ensure(identity, {
        ...baseline,
        session_id: `unbound-${role}-session`,
      }, { creationAuthorized: false }),
      /continuity_creation_owner_confirmation_required/,
    );
  }
  assert.equal(pool.works.size, 1);

  const resumed = await runtime.ensure(owner, {
    ...baseline,
    resume_existing: true,
  }, { creationAuthorized: false });
  assert.equal(resumed.work_id, created.work_id);
  assert.equal(resumed.resumed_existing, true);
  assert.equal(pool.works.size, 1);
});

test("native plan replay is deterministic and receipts preserve host policy boundaries", async () => {
  const instant = new Date("2026-07-29T13:00:00.000Z");
  const clock = () => new Date(instant);
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const identity = {
    tenantId: "tenant-a",
    subject: "coordinator",
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      session_fingerprint: "a".repeat(64),
      host_transport_session_fingerprint: "1".repeat(64),
      signature: `ags_${"a".repeat(32)}`,
      transport_bound: true,
    },
  };
  const work = await runtime.ensure(identity, initialInput, { creationAuthorized: true });
  const request = {
    work_id: work.work_id,
    repository: "owner/repo",
    host_type: "codex_native",
    required_checks: ["core-mcp"],
    tasks: [
      { task_id: "build", kind: "builder", instruction: "Implement." },
      {
        task_id: "verify",
        kind: "verifier",
        instruction: "Verify independently.",
        dependencies: ["build"],
      },
    ],
    max_parallel: 2,
    idempotency_key: "native-plan-stable",
  };
  const corePlan = corePlanFor(work, request);
  const planned = await runtime.planNativeAgents(identity, request, { corePlan });
  const rotatedTransportIdentity = {
    ...identity,
    agentPresence: {
      ...identity.agentPresence,
      host_transport_session_fingerprint: "2".repeat(64),
    },
  };
  const replay = await runtime.planNativeAgents(
    rotatedTransportIdentity,
    request,
    { corePlan },
  );
  assert.equal(replay.plan.plan_id, planned.plan.plan_id);
  assert.equal(replay.idempotent_replay, true);
  await assert.rejects(runtime.planNativeAgents({
    ...rotatedTransportIdentity,
    agentPresence: {
      ...rotatedTransportIdentity.agentPresence,
      session_fingerprint: "9".repeat(64),
    },
  }, request, { corePlan }), /idempotency_key_conflict/);
  assert.equal(planned.receipt.host_type, "codex_native");
  assert.equal(planned.receipt.coordinator_session_fingerprint, "a".repeat(64));
  assert.equal(planned.receipt.host_policy_override, false);
  assert.equal(planned.receipt.host_policy_must_allow, true);
  assert.equal(planned.receipt.provider_execution, false);
  const changedRequest = {
    ...request,
    tasks: [
      { task_id: "build", kind: "builder", instruction: "Changed instruction." },
      request.tasks[1],
    ],
  };
  await assert.rejects(runtime.planNativeAgents(
    identity,
    changedRequest,
    { corePlan: corePlanFor(work, changedRequest) },
  ), /idempotency_key_conflict/);
  await assert.rejects(runtime.planNativeAgents(identity, {
    ...request,
    idempotency_key: "native-plan-no-core",
  }), /core_host_native_work_plan/);
});

test("native agent leases enforce Core max_parallel and expire stale host bindings", async () => {
  let instant = new Date("2026-07-29T13:10:00.000Z");
  const clock = () => new Date(instant);
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({
    dttAgentIdentitySigningSecret: "d".repeat(32),
  }, { pool, now: clock });
  const legacyFallbackOnlyRuntime = createWorkContinuityRuntime({
    agentSignatureSecret: "a".repeat(32),
    ownerContextSigningSecret: "o".repeat(32),
  }, { pool, now: clock });
  const identity = {
    tenantId: "tenant-a",
    subject: "coordinator",
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      session_fingerprint: "b".repeat(64),
      host_transport_session_fingerprint: "3".repeat(64),
      signature: `ags_${"b".repeat(32)}`,
      transport_bound: true,
    },
  };
  const work = await runtime.ensure(identity, {
    ...initialInput,
    session_id: "parallel-session",
  }, { creationAuthorized: true });
  const request = {
    work_id: work.work_id,
    repository: "owner/repo",
    host_type: "codex_native",
    required_checks: ["core-mcp"],
    tasks: [
      { task_id: "build", kind: "builder", instruction: "Implement." },
      { task_id: "research", kind: "researcher", instruction: "Inspect evidence." },
      {
        task_id: "verify",
        kind: "verifier",
        instruction: "Verify independently.",
        dependencies: ["build", "research"],
      },
    ],
    max_parallel: 1,
    idempotency_key: "parallel-plan",
  };
  const planned = await runtime.planNativeAgents(identity, request, {
    corePlan: corePlanFor(work, request),
  });
  await assert.rejects(
    legacyFallbackOnlyRuntime.bindNativeAgent(identity, {
      work_id: work.work_id,
      plan_id: planned.plan.plan_id,
      task_id: "build",
      native_agent_id: "legacy-fallback-builder",
      host_type: "codex_native",
      host_task_id: "/root/legacy-fallback-build",
    }),
    /native_agent_assignment_signing_unavailable/,
  );
  const bind = (taskId, agentId, coordinator = identity) => runtime.bindNativeAgent(coordinator, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    task_id: taskId,
    native_agent_id: agentId,
    host_type: "codex_native",
    host_task_id: `/root/${taskId}`,
  });
  const rotatedTransportIdentity = {
    ...identity,
    agentPresence: {
      ...identity.agentPresence,
      host_transport_session_fingerprint: "4".repeat(64),
    },
  };
  const builderBinding = await bind(
    "build",
    "codex-builder",
    rotatedTransportIdentity,
  );
  await assert.rejects(bind("research", "different-logical-session", {
    ...rotatedTransportIdentity,
    agentPresence: {
      ...rotatedTransportIdentity.agentPresence,
      session_fingerprint: "c".repeat(64),
    },
  }), /native_agent_coordinator_session_mismatch/);
  await assert.rejects(bind("research", "codex-researcher"), /native_agent_parallel_limit_reached/);

  instant = new Date("2026-07-29T14:11:00.000Z");
  const expiredBuilderIdentity = {
    ...identity,
    agentPresence: {
      agent_id: "codex-builder",
      client_type: "codex",
      session_fingerprint: "1".repeat(64),
      host_transport_session_fingerprint: "1".repeat(64),
      signature: `ags_${"1".repeat(32)}`,
      transport_bound: true,
    },
  };
  await assert.rejects(runtime.reportNativeAgent(expiredBuilderIdentity, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    native_agent_id: "codex-builder",
    host_task_id: "/root/build",
    assignment_capability: builderBinding.assignment_capability,
    status: "completed",
    report: {
      summary: "Late result.",
      commit_sha: "e".repeat(40),
      tests: [{ name: "late", passed: true }],
      evidence_refs: ["late:result"],
    },
  }), /native_agent_binding_expired_replan_required/);
  const expiredBuilder = pool.nativeAgents.get(
    key("tenant-a", planned.plan.plan_id, "build"),
  );
  assert.equal(expiredBuilder.status, "expired");
  assert.equal(pool.plans.get(key("tenant-a", planned.plan.plan_id)).status, "blocked");
  assert.equal(pool.works.get(key("tenant-a", work.work_id)).status, "blocked");
  assert.match(
    pool.works.get(key("tenant-a", work.work_id)).next_action,
    /fresh bounded plan/,
  );
  assert.equal(
    (pool.events.get(key("tenant-a", work.work_id)) || []).at(-1).event_type,
    "native_agent_lease_expired",
  );
  await assert.rejects(
    bind("research", "codex-researcher"),
    /native_agent_plan_not_open/,
  );
});

test("operational failures create one exact indexed blocker without raw error text", async () => {
  const instant = new Date("2026-07-29T14:20:00.000Z");
  const clock = () => new Date(instant);
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const identity = {
    tenantId: "tenant-a",
    subject: "coordinator",
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      session_fingerprint: "f".repeat(64),
    },
  };
  const work = await runtime.ensure(identity, {
    ...initialInput,
    session_id: "operational-incident-session",
  }, { creationAuthorized: true });
  const input = {
    work_id: work.work_id,
    operation: "work_continuity_closure_finalize",
    error_code: "trusted_readback_checks_not_ready",
    evidence_digest: "8".repeat(64),
    next_action: "Correct the exact CI failure and obtain independent review.",
  };

  const first = await runtime.recordOperationalIncident(identity, input);
  const replay = await runtime.recordOperationalIncident(identity, input);

  assert.equal(first.status, "candidate");
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.fingerprint, first.fingerprint);
  assert.equal(pool.incidents.size, 1);
  assert.equal(pool.works.get(key("tenant-a", work.work_id)).status, "blocked");
  const serialized = JSON.stringify([...pool.incidents.values()]);
  assert.doesNotMatch(serialized, /token|password|raw error/i);
  assert.match(serialized, /TRUSTED_READBACK_CHECKS_NOT_READY/);
});

test("cross-chat resume preserves same-session plans and supersedes stale coordinator bindings", async () => {
  const instant = new Date("2026-07-29T13:20:00.000Z");
  const clock = () => new Date(instant);
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const identity = {
    tenantId: "tenant-a",
    subject: "coordinator",
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      session_fingerprint: "c".repeat(64),
      host_transport_session_fingerprint: "5".repeat(64),
      signature: `ags_${"c".repeat(32)}`,
      transport_bound: true,
    },
  };
  const work = await runtime.ensure(identity, {
    ...initialInput,
    session_id: "cross-chat-source",
  }, { creationAuthorized: true });
  const request = {
    work_id: work.work_id,
    repository: "owner/repo",
    host_type: "codex_native",
    required_checks: ["core-mcp"],
    tasks: [
      { task_id: "build", kind: "builder", instruction: "Implement." },
      {
        task_id: "verify",
        kind: "verifier",
        instruction: "Verify.",
        dependencies: ["build"],
      },
    ],
    idempotency_key: "cross-chat-plan",
  };
  const planned = await runtime.planNativeAgents(identity, request, {
    corePlan: corePlanFor(work, request),
  });
  const stateHashes = {
    repository_hash: "1".repeat(64),
    policy_hash: "2".repeat(64),
    live_state_hash: "3".repeat(64),
  };
  const capsule = {
    snapshot: { components: [{ id: "core" }] },
    next_action: "Continue with a fresh native coordinator when needed.",
    state_hashes: stateHashes,
  };
  pool.capsules.set(key("tenant-a", work.work_id), {
    capsule_id: "11111111-1111-4111-8111-111111111111",
    capsule,
    capsule_digest: digest(capsule),
    supervisor_approved: true,
  });
  const authorization = { allowed: true, decision_id: "core-resume-1" };
  const sameSession = await runtime.resume(identity, {
    work_id: work.work_id,
    session_id: "cross-chat-same-host",
    current_state_hashes: stateHashes,
    idempotency_key: "resume-same-host",
  }, authorization);
  assert.equal(sameSession.native_replan_required, false);
  assert.equal(pool.plans.get(key("tenant-a", planned.plan.plan_id)).status, "planned");

  const newIdentity = {
    ...identity,
    agentPresence: {
      ...identity.agentPresence,
      session_fingerprint: "d".repeat(64),
    },
  };
  const newSession = await runtime.resume(newIdentity, {
    work_id: work.work_id,
    session_id: "cross-chat-new-host",
    current_state_hashes: stateHashes,
    idempotency_key: "resume-new-host",
  }, { allowed: true, decision_id: "core-resume-2" });
  assert.equal(newSession.native_replan_required, true);
  assert.deepEqual(newSession.superseded_plan_ids, [planned.plan.plan_id]);
  assert.equal(pool.plans.get(key("tenant-a", planned.plan.plan_id)).status, "superseded");
  await assert.rejects(runtime.bindNativeAgent(newIdentity, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    task_id: "build",
    native_agent_id: "new-builder",
    host_type: "codex_native",
    host_task_id: "/root/new-build",
  }), /native_agent_plan_not_open/);
});

test("local closure becomes release-ready and external completion needs exact Core ticket bindings", async () => {
  let clockMillis = Date.parse("2026-07-29T13:30:00.000Z");
  const clock = () => new Date(clockMillis);
  const pool = new ContinuityPool(clock);
  const closureAttestationSecret =
    "continuity-closure-attestation-test-secret-0123456789";
  const runtime = createWorkContinuityRuntime({
    dttAgentIdentitySigningSecret: closureAttestationSecret,
  }, { pool, now: clock });
  const identity = {
    tenantId: "tenant-a",
    subject: "coordinator",
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      session_fingerprint: "d".repeat(64),
      host_transport_session_fingerprint: "6".repeat(64),
      signature: `ags_${"d".repeat(32)}`,
      transport_bound: true,
    },
  };
  const work = await runtime.ensure(identity, {
    ...initialInput,
    session_id: "closure-session",
  }, { creationAuthorized: true });
  const planRequest = {
    work_id: work.work_id,
    repository: "owner/repo",
    base_branch: "main",
    host_type: "codex_native",
    required_checks: ["core-mcp"],
    tasks: [
      { task_id: "build", kind: "builder", instruction: "Implement." },
      {
        task_id: "verify",
        kind: "verifier",
        instruction: "Verify independently.",
        dependencies: ["build"],
      },
    ],
    idempotency_key: "closure-plan",
  };
  const requiredChecksPolicy = {
    schema_version: "host_native_required_checks_policy_v1",
    tenant_id: "tenant-a",
    repository: "owner/repo",
    base_branch: "main",
    required_checks: ["core-mcp"],
    check_app: { id: 15_368, slug: "github-actions", owner: "github" },
    workflow: {
      id: 312_527_659,
      name: "Nyra Core Intelligence",
      path: ".github/workflows/nyra-core-intelligence.yml",
      sha256: "7".repeat(64),
    },
    allowed_events: ["pull_request", "push"],
  };
  const requiredChecksPolicyResolver = async (request) => {
    assert.deepEqual(request, {
      tenant_id: "tenant-a",
      repository: "owner/repo",
      base_branch: "main",
    });
    return requiredChecksPolicy;
  };
  let externalReadbackCalls = 0;
  const externalReadbackVerifier = async ({ ticket, target_commit }) => {
    externalReadbackCalls += 1;
    const binding = ticket.release_manifest_binding;
    const githubUnsigned = {
      repository: ticket.repository,
      target_commit,
      checks_commit: binding.verification.checks_commit,
      checks_passed: true,
      required_checks: [...binding.verification.required_checks],
      observed_checks: binding.verification.required_checks.map((name) => ({
        name,
        head_commit: binding.verification.checks_commit,
        status: "completed",
        conclusion: "success",
      })),
      rollback_commit_available: true,
    };
    const services = binding.delivery.services.map((expected) => {
      const unsigned = {
        service_id: expected.service_id,
        environment: expected.environment,
        origin: expected.origin,
        deployment_id: `${expected.service_id}:${target_commit}`,
        live_commit: target_commit,
        version: "0.16.0",
        health_status: "healthy",
        health_contract_digest: expected.health_contract_digest,
        rollback_commit: binding.rollback.target_commit,
        rollback_status: "previous_live_attested",
      };
      return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
    });
    return {
      schema_version: "host_native_external_readback_v1",
      trusted: true,
      verifier_id: "core_server_external_readback_v1",
      verified_at: clock().toISOString(),
      github: {
        ...githubUnsigned,
        readback_digest: hostNativeDigest(githubUnsigned),
      },
      services,
      external_side_effect: false,
      provider_execution: false,
    };
  };
  const realCore = createHostNativeGovernance({
    store: createInMemoryHostNativeGovernanceStore(),
    signingSecret: "core-contract-test-signing-secret-0123456789abcdef",
    closureAttestationSigningSecret: closureAttestationSecret,
    requiredChecksPolicyResolver,
    externalReadbackVerifier,
    releaseJoinVerdictResolver: async (request) => ({
      schema_version: "host_native_release_join_resolution_v1",
      trusted: true,
      authority: "universal_core",
      allowed: true,
      verdict_id: request.verdict_id,
      tenant_id: request.tenant_id,
      work_id: request.work_id,
      repository: request.repository,
      evidence_digest: request.evidence_digest,
      issued_at: clock().toISOString(),
      resolved_at: clock().toISOString(),
      provider_execution: false,
    }),
    now: () => clock().getTime(),
  });
  const corePlanRequest = {
    tenant_id: "tenant-a",
    work_id: work.work_id,
    intent_anchor_digest: work.intent_digest,
    repository: planRequest.repository,
    objective: initialInput.objective,
    required_checks: planRequest.required_checks,
    agents: planRequest.tasks.map((task) => ({
      agent_id: task.task_id,
      role: task.kind,
      task: task.instruction,
      depends_on: task.dependencies || [],
      capabilities: [],
    })),
    max_parallel: 1,
  };
  await assert.rejects(
    realCore.buildWorkPlan(corePlanRequest),
    /base_branch_invalid/,
  );
  const governedCorePlan = await realCore.buildWorkPlan({
    ...corePlanRequest,
    base_branch: planRequest.base_branch,
  });
  const planned = await runtime.planNativeAgents(identity, planRequest, {
    corePlan: governedCorePlan,
  });
  assert.equal(planned.plan.core_authority.base_branch, "main");
  assert.equal(
    planned.plan.core_authority.required_checks_policy_digest,
    governedCorePlan.required_checks_policy_digest,
  );
  const planId = planned.plan.plan_id;
  const builderBinding = await runtime.bindNativeAgent(identity, {
    work_id: work.work_id,
    plan_id: planId,
    task_id: "build",
    native_agent_id: "codex-builder",
    host_type: "codex_native",
    host_task_id: "/root/build",
  });
  await assert.rejects(runtime.bindNativeAgent(identity, {
    work_id: work.work_id,
    plan_id: planId,
    task_id: "verify",
    native_agent_id: "codex-verifier",
    host_type: "codex_native",
    host_task_id: "/root/verify",
  }), /native_agent_dependency_not_ready/);
  const builderIdentity = {
    ...identity,
    agentPresence: {
      agent_id: "codex-builder",
      client_type: "codex",
      session_fingerprint: "1".repeat(64),
      host_transport_session_fingerprint: "1".repeat(64),
      signature: `ags_${"1".repeat(32)}`,
      transport_bound: true,
    },
  };
  await assert.rejects(runtime.reportNativeAgent(identity, {
    work_id: work.work_id,
    plan_id: planId,
    native_agent_id: "codex-builder",
    host_task_id: "/root/build",
    assignment_capability: builderBinding.assignment_capability,
    status: "completed",
    report: {
      summary: "Coordinator must not impersonate the builder.",
      commit_sha: "e".repeat(40),
      tests: [{ name: "node --test", passed: true }],
      evidence_refs: ["commit:pending"],
    },
  }), /native_agent_reporter_presence_required/);
  await runtime.reportNativeAgent(builderIdentity, {
    work_id: work.work_id,
    plan_id: planId,
    native_agent_id: "codex-builder",
    host_task_id: "/root/build",
    assignment_capability: builderBinding.assignment_capability,
    status: "completed",
    report: {
      summary: "Implementation completed.",
      commit_sha: "e".repeat(40),
      tests: [{ name: "node --test", passed: true }],
      evidence_refs: ["commit:pending"],
    },
  });
  const verifierBinding = await runtime.bindNativeAgent(identity, {
    work_id: work.work_id,
    plan_id: planId,
    task_id: "verify",
    native_agent_id: "codex-verifier",
    host_type: "codex_native",
    host_task_id: "/root/verify",
  });
  const reusedVerifierIdentity = {
    ...builderIdentity,
    agentPresence: {
      ...builderIdentity.agentPresence,
      agent_id: "codex-verifier",
      signature: `ags_${"2".repeat(32)}`,
    },
  };
  const verifierReportInput = {
    work_id: work.work_id,
    plan_id: planId,
    native_agent_id: "codex-verifier",
    host_task_id: "/root/verify",
    assignment_capability: verifierBinding.assignment_capability,
    status: "completed",
    report: {
      summary: "Independent verification passed.",
      commit_sha: "e".repeat(40),
      verdict: "approved",
      verifies_task_ids: ["build"],
      evidence_refs: ["review:independent"],
      acceptance_evidence: planned.plan.acceptance_contract.criteria.map((criterion) => ({
        criterion_digest: criterion.criterion_digest,
        passed: true,
        evidence_refs: [`evidence:${criterion.criterion_id}`],
      })),
    },
  };
  await assert.rejects(
    runtime.reportNativeAgent(reusedVerifierIdentity, verifierReportInput),
    /native_agent_reporter_reuse_denied/,
  );
  const verifierIdentity = {
    ...identity,
    agentPresence: {
      agent_id: "codex-verifier",
      client_type: "codex",
      session_fingerprint: "2".repeat(64),
      host_transport_session_fingerprint: "2".repeat(64),
      signature: `ags_${"3".repeat(32)}`,
      transport_bound: true,
    },
  };
  await runtime.reportNativeAgent(verifierIdentity, verifierReportInput);
  await assert.rejects(runtime.evaluateClosure(identity, {
    work_id: work.work_id,
    plan_id: planId,
    release: {
      base_branch: "develop",
      delivery_branch: "develop",
      base_commit: "a".repeat(40),
      head_commit: "e".repeat(40),
      tree_sha: "b".repeat(40),
      diff_digest: "c".repeat(64),
      changed_files: ["services/skinharmony-core-mcp/src/server.js"],
      delivery: {
        method: "github_protected_push_auto_deploy",
        services: [{
          service_id: "srv-core-mcp",
          environment: "production",
          expected_previous_commit: "a".repeat(40),
          target_commit: null,
          target_resolution: "post_merge_readback",
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        }],
      },
      rollback: {
        mode: "forward_revert",
        target_commit: "a".repeat(40),
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        ready: true,
      },
    },
    idempotency_key: "closure-wrong-base-branch",
  }), /continuity_release_base_branch_policy_mismatch/);
  const releaseDiffDigest = hostNativeGithubDiffDigest({
    repository: "owner/repo",
    base_commit: "a".repeat(40),
    head_commit: "e".repeat(40),
    tree_sha: "b".repeat(40),
    changed_files: ["services/skinharmony-core-mcp/src/server.js"],
  });
  const evaluation = await runtime.evaluateClosure(identity, {
    work_id: work.work_id,
    plan_id: planId,
    release: {
      base_branch: "main",
      delivery_branch: "main",
      base_commit: "a".repeat(40),
      head_commit: "e".repeat(40),
      tree_sha: "b".repeat(40),
      diff_digest: releaseDiffDigest,
      changed_files: ["services/skinharmony-core-mcp/src/server.js"],
      delivery: {
        method: "github_protected_push_auto_deploy",
        services: [{
          service_id: "srv-core-mcp",
          environment: "production",
          expected_previous_commit: "a".repeat(40),
          target_commit: null,
          target_resolution: "post_merge_readback",
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        }],
      },
      rollback: {
        mode: "forward_revert",
        target_commit: "a".repeat(40),
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        ready: true,
      },
    },
    idempotency_key: "closure-evaluation",
  });
  assert.equal(evaluation.closed, true);
  assert.equal(pool.works.get(key("tenant-a", work.work_id)).status, "active");
  assert.equal(pool.plans.get(key("tenant-a", planId)).status, "planned");
  assert.equal(evaluation.core_join_required, true);
  const {
    work_id: _releaseWorkId,
    intent_anchor_digest: _releaseIntentDigest,
    repository: _releaseRepository,
    verification: _releaseVerification,
    ...releaseInput
  } = evaluation.core_join_material.release_intent_request;
  const exactReplay = await runtime.evaluateClosure(identity, {
    work_id: work.work_id,
    plan_id: planId,
    release: releaseInput,
    idempotency_key: "closure-evaluation",
  });
  assert.equal(exactReplay.idempotent_replay, true);
  assert.equal(
    exactReplay.core_join_material.material_digest,
    evaluation.core_join_material.material_digest,
  );
  assert.equal(
    coreJoinIdempotencyKey(exactReplay.core_join_material),
    coreJoinIdempotencyKey(evaluation.core_join_material),
  );
  const correctedRelease = await runtime.evaluateClosure(identity, {
    work_id: work.work_id,
    plan_id: planId,
    release: {
      ...releaseInput,
      diff_digest: "9".repeat(64),
    },
    idempotency_key: "closure-evaluation-corrected-release",
  });
  assert.equal(correctedRelease.evaluation_digest, evaluation.evaluation_digest);
  assert.notEqual(
    correctedRelease.core_join_material.material_digest,
    evaluation.core_join_material.material_digest,
  );
  assert.notEqual(
    coreJoinIdempotencyKey(correctedRelease.core_join_material),
    coreJoinIdempotencyKey(evaluation.core_join_material),
  );
  await assert.rejects(runtime.evaluateClosure(identity, {
    work_id: work.work_id,
    plan_id: planId,
    release: {
      ...releaseInput,
      builder_report: { agent_id: "caller-injected-builder" },
    },
    idempotency_key: "closure-caller-evidence-injection",
  }), /continuity_release_fields_invalid/);

  const releaseIntent = buildHostReleaseIntentV1({
    tenant_id: "tenant-a",
    ...evaluation.core_join_material.release_intent_request,
  });
  const coreJoinRecord = await realCore.issueCoreJoinVerdict({
    tenant_id: "tenant-a",
    ...evaluation.core_join_material.core_join_request,
    release_intent: releaseIntent,
    idempotency_key: "real-core-hnj-contract",
  });
  const verdict = coreJoinRecord.verdict;
  const verdictId = verdict.verdict_id;
  const expectedCoreClaim = {
    tenant_id: "tenant-a",
    ...evaluation.core_join_material.core_join_request,
    release_intent_digest: releaseIntent.release_intent_digest,
    base_branch: releaseIntent.base_branch,
    required_checks_policy_digest:
      planned.plan.core_authority.required_checks_policy_digest,
  };
  assert.deepEqual(
    Object.fromEntries(Object.keys(expectedCoreClaim).map((field) => [
      field,
      verdict[field],
    ])),
    expectedCoreClaim,
  );
  assert.equal(
    verdict.claim_digest,
    hostNativeDigest({
      schema_version: "host_native_core_join_claim_v1",
      ...expectedCoreClaim,
    }),
  );
  await assert.rejects(runtime.bindCoreJoinVerdict(identity, {
    work_id: work.work_id,
    plan_id: planId,
    evaluation_id: evaluation.evaluation_id,
  }, {
    releaseIntent,
    coreJoinRecord: {
      ...coreJoinRecord,
      verdict: { ...verdict, work_id: "caller-swapped-work" },
    },
  }), /continuity_core_join_claim_payload_mismatch/);
  assert.equal(pool.works.get(key("tenant-a", work.work_id)).status, "active");
  assert.equal(pool.releaseJoins.size, 0);
  const joined = await runtime.bindCoreJoinVerdict(identity, {
    work_id: work.work_id,
    plan_id: planId,
    evaluation_id: evaluation.evaluation_id,
  }, { releaseIntent, coreJoinRecord });
  assert.equal(joined.release_ready, true);
  assert.equal(pool.works.get(key("tenant-a", work.work_id)).status, "release_ready");
  assert.equal(pool.plans.get(key("tenant-a", planId)).status, "verified");
  assert.equal(pool.releaseJoins.size, 1);

  const evaluationDigest = evaluation.evaluation_digest;
  const releaseIntentDigest = releaseIntent.release_intent_digest;
  const coreJoinRecordDigest = digest(coreJoinRecord);
  const coreJoinClaimDigest = coreJoinRecord.claim_digest;
  const verdictObjectDigest = digest(verdict);
  assert.equal(new Set([
    evaluationDigest,
    releaseIntentDigest,
    coreJoinRecordDigest,
    verdictObjectDigest,
  ]).size, 4);
  assert.equal(new Set([
    evaluationDigest,
    releaseIntentDigest,
    coreJoinRecordDigest,
    verdictObjectDigest,
    coreJoinClaimDigest,
  ]).size, 5);
  assert.equal(coreJoinRecord.claim.evaluation_digest, evaluationDigest);

  const releaseManifest = buildHostReleaseManifestV2({
    schema_version: "host_release_manifest_v2",
    manifest_id: "closure-contract-manifest",
    tenant_id: "tenant-a",
    ...evaluation.core_join_material.release_intent_request,
    verification: {
      ...evaluation.core_join_material.release_intent_request.verification,
      core_join_verdict_id: verdictId,
    },
  });
  const delegation = await realCore.issueDelegation({
    tenant_id: "tenant-a",
    work_id: work.work_id,
    intent_anchor_digest: work.intent_digest,
    repository: "owner/repo",
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: `osf_${"a".repeat(64)}`,
      consent_nonce: "closure-contract-owner-consent",
      confirmation_reference: "bounded closure contract test",
    },
    audience: ["codex_native"],
    allowed_branches: ["agent/native-work", "main"],
    protected_branches: ["main"],
    allowed_path_prefixes: ["services/skinharmony-core-mcp"],
    allowed_actions: ["github.merge"],
    budget: {
      max_agents: 1,
      max_parallel: 1,
      max_commits: 1,
      max_pushes: 1,
      max_deploys: 1,
      max_total_actions: 1,
    },
    release_policy: {
      manifest_required_for_protected_push: true,
      manifest_required_for_induced_deploy: true,
      manifest_required_for_deploy: true,
      independent_verifier_required: true,
      rollback_required: true,
      required_checks: ["core-mcp"],
    },
    expires_at: new Date(clockMillis + 60 * 60_000).toISOString(),
    idempotency_key: "closure-contract-delegation",
  });
  const liveCommit = "9".repeat(40);
  const issuedTicket = await realCore.issueActionTicket({
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    work_id: work.work_id,
    intent_anchor_digest: work.intent_digest,
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: identity.agentPresence.session_fingerprint,
    action: {
      kind: "github.merge",
      repository: "owner/repo",
      head_branch: "agent/native-work",
      base_branch: "main",
      pull_request: 215,
      head_commit: evaluation.target_commit,
      expected_base_commit: "a".repeat(40),
      merge_method: "merge",
      checks_verified: true,
      checks_commit: evaluation.target_commit,
      changed_files: ["services/skinharmony-core-mcp/src/server.js"],
      force: false,
      delete_ref: false,
      tags: false,
      induced_effects: [{
        service_id: "srv-core-mcp",
        environment: "production",
        trigger: "github_auto_deploy",
      }],
      provider_execution: false,
    },
    evidence_digest: coreJoinRecordDigest,
    release_manifest: releaseManifest,
    idempotency_key: "closure-contract-ticket",
  });
  const ticketId = issuedTicket.ticket.ticket_id;
  const reservedTicket = await realCore.reserveActionTicket({
    tenant_id: "tenant-a",
    ticket_id: ticketId,
    host_session_fingerprint: identity.agentPresence.session_fingerprint,
    idempotency_key: "closure-contract-reserve",
  });
  await realCore.completeActionTicket({
    tenant_id: "tenant-a",
    ticket_id: ticketId,
    reservation_id: reservedTicket.reservation_id,
    host_session_fingerprint: identity.agentPresence.session_fingerprint,
    outcome: "success",
    result_digest: "5".repeat(64),
    result_commit: liveCommit,
    readback_digest: "6".repeat(64),
    idempotency_key: "closure-contract-complete",
  });
  const initialAuthorization = await realCore.authorizeFinalize({
    tenant_id: "tenant-a",
    ticket_id: ticketId,
    host_session_fingerprint: identity.agentPresence.session_fingerprint,
  });
  const exactAuthorizationReplay = await realCore.authorizeFinalize({
    tenant_id: "tenant-a",
    ticket_id: ticketId,
    host_session_fingerprint: identity.agentPresence.session_fingerprint,
  });
  assert.deepEqual(exactAuthorizationReplay, initialAuthorization);
  assert.equal(externalReadbackCalls, 1);
  const lifecycleBeforeReattestation = {
    ticket: await realCore.readActionTicket({ tenant_id: "tenant-a", ticket_id: ticketId }),
    delegation: await realCore.readDelegation({
      tenant_id: "tenant-a",
      delegation_id: delegation.delegation_id,
    }),
    join: await realCore.readCoreJoinVerdict({
      tenant_id: "tenant-a",
      verdict_id: verdictId,
    }),
  };
  clockMillis = Date.parse(initialAuthorization.expires_at) + 1;
  const [authorization, concurrentAuthorization] = await Promise.all([
    realCore.authorizeFinalize({
      tenant_id: "tenant-a",
      ticket_id: ticketId,
      host_session_fingerprint: identity.agentPresence.session_fingerprint,
    }),
    realCore.authorizeFinalize({
      tenant_id: "tenant-a",
      ticket_id: ticketId,
      host_session_fingerprint: identity.agentPresence.session_fingerprint,
    }),
  ]);
  assert.deepEqual(concurrentAuthorization, authorization);
  assert.notEqual(authorization.authorization_digest, initialAuthorization.authorization_digest);
  assert.equal(
    authorization.previous_authorization_digest,
    initialAuthorization.authorization_digest,
  );
  assert.equal(externalReadbackCalls, 3);
  const lifecycleAfterReattestation = {
    ticket: await realCore.readActionTicket({ tenant_id: "tenant-a", ticket_id: ticketId }),
    delegation: await realCore.readDelegation({
      tenant_id: "tenant-a",
      delegation_id: delegation.delegation_id,
    }),
    join: await realCore.readCoreJoinVerdict({
      tenant_id: "tenant-a",
      verdict_id: verdictId,
    }),
  };
  assert.equal(lifecycleAfterReattestation.ticket.state, lifecycleBeforeReattestation.ticket.state);
  assert.equal(lifecycleAfterReattestation.ticket.uses, lifecycleBeforeReattestation.ticket.uses);
  assert.equal(
    lifecycleAfterReattestation.ticket.reservation_id,
    lifecycleBeforeReattestation.ticket.reservation_id,
  );
  assert.deepEqual(
    lifecycleAfterReattestation.delegation.usage,
    lifecycleBeforeReattestation.delegation.usage,
  );
  assert.equal(lifecycleAfterReattestation.join.state, lifecycleBeforeReattestation.join.state);
  assert.equal(lifecycleAfterReattestation.join.uses, lifecycleBeforeReattestation.join.uses);
  assert.deepEqual(lifecycleAfterReattestation.ticket.finalize_authorization_history, [{
    authorization_digest: initialAuthorization.authorization_digest,
    external_readback_digest: initialAuthorization.external_readback_digest,
    issued_at: initialAuthorization.issued_at,
    expires_at: initialAuthorization.expires_at,
  }]);
  assert.equal(authorization.evidence_digest, coreJoinRecordDigest);
  assert.equal(authorization.release_intent_digest, releaseIntentDigest);
  assert.equal(authorization.core_join_verdict_digest, coreJoinClaimDigest);
  assert.equal(authorization.live_services[0].rollback_status, "previous_live_attested");

  const baseFinalize = {
    work_id: work.work_id,
    plan_id: planId,
    action_ticket_id: ticketId,
    idempotency_key: "closure-finalize",
  };
  const redigestAuthorization = (receipt, changes, signatureSentinel) => {
    const unsigned = { ...receipt, ...changes };
    delete unsigned.authorization_digest;
    delete unsigned.signature;
    return {
      ...unsigned,
      authorization_digest: digest(unsigned),
      signature: `hnf_${signatureSentinel.repeat(64)}`,
    };
  };

  await assert.rejects(runtime.finalizeClosure(identity, {
    ...baseFinalize,
    live_verification: {
      commit_sha: liveCommit,
      health_ok: true,
      rollback_ready: true,
    },
  }, authorization), /continuity_finalize_fields_invalid/);

  const forgedAuthorization = redigestAuthorization(
    authorization,
    { evidence_digest: evaluationDigest },
    "9",
  );
  await assert.rejects(
    runtime.finalizeClosure(identity, baseFinalize, forgedAuthorization),
    /continuity_external_release_authorization_mismatch/,
  );

  const wrongVerdictAuthorization = redigestAuthorization(
    authorization,
    { core_join_verdict_digest: verdictObjectDigest },
    "b",
  );
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-wrong-verdict-digest",
    }, wrongVerdictAuthorization),
    /continuity_external_release_authorization_mismatch/,
  );

  const wrongReleaseIntentAuthorization = redigestAuthorization(
    authorization,
    { release_intent_digest: coreJoinRecordDigest },
    "c",
  );
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-wrong-release-intent",
    }, wrongReleaseIntentAuthorization),
    /continuity_external_release_authorization_mismatch/,
  );

  const wrongRollbackAuthorization = redigestAuthorization(
    authorization,
    {
      live_services: authorization.live_services.map((service) => ({
        ...service,
        rollback_status: "commit_available_manifest_bound",
      })),
    },
    "d",
  );
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-wrong-rollback-status",
    }, wrongRollbackAuthorization),
    /continuity_live_verification_required/,
  );

  const releaseJoinRow = [...pool.releaseJoins.values()][0];
  const originalCoreJoinRecord = releaseJoinRow.core_join_record;
  const originalCoreJoinRecordDigest = releaseJoinRow.core_join_record_digest;
  const wrongEvaluationRecord = structuredClone(originalCoreJoinRecord);
  wrongEvaluationRecord.claim.evaluation_digest = "0".repeat(64);
  releaseJoinRow.core_join_record = wrongEvaluationRecord;
  releaseJoinRow.core_join_record_digest = digest(wrongEvaluationRecord);
  const wrongEvaluationAuthorization = redigestAuthorization(
    authorization,
    { evidence_digest: releaseJoinRow.core_join_record_digest },
    "e",
  );
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-wrong-evaluation-binding",
    }, wrongEvaluationAuthorization),
    /continuity_external_release_authorization_mismatch/,
  );
  releaseJoinRow.core_join_record = originalCoreJoinRecord;
  releaseJoinRow.core_join_record_digest = originalCoreJoinRecordDigest;

  const expiredAuthorization = redigestAuthorization(authorization, {
    issued_at: "2026-07-29T13:10:00.000Z",
    expires_at: "2026-07-29T13:20:00.000Z",
  }, "a");
  await assert.rejects(
    runtime.finalizeClosure(identity, baseFinalize, expiredAuthorization),
    /continuity_trusted_core_closure_receipt_required/,
  );

  const legacyPool = new ContinuityPool(clock);
  for (const property of [
    "works", "bindings", "anchors", "events", "idempotency", "participants",
    "branches", "leases", "plans", "nativeAgents", "evaluations",
    "releaseJoins", "incidents", "capsules",
  ]) {
    legacyPool[property] = new Map(
      [...pool[property]].map(([entryKey, value]) => [
        entryKey,
        structuredClone(value),
      ]),
    );
  }
  const legacyRuntime = createWorkContinuityRuntime({
    dttAgentIdentitySigningSecret: closureAttestationSecret,
  }, { pool: legacyPool, now: clock });
  const legacyFinalized = await legacyRuntime.finalizeClosure(identity, {
    ...baseFinalize,
    idempotency_key: "closure-finalize-v1-regression",
  }, authorization);
  assert.equal(legacyFinalized.completed, true);
  assert.equal(legacyFinalized.final_receipt.host_type, "codex_native");
  assert.equal(
    legacyFinalized.final_receipt.authorization_digest,
    authorization.authorization_digest,
  );

  const closureIdentity = {
    ...identity,
    agentPresence: {
      ...identity.agentPresence,
      agent_id: "chatgpt-successor",
      client_type: "chatgpt",
      session_fingerprint: "f".repeat(64),
    },
  };
  const closureHandoff = await realCore.issueClosureHandoff({
    tenant_id: "tenant-a",
    ticket_id: ticketId,
    work_id: work.work_id,
    plan_id: planId,
    result_commit: liveCommit,
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint:
      closureIdentity.agentPresence.session_fingerprint,
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: `osf_${"a".repeat(64)}`,
      consent_nonce: "closure-contract-successor-consent",
      confirmation_reference: "owner approved cross-host closure handoff",
    },
    idempotency_key: "closure-contract-handoff-issue",
  });
  const handoffAuthorization = await realCore.redeemClosureHandoff({
    tenant_id: "tenant-a",
    ticket_id: ticketId,
    handoff_id: closureHandoff.handoff.handoff_id,
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint:
      closureIdentity.agentPresence.session_fingerprint,
    idempotency_key: "closure-contract-handoff-redeem",
  });
  assert.equal(
    handoffAuthorization.schema_version,
    "host_native_finalize_authorization_v2",
  );
  assert.equal(handoffAuthorization.execution_host_kind, "codex_native");
  assert.equal(handoffAuthorization.closure_host_kind, "chatgpt_native");
  assert.equal(handoffAuthorization.local_plan_id, planId);
  assert.equal(handoffAuthorization.local_plan_digest, planned.plan_digest);
  const currentLiveCommit = "6".repeat(40);
  const supersedingHeadCommit = "8".repeat(40);
  const supersedingTreeSha = "7".repeat(40);
  const supersedingChangedFiles = [
    "services/skinharmony-core-mcp/src/work-continuity-runtime.js",
  ];
  const supersedingDiffDigest = hostNativeGithubDiffDigest({
    repository: "owner/repo",
    base_commit: liveCommit,
    head_commit: supersedingHeadCommit,
    tree_sha: supersedingTreeSha,
    changed_files: supersedingChangedFiles,
  });
  const supersedingManifest = buildHostReleaseManifestV2({
    schema_version: "host_release_manifest_v2",
    manifest_id: "superseding-closure-contract-manifest",
    tenant_id: "tenant-a",
    work_id: "superseding-work",
    intent_anchor_digest: "6".repeat(64),
    repository: "owner/repo",
    base_branch: "main",
    delivery_branch: "main",
    base_commit: liveCommit,
    head_commit: supersedingHeadCommit,
    tree_sha: supersedingTreeSha,
    diff_digest: supersedingDiffDigest,
    changed_files: supersedingChangedFiles,
    verification: {
      builder_agent_id: "superseding-builder",
      verifier_agent_ids: ["superseding-verifier"],
      required_checks: ["core-mcp"],
      checks_commit: supersedingHeadCommit,
      checks_digest: "6".repeat(64),
      evidence_digest: "7".repeat(64),
      core_join_verdict_id: `hnj_${"6".repeat(40)}`,
    },
    delivery: {
      method: "github_protected_push_auto_deploy",
      services: [{
        service_id: "srv-core-mcp",
        environment: "production",
        expected_previous_commit: liveCommit,
        target_commit: null,
        target_resolution: "post_merge_readback",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      }],
    },
    rollback: {
      mode: "forward_revert",
      target_commit: liveCommit,
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      ready: true,
    },
  });
  const supersedingService = {
    ...supersedingManifest.delivery.services[0],
    origin: "https://srv-core-mcp.onrender.com",
  };
  const supersedingBinding = {
    ...supersedingManifest,
    delivery: {
      ...supersedingManifest.delivery,
      services: [supersedingService],
    },
    services: [supersedingService],
  };
  const previousLiveUnsigned = {
    service_id: supersedingService.service_id,
    environment: supersedingService.environment,
    origin: supersedingService.origin,
    health_path: "/healthz",
    deployment_id: "previous-srv-core-mcp",
    live_commit: liveCommit,
    health_status: "healthy",
    health_contract_digest: supersedingService.health_contract_digest,
  };
  const previousLive = {
    ...previousLiveUnsigned,
    readback_digest: digest(previousLiveUnsigned),
  };
  const supersedingSourceUnsigned = {
    schema_version: "host_native_source_attestation_v1",
    repository: "owner/repo",
    evidence_kind: "github_pull_request_files",
    pull_request: 216,
    base_commit: liveCommit,
    head_commit: supersedingHeadCommit,
    tree_sha: supersedingTreeSha,
    changed_files: supersedingChangedFiles,
    diff_digest: supersedingDiffDigest,
  };
  const supersedingSource = {
    ...supersedingSourceUnsigned,
    attestation_digest: digest(supersedingSourceUnsigned),
  };
  const supersedingResolution = {
    schema_version: "host_native_release_join_resolution_v1",
    trusted: true,
    authority: "universal_core",
    allowed: true,
    verdict_id: supersedingManifest.verification.core_join_verdict_id,
    tenant_id: "tenant-a",
    work_id: "superseding-work",
    intent_anchor_digest: "6".repeat(64),
    repository: "owner/repo",
    checks_commit: supersedingHeadCommit,
    evidence_digest: "8".repeat(64),
    issued_at: clock().toISOString(),
    resolved_at: clock().toISOString(),
    source_attestation: supersedingSource,
    previous_live_attestations: [previousLive],
    pre_action_readback_digest: digest({
      source_attestation: supersedingSource,
      previous_live_attestations: [previousLive],
    }),
    provider_execution: false,
  };
  const originalGithubReadback = {
    ...handoffAuthorization.github_readback,
    action_kind: "github.merge",
    target_commit: liveCommit,
    merge_commit: liveCommit,
    expected_base_commit: releaseIntent.base_commit,
    head_commit: releaseIntent.head_commit,
    head_tree_sha: releaseIntent.tree_sha,
    merge_parents: [releaseIntent.base_commit, releaseIntent.head_commit],
    rollback_commit: releaseIntent.rollback.target_commit,
    rollback_commit_available: true,
  };
  const supersedingGithubReadback = {
    repository: "owner/repo",
    action_kind: "github.merge",
    target_commit: currentLiveCommit,
    merge_commit: currentLiveCommit,
    expected_base_commit: liveCommit,
    head_commit: supersedingHeadCommit,
    checks_commit: supersedingHeadCommit,
    head_tree_sha: supersedingTreeSha,
    merge_parents: [liveCommit, supersedingHeadCommit],
    rollback_commit: liveCommit,
    rollback_commit_available: true,
    checks_passed: true,
    required_checks: ["core-mcp"],
    observed_checks: [{
      name: "core-mcp",
      head_commit: supersedingHeadCommit,
      status: "completed",
      conclusion: "success",
    }],
    readback_digest: "8".repeat(64),
  };
  const currentServiceUnsigned = {
    ...handoffAuthorization.live_services[0],
    origin: supersedingService.origin,
    live_commit: currentLiveCommit,
    rollback_commit: liveCommit,
  };
  delete currentServiceUnsigned.readback_digest;
  const currentService = {
    ...currentServiceUnsigned,
    readback_digest: digest(currentServiceUnsigned),
  };
  const {
    authorization_digest: _handoffAuthorizationDigest,
    signature: _handoffAuthorizationSignature,
    ...handoffAuthorizationUnsigned
  } = handoffAuthorization;
  const supersededUnsigned = {
    ...handoffAuthorizationUnsigned,
    schema_version: "host_native_finalize_authorization_v3",
    decision: "ALLOW_FINALIZE_SUPERSEDED_RELEASE",
    release_state: "superseded",
    target_commit: liveCommit,
    current_live_commit: currentLiveCommit,
    execution_host_session_fingerprint: "9".repeat(64),
    superseding_action_ticket_id: "hnt_successor-12345678",
    superseding_action_ticket_digest: "1".repeat(64),
    superseding_result_commit: currentLiveCommit,
    superseding_release_manifest_digest: supersedingManifest.manifest_digest,
    superseding_release_intent_digest:
      buildHostReleaseIntentV1(supersedingManifest).release_intent_digest,
    superseding_core_join_verdict_id:
      supersedingManifest.verification.core_join_verdict_id,
    superseding_core_join_verdict_digest: "2".repeat(64),
    superseding_core_join_resolution_digest: digest(supersedingResolution),
    superseding_evidence_digest: supersedingResolution.evidence_digest,
    superseding_release_manifest_binding: supersedingBinding,
    superseding_release_join_resolution: supersedingResolution,
    superseding_host_result_digest: "3".repeat(64),
    superseding_host_readback_digest: "4".repeat(64),
    external_readback_digest: "5".repeat(64),
    readback_digest: "5".repeat(64),
    superseding_result_commit_verified: true,
    github_readback: originalGithubReadback,
    superseding_github_readback: supersedingGithubReadback,
    live_services: [currentService],
    superseding_outcome_source: "verified_completion",
    readback_source: "core_server_superseded_external_readback_v1",
  };
  const supersededAuthorization = {
    ...supersededUnsigned,
    authorization_digest: digest(supersededUnsigned),
    signature: `hnf_${"5".repeat(64)}`,
  };
  const clonePool = () => {
    const copy = new ContinuityPool(clock);
    for (const property of [
      "works", "bindings", "anchors", "events", "idempotency", "participants",
      "branches", "leases", "plans", "nativeAgents", "evaluations",
      "releaseJoins", "incidents", "capsules",
    ]) {
      copy[property] = new Map(
        [...pool[property]].map(([entryKey, value]) => [
          entryKey,
          structuredClone(value),
        ]),
      );
    }
    return copy;
  };
  const supersededFinalize = {
    ...baseFinalize,
    closure_handoff_id: closureHandoff.handoff.handoff_id,
    idempotency_key: "closure-finalize-superseded-handoff",
  };
  const unboundClosureIdentity = structuredClone(closureIdentity);
  unboundClosureIdentity.agentPresence.transport_bound = false;
  await assert.rejects(
    createWorkContinuityRuntime({
      dttAgentIdentitySigningSecret: closureAttestationSecret,
    }, { pool: clonePool(), now: clock }).finalizeClosure(
      unboundClosureIdentity,
      {
        ...supersededFinalize,
        idempotency_key: "closure-finalize-unbound-transport",
      },
      supersededAuthorization,
    ),
    /native_agent_coordinator_presence_required/,
  );
  const missingVerifiedResult = structuredClone(supersededAuthorization);
  delete missingVerifiedResult.superseding_host_result_digest;
  delete missingVerifiedResult.authorization_digest;
  delete missingVerifiedResult.signature;
  const missingVerifiedResultAuthorization = {
    ...missingVerifiedResult,
    authorization_digest: digest(missingVerifiedResult),
    signature: `hnf_${"6".repeat(64)}`,
  };
  await assert.rejects(
    createWorkContinuityRuntime({
      dttAgentIdentitySigningSecret: closureAttestationSecret,
    }, { pool: clonePool(), now: clock }).finalizeClosure(
      closureIdentity,
      {
        ...supersededFinalize,
        idempotency_key: "closure-finalize-missing-verified-result",
      },
      missingVerifiedResultAuthorization,
    ),
    /continuity_trusted_core_closure_receipt_required/,
  );
  const reconciledSuccessorUnsigned = {
    ...missingVerifiedResult,
    superseding_outcome_source: "reconciled_readback",
  };
  const reconciledSuccessorAuthorization = {
    ...reconciledSuccessorUnsigned,
    authorization_digest: digest(reconciledSuccessorUnsigned),
    signature: `hnf_${"7".repeat(64)}`,
  };
  const reconciledFinalized = await createWorkContinuityRuntime({
    dttAgentIdentitySigningSecret: closureAttestationSecret,
  }, { pool: clonePool(), now: clock }).finalizeClosure(
    closureIdentity,
    {
      ...supersededFinalize,
      idempotency_key: "closure-finalize-reconciled-successor",
    },
    reconciledSuccessorAuthorization,
  );
  assert.equal(reconciledFinalized.completed, true);
  assert.equal(reconciledFinalized.release_state, "superseded");
  const wrongPrevious = structuredClone(supersededAuthorization);
  wrongPrevious.superseding_release_join_resolution
    .previous_live_attestations[0].live_commit = "0".repeat(40);
  const wrongPreviousUnsigned = { ...wrongPrevious };
  delete wrongPreviousUnsigned.authorization_digest;
  delete wrongPreviousUnsigned.signature;
  wrongPrevious.authorization_digest = digest(wrongPreviousUnsigned);
  await assert.rejects(
    createWorkContinuityRuntime({
      dttAgentIdentitySigningSecret: closureAttestationSecret,
    }, { pool: clonePool(), now: clock }).finalizeClosure(
      closureIdentity,
      supersededFinalize,
      wrongPrevious,
    ),
    /continuity_superseding_release_authorization_mismatch|continuity_superseding_previous_live_mismatch/,
  );
  const supersededPool = clonePool();
  const supersededFinalized = await createWorkContinuityRuntime({
    dttAgentIdentitySigningSecret: closureAttestationSecret,
  }, { pool: supersededPool, now: clock }).finalizeClosure(
    closureIdentity,
    supersededFinalize,
    supersededAuthorization,
  );
  assert.equal(supersededFinalized.completed, true);
  assert.equal(supersededFinalized.target_commit, liveCommit);
  assert.equal(supersededFinalized.current_live_commit, currentLiveCommit);
  assert.equal(supersededFinalized.release_state, "superseded");
  assert.equal(
    supersededFinalized.final_receipt.execution_session_fingerprint,
    "9".repeat(64),
  );
  assert.equal(
    supersededFinalized.final_receipt.closure_session_fingerprint,
    closureIdentity.agentPresence.session_fingerprint,
  );
  assert.equal(
    supersededPool.works.get(key("tenant-a", work.work_id)).status,
    "completed",
  );
  const handoffFinalize = {
    ...baseFinalize,
    closure_handoff_id: closureHandoff.handoff.handoff_id,
    idempotency_key: "closure-finalize-successor-handoff",
  };
  await assert.rejects(
    runtime.finalizeClosure(identity, handoffFinalize, handoffAuthorization),
    /continuity_trusted_core_closure_receipt_required/,
  );
  const finalized = await runtime.finalizeClosure(
    closureIdentity,
    handoffFinalize,
    handoffAuthorization,
  );
  assert.equal(finalized.completed, true);
  assert.equal(finalized.external_release, true);
  assert.equal(finalized.final_receipt.host_policy_override, false);
  assert.equal(finalized.final_receipt.host_policy_must_allow, true);
  assert.equal(finalized.final_receipt.action_ticket_id, ticketId);
  assert.equal(
    finalized.final_receipt.authorization_digest,
    handoffAuthorization.authorization_digest,
  );
  assert.equal(
    finalized.final_receipt.closure_handoff_id,
    closureHandoff.handoff.handoff_id,
  );
  assert.equal(finalized.final_receipt.host_type, "codex_native");
  assert.equal(finalized.final_receipt.closure_host_type, "chatgpt_native");
  assert.equal(finalized.target_commit, liveCommit);
  assert.equal(pool.works.get(key("tenant-a", work.work_id)).status, "completed");
  assert.equal(pool.plans.get(key("tenant-a", planId)).status, "closed");
});

test("continuity runtime exposes no parallel delegation authority", () => {
  const pool = new ContinuityPool();
  const runtime = createWorkContinuityRuntime({}, { pool });
  assert.equal(runtime.issueDelegation, undefined);
  assert.equal(runtime.consumeDelegation, undefined);
  assert.equal(runtime.revokeDelegation, undefined);
  assert.doesNotMatch(runtime.schemaSql, /core_continuity_delegations/);
});
