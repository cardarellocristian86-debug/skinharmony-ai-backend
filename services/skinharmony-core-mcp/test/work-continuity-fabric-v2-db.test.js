import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAcceptanceContract,
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

test("automation phases are digest-separated in the persistent fabric", () => {
  assert.notEqual(digest({ phase: "readiness", commit: "a".repeat(40) }), digest({ phase: "final_acceptance", commit: "a".repeat(40) }));
});

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
      session_fingerprint: "c".repeat(24),
      host_transport_session_fingerprint: "b".repeat(24),
    },
  };
}

class ContinuityPool {
  constructor(clock) {
    this.clock = clock;
    this.works = new Map();
    this.architectures = new Map();
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
    this.controlContexts = new Map();
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
    if (q.startsWith("SELECT work_id FROM core_continuity_works WHERE tenant_id=$1 AND project_id=$2")) {
      const [tenantId, projectId, statuses] = parameters;
      const rows = [...this.works.values()]
        .filter((work) => work.tenant_id === tenantId && work.project_id === projectId && statuses.includes(work.status))
        .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)) ||
          String(right.work_id).localeCompare(String(left.work_id)))
        .slice(0, 2)
        .map((work) => ({ work_id: work.work_id }));
      return { rows, rowCount: rows.length };
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
    if (q.startsWith("SELECT w.tenant_id,w.work_id,w.project_id,w.status AS work_status")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      const anchor = this.anchors.get(key(parameters[0], parameters[1]));
      const row = work && anchor ? {
        tenant_id: work.tenant_id,
        work_id: work.work_id,
        project_id: work.project_id,
        work_status: work.status,
        current_version: work.current_version,
        work_updated_at: work.updated_at,
        anchor: anchor.anchor,
        intent_digest: anchor.intent_digest,
        intent_anchor_created_at: anchor.created_at,
      } : null;
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT project_id,current_version,status,next_action FROM core_continuity_works")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      return { rows: work ? [{
        project_id: work.project_id,
        current_version: work.current_version,
        status: work.status,
        next_action: work.next_action,
      }] : [], rowCount: work ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO core_continuity_control_contexts")) {
      const [tenantId, workId, projectId, workRevision, contextDigest, payload] = parameters;
      this.controlContexts.set(key(tenantId, workId), {
        tenant_id: tenantId,
        work_id: workId,
        project_id: projectId,
        work_revision: workRevision,
        context_digest: contextDigest,
        payload: JSON.parse(payload),
      });
      return { rows: [], rowCount: 1 };
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
      const [tenantId, workId] = parameters;
      const hasExplicitVersion = parameters.length === 8;
      const version = hasExplicitVersion ? Number(parameters[2]) : 1;
      const architecture = JSON.parse(parameters[hasExplicitVersion ? 3 : 2]);
      const architectureDigest = parameters[hasExplicitVersion ? 5 : 3];
      this.architectures.set(key(tenantId, workId, version), {
        version,
        architecture,
        architecture_digest: architectureDigest,
      });
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
    if (q.startsWith("SELECT session_id,agent_id,client_type,status,expires_at,transport_session_fingerprint,")) {
      const row = this.participants.get(key(parameters[0], parameters[1], parameters[2]));
      const matches = row?.actor_subject === parameters[3];
      return { rows: matches ? [{
        session_id: row.session_id,
        agent_id: row.agent_id,
        client_type: row.client_type,
        status: row.status,
        expires_at: row.expires_at,
        transport_session_fingerprint: row.transport_session_fingerprint,
        logical_session_fingerprint: row.metadata?.profile?.logical_session_fingerprint || null,
      }] : [], rowCount: matches ? 1 : 0 };
    }
    if (q.startsWith("UPDATE core_continuity_leases SET status='expired',released_at=coalesce(released_at,now())")) {
      const [tenantId, workId, sessionId] = parameters;
      const rows = [];
      for (const lease of this.leases.values()) {
        if (lease.tenant_id === tenantId && lease.work_id === workId &&
          lease.session_id === sessionId && lease.status === "active") {
          lease.status = "expired";
          lease.released_at ||= this.clock().toISOString();
          rows.push({ lease_id: lease.lease_id, session_id: lease.session_id });
        }
      }
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("UPDATE core_continuity_participants SET transport_session_fingerprint")) {
      const [tenantId, workId, sessionId, actorSubject, transportFingerprint,
        ttlSeconds, agentId, clientType] = parameters;
      const row = this.participants.get(key(tenantId, workId, sessionId));
      if (!row || row.actor_subject !== actorSubject || row.agent_id !== agentId ||
        row.client_type !== clientType) {
        return { rows: [], rowCount: 0 };
      }
      row.transport_session_fingerprint = transportFingerprint;
      row.last_seen_at = this.clock().toISOString();
      row.expires_at = new Date(this.clock().getTime() + Number(ttlSeconds) * 1_000).toISOString();
      return { rows: [{
        session_id: row.session_id,
        agent_id: row.agent_id,
        client_type: row.client_type,
        status: row.status,
        last_seen_at: row.last_seen_at,
        expires_at: row.expires_at,
      }], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_participants SET status='active',last_seen_at=now()")) {
      const [tenantId, workId, sessionId, actorSubject, ttlSeconds, agentId, clientType] = parameters;
      const row = this.participants.get(key(tenantId, workId, sessionId));
      if (!row || row.actor_subject !== actorSubject || row.agent_id !== agentId ||
        row.client_type !== clientType) {
        return { rows: [], rowCount: 0 };
      }
      row.status = "active";
      row.last_seen_at = this.clock().toISOString();
      row.expires_at = new Date(this.clock().getTime() + Number(ttlSeconds) * 1_000).toISOString();
      return { rows: [{
        session_id: row.session_id,
        agent_id: row.agent_id,
        branch_id: row.branch_id,
        status: row.status,
        last_seen_at: row.last_seen_at,
        expires_at: row.expires_at,
      }], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_leases l")) {
      const [tenantId, workId, sessionId, actorSubject, agentId, clientType, branchId,
        transportFingerprint] = parameters;
      const participant = this.participants.get(key(tenantId, workId, sessionId));
      const bindingChanged = participant && (
        participant.actor_subject !== actorSubject ||
        participant.agent_id !== agentId ||
        participant.client_type !== clientType ||
        participant.branch_id !== branchId ||
        participant.transport_session_fingerprint !== transportFingerprint
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
        branchId, ttlSeconds, metadata, transportFingerprint] = parameters;
      const participantKey = key(tenantId, workId, sessionId);
      const current = this.participants.get(participantKey);
      const currentExpired = current &&
        Date.parse(current.expires_at) <= this.clock().getTime();
      const compatibleActiveBinding = current &&
        current.actor_subject === actorSubject &&
        current.agent_id === agentId &&
        current.client_type === clientType &&
        current.transport_session_fingerprint === transportFingerprint &&
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
        transport_session_fingerprint: transportFingerprint,
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
      const matchesTransport = row?.transport_session_fingerprint === parameters[7];
      const matches = row?.actor_subject === parameters[3] && matchesAgent && matchesClient &&
        matchesTransport && (!requireActive || active);
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
    if (q.startsWith("SELECT w.work_id,w.current_version,a.anchor,a.intent_digest")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      const anchor = this.anchors.get(key(parameters[0], parameters[1]));
      const architecture = work
        ? this.architectures.get(key(parameters[0], parameters[1], work.current_version))
        : null;
      const row = work && anchor && architecture ? {
        work_id: work.work_id,
        current_version: work.current_version,
        anchor: anchor.anchor,
        intent_digest: anchor.intent_digest,
        architecture: architecture.architecture,
        architecture_digest: architecture.architecture_digest,
      } : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT plan_id,plan_version FROM core_continuity_native_plans")) {
      const rows = [...this.plans.values()]
        .filter((row) => row.tenant_id === parameters[0] && row.work_id === parameters[1])
        .sort((left, right) => Number(right.plan_version || 1) - Number(left.plan_version || 1) ||
          String(right.created_at).localeCompare(String(left.created_at)) || String(right.plan_id).localeCompare(String(left.plan_id)));
      return { rows: rows.length ? [{ plan_id: rows[0].plan_id, plan_version: rows[0].plan_version || 1 }] : [], rowCount: rows.length ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO core_continuity_native_plans")) {
      const [tenantId, workId, planId, plan, planDigest, createdBy, changeId, baseStateDigest,
        contractSchema, planVersion, supersedesPlanId] = parameters;
      this.plans.set(key(tenantId, planId), {
        tenant_id: tenantId,
        work_id: workId,
        plan_id: planId,
        plan: JSON.parse(plan),
        plan_digest: planDigest,
        status: "planned",
        created_by: createdBy,
        change_id: changeId,
        base_state_digest: baseStateDigest,
        contract_schema: contractSchema,
        plan_version: planVersion,
        supersedes_plan_id: supersedesPlanId,
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
    if (q === "SELECT (clock_timestamp() + interval '1 hour') AS lease_expires_at") {
      return {
        rows: [{
          lease_expires_at: new Date(this.clock().getTime() + 60 * 60 * 1_000).toISOString(),
        }],
        rowCount: 1,
      };
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
        taskKind, taskDigest, v2TaskId, coordinatorFingerprint, assignmentCapabilityDigest,
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
        v2_task_id: v2TaskId,
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
    if (q.startsWith("SELECT a.task_id,a.task_digest,a.v2_task_id,a.host_type,a.host_task_id,")) {
      const [tenantId, workId, planId, agentId] = parameters;
      const row = [...this.nativeAgents.values()].find((candidate) =>
        candidate.tenant_id === tenantId &&
        candidate.work_id === workId &&
        candidate.plan_id === planId &&
        candidate.agent_id === agentId);
      const plan = this.plans.get(key(tenantId, planId));
      return {
        rows: row && plan ? [{
          task_id: row.task_id,
          task_digest: row.task_digest,
          v2_task_id: row.v2_task_id,
          host_type: row.host_type,
          host_task_id: row.host_task_id,
          coordinator_session_fingerprint: row.coordinator_session_fingerprint,
          assignment_capability_digest: row.assignment_capability_digest,
          lease_expires_at: row.lease_expires_at,
          lease_active: new Date(row.lease_expires_at).getTime() > this.clock().getTime(),
          plan_status: plan.status,
        }] : [],
        rowCount: row && plan ? 1 : 0,
      };
    }
    if (q.startsWith("SELECT a.task_id,a.task_kind,a.task_digest,a.v2_task_id,")) {
      const [tenantId, workId, planId, agentId] = parameters;
      const row = [...this.nativeAgents.values()].find((candidate) =>
        candidate.tenant_id === tenantId &&
        candidate.work_id === workId &&
        candidate.plan_id === planId &&
        candidate.agent_id === agentId);
      const plan = this.plans.get(key(tenantId, planId));
      return {
        rows: row && plan ? [{
          task_id: row.task_id,
          task_kind: row.task_kind,
          task_digest: row.task_digest,
          v2_task_id: row.v2_task_id,
          plan: plan.plan,
          plan_digest: plan.plan_digest,
          plan_status: plan.status,
        }] : [],
        rowCount: row && plan ? 1 : 0,
      };
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
          lease_active: new Date(row.lease_expires_at).getTime() > this.clock().getTime(),
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
    if (q.startsWith("SELECT status,report FROM core_continuity_native_agents")) {
      const [tenantId, workId, planId, taskId] = parameters;
      const row = this.nativeAgents.get(key(tenantId, planId, taskId));
      const matches = row?.work_id === workId;
      return { rows: matches ? [{ status: row.status, report: row.report }] : [], rowCount: matches ? 1 : 0 };
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
          candidate.plan_id === parameters[2] &&
          (!parameters[3] || candidate.verdict_id === parameters[3]))
        .sort((left, right) =>
          Number(right.renewal_generation || 0) - Number(left.renewal_generation || 0) ||
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
    if (q.startsWith("SELECT j.evaluation_id,j.verdict_id,j.release_intent,j.release_intent_digest,")) {
      const joins = [...this.releaseJoins.values()]
        .filter((candidate) =>
          candidate.tenant_id === parameters[0] &&
          candidate.work_id === parameters[1] &&
          candidate.plan_id === parameters[2] &&
          candidate.release_intent_digest === parameters[4])
        .filter((candidate) => {
          const evaluations =
            this.evaluations.get(key(parameters[0], parameters[1], parameters[2])) || [];
          return evaluations.some((evaluation) =>
            evaluation.evaluation_id === candidate.evaluation_id &&
            evaluation.evaluation_digest === parameters[3]);
        })
        .sort((left, right) =>
          Number(right.renewal_generation || 0) - Number(left.renewal_generation || 0) ||
          String(right.created_at).localeCompare(String(left.created_at)) ||
          String(right.verdict_id).localeCompare(String(left.verdict_id)));
      const join = joins[0];
      const evaluations =
        this.evaluations.get(key(parameters[0], parameters[1], parameters[2])) || [];
      const evaluation = evaluations.find((candidate) =>
        candidate.evaluation_id === join?.evaluation_id);
      if (!join || !evaluation) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          ...join,
          evaluation: evaluation.evaluation,
          evaluation_digest: evaluation.evaluation_digest,
        }],
        rowCount: 1,
      };
    }
    if (
      q.startsWith("SELECT p.plan,p.plan_digest,p.status,a.intent_digest,e.evaluation") ||
      q.startsWith("SELECT p.plan,p.plan_digest,a.intent_digest,e.evaluation")
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
      const row = this.releaseJoins.get(key(parameters[0], parameters[1], parameters[2]));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO core_continuity_release_joins")) {
      const [
        tenantId, workId, planId, evaluationId, verdictId, releaseIntent,
        releaseIntentDigest, coreJoinRecord, coreJoinRecordDigest,
        renewalGeneration, renewalOfVerdictId, createdBy,
      ] = parameters;
      this.releaseJoins.set(key(tenantId, evaluationId, renewalGeneration), {
        tenant_id: tenantId,
        work_id: workId,
        plan_id: planId,
        evaluation_id: evaluationId,
        verdict_id: verdictId,
        release_intent: JSON.parse(releaseIntent),
        release_intent_digest: releaseIntentDigest,
        core_join_record: JSON.parse(coreJoinRecord),
        core_join_record_digest: coreJoinRecordDigest,
        renewal_generation: renewalGeneration,
        renewal_of_verdict_id: renewalOfVerdictId,
        created_by: createdBy,
        created_at: this.clock().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_works SET status='release_ready'")) {
      const work = this.works.get(key(parameters[0], parameters[1]));
      work.status = "release_ready";
      work.next_action =
        "Use the persisted Core Join to obtain the exact action ticket, execute through host policy, then verify live readback.";
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
      const row = parameters[3]
        ? rows.find((candidate) => candidate.evaluation_id === parameters[3])
        : rows.at(-1);
      return {
        rows: row ? [{
          evaluation: row.evaluation,
          evaluation_digest: row.evaluation_digest,
        }] : [],
        rowCount: row ? 1 : 0,
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

function corePlanFor(work, request, { readOnlyNoFileChangeTaskIds = [] } = {}) {
  const readOnlyTaskIds = new Set(readOnlyNoFileChangeTaskIds);
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
      capabilities: readOnlyTaskIds.has(task.task_id)
        ? ["READ_ONLY_NO_FILE_CHANGE"]
        : [],
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

test("Nyra persists one compact control context per Work without prompt-shaped ledger data", async () => {
  const clock = () => new Date("2026-08-21T18:00:00.000Z");
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const identity = { tenantId: "tenant-a", subject: "codex" };
  const created = await runtime.ensure(identity, initialInput, { creationAuthorized: true });
  const context = await runtime.upsertControlContext(identity, {
    work_id: created.work_id,
    project_id: initialInput.project_id,
    context: {
      schema_version: "nyra_control_context_v1",
      tenant_id: "tenant-a",
      project_id: initialInput.project_id,
      work_id: created.work_id,
      work_state: "unknown",
      next_action: "This exact bounded step is ready.",
      assignment: null,
      connector: { state: "healthy" },
      execution_authorized: false,
      external_action_authorized: false,
      context_digest: "c".repeat(64),
    },
  });
  assert.equal(context.work_state, "active");
  assert.equal(context.work_revision, 1);
  assert.equal(context.next_action, initialInput.next_action);
  assert.match(pool.controlContexts.get(key("tenant-a", created.work_id)).context_digest, /^[a-f0-9]{64}$/);
  assert.notEqual(pool.controlContexts.get(key("tenant-a", created.work_id)).context_digest, "c".repeat(64));
  assert.equal(JSON.stringify(context).includes("do-not-store"), false);
});

test("standing release resolves one atomic persisted Work/Intent binding fail-closed", async () => {
  const clock = () => new Date("2026-08-14T12:00:00.000Z");
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const identity = { tenantId: "tenant-a", subject: "codex" };
  const created = await runtime.ensure(identity, initialInput, { creationAuthorized: true });

  const binding = await runtime.resolveStandingReleaseIntentBinding(identity, {
    work_id: created.work_id,
  });
  assert.equal(binding.schema_version, "standing_release_intent_binding_v1");
  assert.equal(binding.source, "mcp_work_continuity_postgres");
  assert.equal(binding.tenant_id, "tenant-a");
  assert.equal(binding.work_id, created.work_id);
  assert.equal(binding.intent_anchor_digest, created.intent_digest);
  assert.equal(binding.intent_anchor_immutable, true);
  assert.equal(binding.work_status, "active");
  assert.equal(binding.provider_execution, false);
  const { binding_digest: bindingDigest, ...unsignedBinding } = binding;
  assert.equal(bindingDigest, digest(unsignedBinding));
  assert.match(bindingDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(bindingDigest, digest({ ...unsignedBinding, work_status: "verified" }));
  for (const promptField of ["anchor", "initial_message", "idea", "objective", "constraints"]) {
    assert.equal(promptField in binding, false);
  }

  await assert.rejects(
    runtime.resolveStandingReleaseIntentBinding(
      { tenantId: "tenant-b", subject: "codex" },
      { work_id: created.work_id },
    ),
    /standing_release_intent_binding_not_found/,
  );

  const anchor = pool.anchors.get(key("tenant-a", created.work_id));
  const originalDigest = anchor.intent_digest;
  anchor.intent_digest = "f".repeat(64);
  await assert.rejects(
    runtime.resolveStandingReleaseIntentBinding(identity, { work_id: created.work_id }),
    /standing_release_intent_binding_corrupt/,
  );
  anchor.intent_digest = originalDigest;
  pool.works.get(key("tenant-a", created.work_id)).status = "blocked";
  await assert.rejects(
    runtime.resolveStandingReleaseIntentBinding(identity, { work_id: created.work_id }),
    /standing_release_intent_work_status_ineligible/,
  );
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

test("a fresh chat automatically binds the sole operational Work for its project", async () => {
  const clock = () => new Date("2026-08-21T10:00:00.000Z");
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const identity = { tenantId: "tenant-a", subject: "codex" };
  const created = await runtime.ensure(identity, initialInput, { creationAuthorized: true });

  const resumed = await runtime.ensure(identity, {
    ...initialInput,
    session_id: "new-chat-session",
    initial_message: "Continue the current work from this new chat.",
    idea: "New chat continuation",
    objective: "Resume current work",
    resume_existing: true,
  }, { trustedSessionFollowup: true });

  assert.equal(resumed.work_id, created.work_id);
  assert.equal(resumed.resumed_existing, true);
  assert.equal(resumed.automatic_resume, true);
  assert.equal(resumed.resume_source, "unambiguous_project_work");
  assert.equal(pool.bindings.get(key("tenant-a", initialInput.project_id, "new-chat-session")).work_id, created.work_id);
  assert.deepEqual(pool.events.get(key("tenant-a", created.work_id)).map((event) => event.event_type), [
    "work_created",
    "intent_anchored",
  ]);
});

test("a fresh chat never creates or confirms duplicate Work when project continuation is ambiguous", async () => {
  const clock = () => new Date("2026-08-21T10:00:00.000Z");
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const identity = { tenantId: "tenant-a", subject: "codex" };
  const first = await runtime.ensure(identity, initialInput, { creationAuthorized: true });
  const second = await runtime.ensure(identity, {
    ...initialInput,
    session_id: "second-active-work",
    objective: "A separate operational work",
  }, { creationAuthorized: true });

  await assert.rejects(runtime.ensure(identity, {
    ...initialInput,
    session_id: "ambiguous-new-chat",
    initial_message: "Continue the project.",
    resume_existing: true,
  }, { trustedSessionFollowup: true }), (error) => {
    assert.equal(error.code, "continuity_resume_selection_required");
    assert.deepEqual(new Set(error.candidate_work_ids), new Set([first.work_id, second.work_id]));
    return true;
  });
  assert.equal(pool.works.size, 2);
  assert.equal(pool.bindings.has(key("tenant-a", initialInput.project_id, "ambiguous-new-chat")), false);
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

test("Nyra read transport rotation expires old leases without transferring authority", async () => {
  const clock = () => new Date("2026-08-27T09:00:00.000Z");
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const subject = "nyra-read-owner";
  const created = await runtime.ensure({ tenantId: "tenant-a", subject }, initialInput, {
    creationAuthorized: true,
  });
  const original = galleryIdentity(subject, "nyra-read-session", "nyra-read-agent", "chatgpt");
  const common = {
    work_id: created.work_id,
    session_id: original.agentPresence.session_id,
    agent_id: original.agentPresence.agent_id,
    client_type: original.agentPresence.client_type,
    ttl_seconds: 300,
  };
  await runtime.join(original, {
    ...common,
    metadata: {
      mode: "read_only",
      logical_session_fingerprint: original.agentPresence.session_fingerprint,
      execution_authorized: false,
    },
    idempotency_key: "nyra-read-original-join",
  });
  for (const leaseId of [
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ]) {
    pool.leases.set(key("tenant-a", created.work_id, leaseId), {
      tenant_id: "tenant-a",
      work_id: created.work_id,
      lease_id: leaseId,
      session_id: common.session_id,
      status: "active",
    });
  }

  const rotated = {
    ...original,
    agentPresence: {
      ...original.agentPresence,
      host_transport_session_fingerprint: "d".repeat(24),
    },
  };
  const rotation = await runtime.rotateNyraReadParticipant(rotated, {
    ...common,
    idempotency_key: "nyra-read-verified-transport-rotation",
  });
  assert.equal(rotation.state, "rotated");
  assert.equal(rotation.expired_lease_count, 2);
  assert.equal([...pool.leases.values()].every((candidate) => candidate.status === "expired"), true);
  assert.equal(pool.participants.get(key("tenant-a", created.work_id, common.session_id))
    .transport_session_fingerprint, "d".repeat(24));
  assert.deepEqual(pool.events.get(key("tenant-a", created.work_id)).slice(-2)
    .map((event) => event.event_type), ["lease_expired", "participant_transport_rotated"]);

  await assert.rejects(runtime.heartbeat(original, {
    ...common,
    idempotency_key: "nyra-read-old-transport-heartbeat",
  }), /continuity_participant_not_active/);
  const active = await runtime.heartbeat(rotated, {
    ...common,
    idempotency_key: "nyra-read-new-transport-heartbeat",
  });
  assert.equal(active.participant.session_id, common.session_id);
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

test("ensureWithClient preserves the legacy create contract inside a caller-owned transaction", async () => {
  const pool = new ContinuityPool(() => new Date("2026-08-08T10:00:00.000Z"));
  const runtime = createWorkContinuityRuntime({}, { pool });
  const created = await runtime.ensureWithClient(pool, { tenantId: "tenant-a", subject: "owner-subject" }, {
    ...initialInput,
    session_id: "shared-transaction-session",
    work_id: "55555555-5555-4555-8555-555555555555",
  }, { creationAuthorized: true });
  assert.equal(created.work_id, "55555555-5555-4555-8555-555555555555");
  assert.equal(pool.works.size, 1);
  assert.equal(pool.events.get(key("tenant-a", created.work_id)).length, 2);
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
    launch_request: {
      schema_version: "nyra_host_launch_request_v1", requested_by: "nyra", action: "START_NATIVE_PLAN",
      verifier_task_id: "verify", distinct_session_required: true, host_execution_required: true,
    },
    idempotency_key: "native-plan-stable",
  };
  const corePlan = corePlanFor(work, request);
  const planned = await runtime.planNativeAgents(identity, request, { corePlan });
  const replay = await runtime.planNativeAgents(identity, request, { corePlan });
  assert.equal(replay.plan.plan_id, planned.plan.plan_id);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(planned.receipt.host_type, "codex_native");
  assert.equal(planned.receipt.coordinator_session_fingerprint, "a".repeat(64));
  assert.equal(planned.receipt.host_policy_override, false);
  assert.equal(planned.receipt.host_policy_must_allow, true);
  assert.equal(planned.receipt.provider_execution, false);
  assert.deepEqual(planned.plan.launch_request, request.launch_request);
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

test("native plans bind an exact acceptance amendment from the current architecture version", async () => {
  const instant = new Date("2026-07-29T13:05:00.000Z");
  const clock = () => new Date(instant);
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const identity = {
    tenantId: "tenant-a",
    subject: "coordinator",
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      session_fingerprint: "e".repeat(64),
    },
  };
  const work = await runtime.ensure(identity, {
    ...initialInput,
    acceptance_criteria: ["Use only the bootstrap file list."],
    constraints: ["Require an exact Core action ticket."],
  }, { creationAuthorized: true });
  const anchor = pool.anchors.get(key("tenant-a", work.work_id));
  const base = buildAcceptanceContract(anchor.anchor, anchor.intent_digest);
  const stale = base.criteria.find((criterion) => criterion.criterion_id === "acceptance_1");
  const architecture = {
    functions: [],
    acceptance_contract_amendment: {
      schema_version: "intent_acceptance_contract_amendment_v1",
      base_criteria_digest: base.criteria_digest,
      reason: "Owner-confirmed architecture revision expands the bounded change cone.",
      superseded_criteria: [{
        criterion_id: stale.criterion_id,
        criterion_digest: stale.criterion_digest,
        reason: "The bootstrap list is stale after the authorized continuity correction.",
      }],
      replacement_criteria: [{
        criterion_id: "acceptance_current_change_cone",
        criterion_kind: "acceptance",
        text: "Verify the exact file list recorded by the current architecture revision.",
      }],
    },
  };
  const architectureDigest = digest(architecture);
  const currentWork = pool.works.get(key("tenant-a", work.work_id));
  currentWork.current_version = 2;
  pool.architectures.set(key("tenant-a", work.work_id, 2), {
    version: 2,
    architecture,
    architecture_digest: architectureDigest,
  });
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
    idempotency_key: "native-plan-amended-acceptance",
  };
  const planned = await runtime.planNativeAgents(identity, request, {
    corePlan: corePlanFor(work, request),
  });

  assert.equal(planned.plan.acceptance_contract.schema_version,
    "intent_acceptance_contract_v2");
  assert.equal(planned.plan.acceptance_contract.architecture_version, 2);
  assert.equal(planned.plan.acceptance_contract.architecture_digest, architectureDigest);
  assert.deepEqual(planned.plan.acceptance_contract.criteria.map((criterion) => criterion.criterion_id), [
    "objective", "constraint_1", "acceptance_current_change_cone",
  ]);

  const reorderJsonObjectKeys = (value) => {
    if (Array.isArray(value)) return value.map(reorderJsonObjectKeys);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().reverse()
      .map((itemKey) => [itemKey, reorderJsonObjectKeys(value[itemKey])]));
  };
  const storedPlan = pool.plans.get(key("tenant-a", planned.plan.plan_id));
  storedPlan.plan = reorderJsonObjectKeys(storedPlan.plan);
  storedPlan.plan_digest = digest(storedPlan.plan);
  const reordered = await runtime.evaluateClosure(identity, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    idempotency_key: "native-plan-amended-jsonb-order",
  });
  assert.equal(reordered.missing.includes("intent_acceptance_contract_invalid"), false);

  const replacement = storedPlan.plan.acceptance_contract.criteria.find(
    (criterion) => criterion.criterion_id === "acceptance_current_change_cone",
  );
  replacement.text = `${replacement.text} tampered`;
  storedPlan.plan.acceptance_contract.criteria_digest = digest(
    storedPlan.plan.acceptance_contract.criteria,
  );
  storedPlan.plan_digest = digest(storedPlan.plan);
  const tampered = await runtime.evaluateClosure(identity, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    idempotency_key: "native-plan-amended-jsonb-order-tampered",
  });
  assert.equal(tampered.missing.includes("intent_acceptance_contract_invalid"), true);
});

test("only a bound independent verifier can read redacted persisted acceptance criteria", async () => {
  const clock = () => new Date("2026-08-29T22:35:00.000Z");
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({
    dttAgentIdentitySigningSecret: "a".repeat(32),
  }, { pool, now: clock });
  const coordinator = {
    tenantId: "tenant-a",
    subject: "coordinator",
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      host_kind: "codex_native",
      client_type: "codex",
      capabilities: ["work.operate", "host_native.authorize"],
    },
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      session_fingerprint: "a".repeat(64),
      host_transport_session_fingerprint: "b".repeat(64),
      transport_bound: true,
      signature: `ags_${"a".repeat(32)}`,
    },
  };
  const work = await runtime.ensure(coordinator, initialInput, { creationAuthorized: true });
  const request = {
    work_id: work.work_id,
    repository: "owner/repo",
    host_type: "codex_native",
    required_checks: ["core-mcp"],
    tasks: [
      { task_id: "build", kind: "builder", instruction: "Build only." },
      {
        task_id: "verify", kind: "verifier", instruction: "Verify independently.",
        dependencies: ["build"],
      },
    ],
    max_parallel: 2,
    idempotency_key: "native-acceptance-contract-read",
  };
  const planned = await runtime.planNativeAgents(coordinator, request, {
    corePlan: corePlanFor(work, request),
  });
  const builderBinding = await runtime.bindNativeAgent(coordinator, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    task_id: "build",
    native_agent_id: "codex-builder",
    host_type: "codex_native",
    host_task_id: "/root/build",
  });
  const childIdentity = (agentId, fingerprint) => ({
    ...coordinator,
    agentPresence: {
      agent_id: agentId,
      client_type: "codex",
      host_kind: "codex_native",
      session_fingerprint: fingerprint,
      host_transport_session_fingerprint: fingerprint,
      transport_bound: true,
      signature: `ags_${fingerprint.slice(0, 32)}`,
    },
  });
  const builderIdentity = childIdentity("codex-builder", "1".repeat(64));
  const verifierIdentity = childIdentity("codex-verifier", "2".repeat(64));
  const builderInput = {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    native_agent_id: "codex-builder",
    host_task_id: "/root/build",
    assignment_capability: builderBinding.assignment_capability,
  };
  await assert.rejects(
    runtime.readNativeAgentAcceptanceContract(builderIdentity, builderInput),
    /native_agent_acceptance_contract_verifier_required/,
  );
  await runtime.reportNativeAgent(builderIdentity, {
    ...builderInput,
    status: "completed",
    report: {
      summary: "Builder provenance only.",
      commit_sha: "a".repeat(40),
      tests: [{ name: "focused", passed: true }],
      evidence_refs: ["commit:a"],
    },
  });
  const verifierBinding = await runtime.bindNativeAgent(coordinator, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    task_id: "verify",
    native_agent_id: "codex-verifier",
    host_type: "codex_native",
    host_task_id: "/root/verify",
  });
  const verifierInput = {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    native_agent_id: "codex-verifier",
    host_task_id: "/root/verify",
    assignment_capability: verifierBinding.assignment_capability,
  };
  const eventCount = pool.events.get(key("tenant-a", work.work_id)).length;
  const read = await runtime.readNativeAgentAcceptanceContract(verifierIdentity, verifierInput);
  assert.equal(read.schema_version, "native_agent_acceptance_contract_read_v1");
  assert.equal(read.execution_authorized, false);
  assert.deepEqual(read.acceptance_contract.criteria.map((criterion) => criterion.criterion_digest),
    planned.plan.acceptance_contract.criteria.map((criterion) => criterion.criterion_digest));
  assert.equal("assignment_capability" in read, false);
  assert.equal("lease_expires_at" in read, false);
  assert.equal("core_authority" in read, false);
  assert.equal("plan" in read, false);
  assert.equal(pool.events.get(key("tenant-a", work.work_id)).length, eventCount);
  await assert.rejects(
    runtime.readNativeAgentAcceptanceContract(verifierIdentity, {
      ...verifierInput,
      host_task_id: "/root/other",
    }),
    /native_agent_host_task_mismatch/,
  );
  await assert.rejects(
    runtime.readNativeAgentAcceptanceContract({ ...verifierIdentity, tenantId: "tenant-b" }, verifierInput),
    /native_agent_binding_not_found/,
  );
  const persisted = pool.plans.get(key("tenant-a", planned.plan.plan_id));
  persisted.plan.acceptance_contract.criteria_digest = "0".repeat(64);
  persisted.plan_digest = digest(persisted.plan);
  await assert.rejects(
    runtime.readNativeAgentAcceptanceContract(verifierIdentity, verifierInput),
    /native_agent_acceptance_contract_invalid/,
  );
});

test("native agent leases enforce Core max_parallel and expire stale host bindings", async () => {
  let instant = new Date("2026-07-29T13:10:00.000Z");
  const clock = () => new Date(instant);
  const skewedHostClock = () => new Date(instant.getTime() + 2 * 60 * 60 * 1_000);
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({
    dttAgentIdentitySigningSecret: "d".repeat(32),
  }, { pool, now: skewedHostClock });
  const legacyFallbackOnlyRuntime = createWorkContinuityRuntime({
    agentSignatureSecret: "a".repeat(32),
    ownerContextSigningSecret: "o".repeat(32),
  }, { pool, now: clock });
  const identity = {
    tenantId: "tenant-a",
    subject: "coordinator",
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      host_kind: "codex_native",
      client_type: "codex",
      capabilities: ["work.operate", "host_native.authorize"],
    },
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      session_fingerprint: "b".repeat(64),
      host_transport_session_fingerprint: "c".repeat(64),
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
  const reconnectedCoordinator = {
    ...identity,
    agentPresence: {
      ...identity.agentPresence,
      // Same logical conversation, but a different authenticated transport.
      host_transport_session_fingerprint: "d".repeat(24),
    },
  };
  await assert.rejects(runtime.bindNativeAgent(reconnectedCoordinator, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    task_id: "build",
    native_agent_id: "reconnected-builder",
    host_type: "codex_native",
    host_task_id: "/root/reconnected-build",
  }), /native_agent_coordinator_transport_mismatch/);
  assert.equal(pool.nativeAgents.size, 0);
  const bind = (taskId, agentId) => runtime.bindNativeAgent(identity, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    task_id: taskId,
    native_agent_id: agentId,
    host_type: "codex_native",
    host_task_id: `/root/${taskId}`,
  });
  const builderBinding = await bind("build", "codex-builder");
  assert.equal(
    builderBinding.binding.lease_expires_at,
    "2026-07-29T14:10:00.000Z",
  );
  await assert.rejects(bind("research", "codex-researcher"), /native_agent_parallel_limit_reached/);

  const builderIdentity = {
    ...identity,
    agentPresence: {
      agent_id: "codex-builder",
      client_type: "codex",
      session_fingerprint: "1".repeat(64),
      host_transport_session_fingerprint: "1".repeat(64),
      host_kind: "codex_native",
      signature: `ags_${"1".repeat(32)}`,
      transport_bound: true,
    },
  };
  const builderReportInput = {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    native_agent_id: "codex-builder",
    host_task_id: "/root/build",
    assignment_capability: builderBinding.assignment_capability,
  };
  await runtime.admitNativeAgentReport(builderIdentity, builderReportInput);
  await runtime.reportNativeAgent(builderIdentity, {
    ...builderReportInput,
    status: "completed",
    report: {
      summary: "On-time result under forward host clock skew.",
      commit_sha: "d".repeat(40),
      tests: [{ name: "forward-skew", passed: true }],
      evidence_refs: ["clock:database-authoritative"],
    },
  });
  const researchBinding = await bind("research", "codex-researcher");

  instant = new Date("2026-07-29T14:11:00.000Z");
  const expiredResearchIdentity = {
    ...identity,
    agentPresence: {
      agent_id: "codex-researcher",
      client_type: "codex",
      session_fingerprint: "1".repeat(64),
      host_transport_session_fingerprint: "1".repeat(64),
      host_kind: "codex_native",
      signature: `ags_${"1".repeat(32)}`,
      transport_bound: true,
    },
  };
  await assert.rejects(runtime.reportNativeAgent(expiredResearchIdentity, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    native_agent_id: "codex-researcher",
    host_task_id: "/root/research",
    assignment_capability: researchBinding.assignment_capability,
    status: "completed",
    report: {
      summary: "Late result.",
      commit_sha: "e".repeat(40),
      tests: [{ name: "late", passed: true }],
      evidence_refs: ["late:result"],
    },
  }), /native_agent_binding_expired_replan_required/);
  const expiredResearcher = pool.nativeAgents.get(
    key("tenant-a", planned.plan.plan_id, "research"),
  );
  assert.equal(expiredResearcher.status, "expired");
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

test("precommit-native reports agree on one server-digested workspace before a commit ticket", async () => {
  const clock = () => new Date("2026-08-28T21:30:00.000Z");
  const pool = new ContinuityPool(clock);
  const gateBridgeCalls = [];
  const runtime = createWorkContinuityRuntime({
    dttAgentIdentitySigningSecret: "p".repeat(32),
  }, {
    pool,
    now: clock,
    nativePrecommitGateBridgeRequired: true,
    nativePrecommitGateBridge: async (client, source) => {
      assert.equal(client, pool);
      gateBridgeCalls.push(source);
      const projection = {
        schema_version: "precommit_ticket_gate_v2",
        gate_source: "native_closure_evaluation",
        tenant_id: source.tenant_id,
        work_id: source.work_id,
        action_kind: "git.commit",
        gate_kind: "ticket_acquisition",
        task_id: "00000000-0000-4000-8000-000000000101",
        plan_id: source.plan_id,
        evaluation_id: source.evaluation_id,
        evaluation_digest: source.evaluation_digest,
        workspace_digest: source.workspace_digest,
        supersession_digest: "c".repeat(64),
        reconciliation_digest: "d".repeat(64),
        legacy_evidence_ids: [],
        replacement_evidence_ids: [],
        fulfilled: false,
        ticket_id: null,
        fresh: true,
        drift_codes: [],
      };
      return Object.freeze({
        ...projection,
        projection_digest: digest(projection),
        idempotent_replay: false,
      });
    },
  });
  const identity = {
    tenantId: "tenant-a",
    subject: "coordinator",
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      host_kind: "codex_native",
      client_type: "codex",
      capabilities: ["work.operate", "host_native.authorize"],
    },
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      session_fingerprint: "a".repeat(64),
    },
  };
  const work = await runtime.ensure(identity, {
    ...initialInput,
    session_id: "precommit-report-session",
  }, { creationAuthorized: true });
  const request = {
    work_id: work.work_id,
    repository: "owner/repo",
    host_type: "codex_native",
    required_checks: ["core-mcp"],
    tasks: [
      { task_id: "build", kind: "builder", instruction: "Prepare the exact tracked diff." },
      { task_id: "verify", kind: "verifier", instruction: "Verify the exact tracked diff.", dependencies: ["build"] },
    ],
    idempotency_key: "precommit-native-plan",
  };
  const planned = await runtime.planNativeAgents(identity, request, {
    corePlan: corePlanFor(work, request),
  });
  const planId = planned.plan.plan_id;
  const precommitEvidence = {
    schema_version: "native_precommit_evidence_v1",
    diff_mode: "git_diff_binary_sha256_v1",
    base_commit: "a".repeat(40),
    diff_digest: "b".repeat(64),
    changed_files: ["src/core.js", "test/core.test.js"],
  };
  const builderBinding = await runtime.bindNativeAgent(identity, {
    work_id: work.work_id,
    plan_id: planId,
    task_id: "build",
    native_agent_id: "precommit-builder",
    host_type: "codex_native",
    host_task_id: "/root/precommit-builder",
  });
  const builderIdentity = {
    ...identity,
    agentPresence: {
      agent_id: "precommit-builder",
      client_type: "codex",
      session_fingerprint: "b".repeat(64),
      host_transport_session_fingerprint: "b".repeat(64),
      host_kind: "codex_native",
      signature: `ags_${"b".repeat(32)}`,
      transport_bound: true,
    },
  };
  await assert.rejects(runtime.reportNativeAgent(builderIdentity, {
    work_id: work.work_id,
    plan_id: planId,
    native_agent_id: "precommit-builder",
    host_task_id: "/root/precommit-builder",
    assignment_capability: builderBinding.assignment_capability,
    status: "completed",
    report: {
      summary: "Ambiguous evidence must fail.",
      commit_sha: "c".repeat(40),
      precommit_evidence: precommitEvidence,
    },
  }), /native_agent_report_source_ambiguous/);
  await runtime.reportNativeAgent(builderIdentity, {
    work_id: work.work_id,
    plan_id: planId,
    native_agent_id: "precommit-builder",
    host_task_id: "/root/precommit-builder",
    assignment_capability: builderBinding.assignment_capability,
    status: "completed",
    report: {
      summary: "Prepared and tested the exact precommit diff.",
      precommit_evidence: precommitEvidence,
      tests: [{ name: "node --test", passed: true }],
      evidence_refs: ["workspace:tracked-diff"],
    },
  });
  const verifierBinding = await runtime.bindNativeAgent(identity, {
    work_id: work.work_id,
    plan_id: planId,
    task_id: "verify",
    native_agent_id: "precommit-verifier",
    host_type: "codex_native",
    host_task_id: "/root/precommit-verifier",
  });
  const verifierIdentity = {
    ...identity,
    agentPresence: {
      agent_id: "precommit-verifier",
      client_type: "codex",
      session_fingerprint: "c".repeat(64),
      host_transport_session_fingerprint: "c".repeat(64),
      host_kind: "codex_native",
      signature: `ags_${"c".repeat(32)}`,
      transport_bound: true,
    },
  };
  const acceptanceEvidence = planned.plan.acceptance_contract.criteria.map((criterion) => ({
    criterion_digest: criterion.criterion_digest,
    passed: true,
    evidence_refs: [`verified:${criterion.criterion_id}`],
  }));
  const verifierInput = {
    work_id: work.work_id,
    plan_id: planId,
    native_agent_id: "precommit-verifier",
    host_task_id: "/root/precommit-verifier",
    assignment_capability: verifierBinding.assignment_capability,
    status: "completed",
    report: {
      summary: "Independently verified the exact precommit diff.",
      verdict: "approved",
      precommit_evidence: precommitEvidence,
      verifies_task_ids: ["build"],
      tests: [{ name: "independent node --test", passed: true }],
      evidence_refs: ["review:tracked-diff"],
      acceptance_evidence: acceptanceEvidence,
    },
  };
  await assert.rejects(runtime.reportNativeAgent(verifierIdentity, {
    ...verifierInput,
    report: {
      ...verifierInput.report,
      precommit_evidence: { ...precommitEvidence, diff_digest: "d".repeat(64) },
    },
  }), /native_agent_precommit_evidence_mismatch/);
  await runtime.reportNativeAgent(verifierIdentity, verifierInput);

  const evaluation = await runtime.evaluateClosure(identity, {
    work_id: work.work_id,
    plan_id: planId,
    idempotency_key: "precommit-evaluation",
  });
  assert.equal(evaluation.closed, false);
  assert.equal(evaluation.commit_ticket_ready, true);
  assert.equal(evaluation.execution_authorized, false);
  assert.match(evaluation.precommit_verification.workspace_digest, /^[a-f0-9]{64}$/);
  assert.equal(gateBridgeCalls.length, 1);
  assert.deepEqual(gateBridgeCalls[0], {
    schema_version: "native_precommit_gate_source_v1",
    server_owned: true,
    tenant_id: "tenant-a",
    work_id: work.work_id,
    plan_id: planId,
    plan_digest: planned.plan_digest,
    evaluation_id: evaluation.evaluation_id,
    evaluation_digest: evaluation.evaluation_digest,
    workspace_digest: evaluation.precommit_verification.workspace_digest,
    evaluated_by: "codex-coordinator",
  });
  assert.equal(evaluation.precommit_ticket_gate.schema_version, "precommit_ticket_gate_v2");
  assert.equal(evaluation.precommit_ticket_gate.projection_digest,
    digest(Object.fromEntries(Object.entries(evaluation.precommit_ticket_gate)
      .filter(([key]) => key !== "projection_digest"))));
  assert.match(pool.works.get(key("tenant-a", work.work_id)).next_action,
    /exact Core git\.commit ticket/);
});

test("only a Core-signed read-only/no-file-change task may complete without source provenance", async () => {
  const clock = () => new Date("2026-08-29T20:30:00.000Z");
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({
    dttAgentIdentitySigningSecret: "r".repeat(32),
  }, { pool, now: clock });
  const identity = {
    tenantId: "tenant-a",
    subject: "coordinator",
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      host_kind: "codex_native",
      client_type: "codex",
      capabilities: ["work.operate", "host_native.authorize"],
    },
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      session_fingerprint: "a".repeat(64),
    },
  };
  const work = await runtime.ensure(identity, {
    ...initialInput,
    session_id: "read-only-source-contract-session",
  }, { creationAuthorized: true });
  const request = {
    work_id: work.work_id,
    repository: "owner/repo",
    host_type: "codex_native",
    required_checks: ["core-mcp"],
    tasks: [
      { task_id: "audit", kind: "builder", instruction: "Read the existing ADR only." },
      {
        task_id: "verify",
        kind: "verifier",
        instruction: "Independently verify the existing ADR only.",
        dependencies: ["audit"],
      },
    ],
    idempotency_key: "ordinary-source-contract-plan",
  };
  const ordinary = await runtime.planNativeAgents(identity, request, {
    corePlan: corePlanFor(work, request),
  });
  const ordinaryBinding = await runtime.bindNativeAgent(identity, {
    work_id: work.work_id,
    plan_id: ordinary.plan.plan_id,
    task_id: "audit",
    native_agent_id: "ordinary-audit-builder",
    host_type: "codex_native",
    host_task_id: "/root/ordinary-audit-builder",
  });
  const ordinaryBuilderIdentity = {
    ...identity,
    agentPresence: {
      agent_id: "ordinary-audit-builder",
      client_type: "codex",
      session_fingerprint: "b".repeat(64),
      host_transport_session_fingerprint: "b".repeat(64),
      host_kind: "codex_native",
      signature: `ags_${"b".repeat(32)}`,
      transport_bound: true,
    },
  };
  await assert.rejects(runtime.reportNativeAgent(ordinaryBuilderIdentity, {
    work_id: work.work_id,
    plan_id: ordinary.plan.plan_id,
    native_agent_id: "ordinary-audit-builder",
    host_task_id: "/root/ordinary-audit-builder",
    assignment_capability: ordinaryBinding.assignment_capability,
    status: "completed",
    report: {
      summary: "A caller field must not bypass source provenance.",
      read_only_no_file_change: true,
      tests: [{ name: "read-only audit", passed: true }],
      evidence_refs: ["adr:existing"],
    },
  }), /native_agent_report_commit_or_precommit_required/);

  const readOnlyRequest = {
    ...request,
    idempotency_key: "core-signed-read-only-source-contract-plan",
  };
  const corePlan = corePlanFor(work, readOnlyRequest, {
    readOnlyNoFileChangeTaskIds: ["audit", "verify"],
  });
  const planned = await runtime.planNativeAgents(identity, readOnlyRequest, { corePlan });
  assert.deepEqual(
    planned.plan.core_authority.report_source_requirements,
    {
      schema_version: "core_native_report_source_requirements_v1",
      read_only_no_file_change_task_ids: ["audit", "verify"],
    },
  );
  const builderBinding = await runtime.bindNativeAgent(identity, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    task_id: "audit",
    native_agent_id: "read-only-audit-builder",
    host_type: "codex_native",
    host_task_id: "/root/read-only-audit-builder",
  });
  const builderIdentity = {
    ...identity,
    agentPresence: {
      agent_id: "read-only-audit-builder",
      client_type: "codex",
      session_fingerprint: "c".repeat(64),
      host_transport_session_fingerprint: "c".repeat(64),
      host_kind: "codex_native",
      signature: `ags_${"c".repeat(32)}`,
      transport_bound: true,
    },
  };
  await runtime.reportNativeAgent(builderIdentity, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    native_agent_id: "read-only-audit-builder",
    host_task_id: "/root/read-only-audit-builder",
    assignment_capability: builderBinding.assignment_capability,
    status: "completed",
    report: {
      summary: "Read-only ADR audit completed without changing files.",
      tests: [{ name: "read-only audit", passed: true }],
      evidence_refs: ["adr:existing"],
    },
  });
  const verifierBinding = await runtime.bindNativeAgent(identity, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    task_id: "verify",
    native_agent_id: "read-only-audit-verifier",
    host_type: "codex_native",
    host_task_id: "/root/read-only-audit-verifier",
  });
  const verifierIdentity = {
    ...identity,
    agentPresence: {
      agent_id: "read-only-audit-verifier",
      client_type: "codex",
      session_fingerprint: "d".repeat(64),
      host_transport_session_fingerprint: "d".repeat(64),
      host_kind: "codex_native",
      signature: `ags_${"d".repeat(32)}`,
      transport_bound: true,
    },
  };
  await runtime.reportNativeAgent(verifierIdentity, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    native_agent_id: "read-only-audit-verifier",
    host_task_id: "/root/read-only-audit-verifier",
    assignment_capability: verifierBinding.assignment_capability,
    status: "completed",
    report: {
      summary: "Independent read-only ADR verification completed.",
      verdict: "approved",
      verifies_task_ids: ["audit"],
      tests: [{ name: "independent read-only audit", passed: true }],
      evidence_refs: ["adr:existing-independent"],
      acceptance_evidence: planned.plan.acceptance_contract.criteria.map((criterion) => ({
        criterion_digest: criterion.criterion_digest,
        passed: true,
        evidence_refs: [`verified:${criterion.criterion_id}`],
      })),
    },
  });
  const closure = await runtime.evaluateClosure(identity, {
    work_id: work.work_id,
    plan_id: planned.plan.plan_id,
    idempotency_key: "core-signed-read-only-source-contract-closure",
  });
  assert.equal(closure.closed, false);
  assert.equal(closure.execution_authorized, false);
  assert(closure.missing.includes("builder_target_commit_missing"));
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

test("missing native plan during pre-execution closure evaluation records evidence without blocking the Work", async () => {
  const instant = new Date("2026-07-29T14:25:00.000Z");
  const clock = () => new Date(instant);
  const pool = new ContinuityPool(clock);
  const runtime = createWorkContinuityRuntime({}, { pool, now: clock });
  const identity = {
    tenantId: "tenant-a",
    subject: "coordinator",
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      session_fingerprint: "e".repeat(64),
    },
  };
  const work = await runtime.ensure(identity, {
    ...initialInput,
    session_id: "pre-execution-plan-lookup-session",
  }, { creationAuthorized: true });

  const result = await runtime.recordOperationalIncident(identity, {
    work_id: work.work_id,
    operation: "work_continuity_closure_evaluate",
    error_code: "native_agent_plan_not_found",
    evidence_digest: "9".repeat(64),
    next_action: "Persist the bounded native plan, then re-evaluate closure.",
  });

  assert.equal(result.status, "candidate");
  assert.equal(result.work_status, "active");
  assert.equal(pool.works.get(key("tenant-a", work.work_id)).status, "active");
  assert.equal((pool.events.get(key("tenant-a", work.work_id)) || []).at(-1).event_type, "incident_recorded");
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
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      host_kind: "chatgpt_native",
      client_type: "chatgpt",
      capabilities: ["work.operate", "host_native.authorize"],
    },
    agentPresence: {
      agent_id: "codex-coordinator",
      client_type: "codex",
      session_fingerprint: "d".repeat(64),
      host_transport_session_fingerprint: "7".repeat(64),
      host_kind: "chatgpt_native",
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
    host_type: "chatgpt_native",
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
  const externalReadbackVerifier = async ({
    ticket,
    target_commit,
    verification_scope,
  }) => {
    externalReadbackCalls += 1;
    assert.equal(verification_scope, "github_merge_and_checks_only");
    const binding = ticket.release_manifest_binding;
    const action = ticket.action;
    const githubUnsigned = {
      api_origin: "https://api.github.com",
      repository: ticket.repository,
      action_kind: action.kind,
      head_branch: action.head_branch,
      base_branch: action.base_branch,
      pull_request: action.pull_request,
      merged: true,
      head_commit: action.head_commit,
      expected_base_commit: action.expected_base_commit,
      merge_commit: target_commit,
      target_commit,
      branch: action.base_branch,
      branch_commit: null,
      checks_commit: binding.verification.checks_commit,
      checks_passed: true,
      required_checks: [...binding.verification.required_checks],
      observed_checks: binding.verification.required_checks.map((name) => ({
        name,
        head_commit: binding.verification.checks_commit,
        status: "completed",
        conclusion: "success",
      })),
      rollback_commit: binding.rollback.target_commit,
      rollback_commit_available: true,
    };
    return {
      schema_version: "host_native_external_readback_v1",
      trusted: true,
      verifier_id: "core_server_external_readback_v1",
      verification_scope,
      verified_at: clock().toISOString(),
      github: {
        ...githubUnsigned,
        readback_digest: hostNativeDigest(githubUnsigned),
      },
      services: [],
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
    coreJoinTtlMs: 1_000,
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
    host_type: "chatgpt_native",
    host_task_id: "/root/build",
  });
  await assert.rejects(runtime.bindNativeAgent(identity, {
    work_id: work.work_id,
    plan_id: planId,
    task_id: "verify",
    native_agent_id: "codex-verifier",
    host_type: "chatgpt_native",
    host_task_id: "/root/verify",
  }), /native_agent_dependency_not_ready/);
  const builderIdentity = {
    ...identity,
    agentPresence: {
      agent_id: "codex-builder",
      client_type: "codex",
      session_fingerprint: "1".repeat(64),
      host_transport_session_fingerprint: "1".repeat(64),
      host_kind: "chatgpt_native",
      signature: `ags_${"1".repeat(32)}`,
      transport_bound: true,
    },
  };
  const wrongHostBuilderIdentity = {
    ...builderIdentity,
    authenticatedHostPrincipal: {
      ...builderIdentity.authenticatedHostPrincipal,
      host_kind: "codex_native",
      client_type: "codex",
    },
    agentPresence: {
      ...builderIdentity.agentPresence,
      host_kind: "codex_native",
    },
  };
  await assert.rejects(runtime.reportNativeAgent(wrongHostBuilderIdentity, {
    work_id: work.work_id,
    plan_id: planId,
    native_agent_id: "codex-builder",
    host_task_id: "/root/build",
    assignment_capability: builderBinding.assignment_capability,
    status: "completed",
    report: {
      summary: "A Codex host must not report a ChatGPT-bound assignment.",
      commit_sha: "e".repeat(40),
      tests: [{ name: "node --test", passed: true }],
      evidence_refs: ["commit:pending"],
    },
  }), /native_agent_reporter_host_scope_mismatch/);
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
    host_type: "chatgpt_native",
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
      host_kind: "chatgpt_native",
      signature: `ags_${"3".repeat(32)}`,
      transport_bound: true,
    },
  };
  await runtime.reportNativeAgent(verifierIdentity, verifierReportInput);
  await assert.rejects(runtime.evaluateClosure(identity, {
    work_id: work.work_id,
    plan_id: planId,
    idempotency_key: "closure-release-required",
  }), /continuity_release_required/);
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
  let evaluation = await runtime.evaluateClosure(identity, {
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

  let releaseIntent = buildHostReleaseIntentV1({
    tenant_id: "tenant-a",
    ...evaluation.core_join_material.release_intent_request,
  });
  let coreJoinRecord = await realCore.issueCoreJoinVerdict({
    tenant_id: "tenant-a",
    ...evaluation.core_join_material.core_join_request,
    software_closure_digest: "8".repeat(64),
    software_closure_fresh_until: "2099-08-15T12:00:00.000Z",
    release_intent: releaseIntent,
    idempotency_key: "real-core-hnj-contract",
  });
  let verdict = coreJoinRecord.verdict;
  let verdictId = verdict.verdict_id;
  const expectedCoreClaim = {
    tenant_id: "tenant-a",
    ...evaluation.core_join_material.core_join_request,
    release_intent_digest: releaseIntent.release_intent_digest,
    base_branch: releaseIntent.base_branch,
    software_closure_digest: "8".repeat(64),
    software_closure_fresh_until: "2099-08-15T12:00:00.000Z",
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
      schema_version: "host_native_core_join_claim_v2",
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
  const activeReplayEvaluation = await runtime.evaluateClosure(identity, {
    work_id: work.work_id,
    plan_id: planId,
    release: releaseInput,
    idempotency_key: "closure-evaluation-active-core-join-replay",
  });
  assert.notEqual(activeReplayEvaluation.evaluation_id, evaluation.evaluation_id);
  const activeReplay = await runtime.prepareEffectiveCoreJoinEvaluation(identity, {
    work_id: work.work_id,
    plan_id: planId,
    evaluation_id: activeReplayEvaluation.evaluation_id,
    release: releaseInput,
  });
  assert.equal(activeReplay.core_join_replay, true);
  assert.equal(activeReplay.evaluation_id, evaluation.evaluation_id);
  assert.equal(
    activeReplay.core_join_material.material_digest,
    evaluation.core_join_material.material_digest,
  );
  const replayWork = pool.works.get(key("tenant-a", work.work_id));
  replayWork.status = "active";
  replayWork.next_action = "Awaiting replayed Core Join binding.";
  const rebound = await runtime.bindCoreJoinVerdict(identity, {
    work_id: work.work_id,
    plan_id: planId,
    evaluation_id: activeReplay.evaluation_id,
  }, { releaseIntent, coreJoinRecord });
  assert.equal(rebound.idempotent_replay, true);
  assert.equal(pool.works.get(key("tenant-a", work.work_id)).status, "release_ready");
  assert.equal(
    pool.works.get(key("tenant-a", work.work_id)).next_action,
    "Use the persisted Core Join to obtain the exact action ticket, execute through host policy, then verify live readback.",
  );
  const evaluationCountBeforeRenewal =
    pool.evaluations.get(key("tenant-a", work.work_id, planId)).length;

  const initialEvaluation = evaluation;
  const initialReleaseIntent = releaseIntent;
  const initialCoreJoinRecord = coreJoinRecord;
  const initialVerdictId = verdictId;
  clockMillis = Date.parse(verdict.expires_at) + 1;
  const freshEvaluation = await runtime.evaluateClosure(identity, {
    work_id: work.work_id,
    plan_id: planId,
    release: releaseInput,
    idempotency_key: "closure-evaluation-after-core-join-expiry",
  });
  assert.notEqual(freshEvaluation.evaluation_id, initialEvaluation.evaluation_id);
  assert.equal(freshEvaluation.evaluation_digest, initialEvaluation.evaluation_digest);
  evaluation = await runtime.prepareEffectiveCoreJoinEvaluation(identity, {
    work_id: work.work_id,
    plan_id: planId,
    evaluation_id: freshEvaluation.evaluation_id,
    release: releaseInput,
  });
  assert.equal(evaluation.core_join_renewed, true);
  assert.equal(evaluation.evaluation_id, initialEvaluation.evaluation_id);
  assert.equal(evaluation.evaluation_digest, initialEvaluation.evaluation_digest);
  assert.equal(evaluation.core_join_renewal_generation, 1);
  assert.equal(
    evaluation.core_join_material.core_join_request.core_join_renewal
      .predecessor_verdict_id,
    initialVerdictId,
  );
  assert.equal(
    pool.evaluations.get(key("tenant-a", work.work_id, planId)).length,
    evaluationCountBeforeRenewal + 1,
  );

  releaseIntent = buildHostReleaseIntentV1({
    tenant_id: "tenant-a",
    ...evaluation.core_join_material.release_intent_request,
  });
  assert.equal(
    releaseIntent.release_intent_digest,
    initialReleaseIntent.release_intent_digest,
  );
  assert.deepEqual(releaseIntent, initialReleaseIntent);
  coreJoinRecord = await realCore.issueCoreJoinVerdict({
    tenant_id: "tenant-a",
    ...evaluation.core_join_material.core_join_request,
    software_closure_digest: "8".repeat(64),
    software_closure_fresh_until: "2099-08-15T12:00:00.000Z",
    release_intent: releaseIntent,
    idempotency_key: "real-core-hnj-contract-renewal",
  });
  verdict = coreJoinRecord.verdict;
  verdictId = verdict.verdict_id;
  assert.notEqual(verdictId, initialVerdictId);
  assert.equal(verdict.core_join_renewal.generation, 1);
  assert.equal(initialCoreJoinRecord.state, "active");
  const renewedJoin = await runtime.bindCoreJoinVerdict(identity, {
    work_id: work.work_id,
    plan_id: planId,
    evaluation_id: evaluation.evaluation_id,
  }, { releaseIntent, coreJoinRecord });
  assert.equal(renewedJoin.release_ready, true);
  assert.equal(renewedJoin.renewal_generation, 1);
  assert.equal(renewedJoin.renewal_of_verdict_id, initialVerdictId);
  assert.equal(pool.releaseJoins.size, 2);
  assert.equal(
    pool.releaseJoins.get(key("tenant-a", initialEvaluation.evaluation_id, 0)).verdict_id,
    initialVerdictId,
  );
  assert.equal(
    pool.releaseJoins.get(key("tenant-a", initialEvaluation.evaluation_id, 1)).verdict_id,
    verdictId,
  );

  const renewalReplay = await runtime.prepareEffectiveCoreJoinEvaluation(identity, {
    work_id: work.work_id,
    plan_id: planId,
    evaluation_id: initialEvaluation.evaluation_id,
    release: releaseInput,
  });
  assert.equal(renewalReplay.core_join_replay, true);
  assert.equal(renewalReplay.evaluation_id, evaluation.evaluation_id);
  assert.equal(
    renewalReplay.core_join_material.material_digest,
    evaluation.core_join_material.material_digest,
  );
  assert.equal(
    pool.evaluations.get(key("tenant-a", work.work_id, planId)).length,
    evaluationCountBeforeRenewal + 1,
  );

  const generationOneVerdictId = verdictId;
  const generationOneRecord = coreJoinRecord;
  clockMillis = Date.parse(verdict.expires_at) + 1;
  const secondRenewal = await runtime.prepareEffectiveCoreJoinEvaluation(identity, {
    work_id: work.work_id,
    plan_id: planId,
    evaluation_id: initialEvaluation.evaluation_id,
    release: releaseInput,
  });
  assert.equal(secondRenewal.core_join_renewed, true);
  assert.equal(secondRenewal.evaluation_id, initialEvaluation.evaluation_id);
  assert.equal(secondRenewal.evaluation_digest, initialEvaluation.evaluation_digest);
  assert.equal(secondRenewal.core_join_renewal_generation, 2);
  assert.equal(
    secondRenewal.core_join_material.core_join_request.core_join_renewal
      .predecessor_verdict_id,
    generationOneVerdictId,
  );
  const secondReleaseIntent = buildHostReleaseIntentV1({
    tenant_id: "tenant-a",
    ...secondRenewal.core_join_material.release_intent_request,
  });
  assert.deepEqual(secondReleaseIntent, initialReleaseIntent);
  const secondRecord = await realCore.issueCoreJoinVerdict({
    tenant_id: "tenant-a",
    ...secondRenewal.core_join_material.core_join_request,
    software_closure_digest: "8".repeat(64),
    software_closure_fresh_until: "2099-08-15T12:00:00.000Z",
    release_intent: secondReleaseIntent,
    idempotency_key: "real-core-hnj-contract-renewal-generation-2",
  });
  const secondVerdictId = secondRecord.verdict.verdict_id;
  assert.notEqual(secondVerdictId, initialVerdictId);
  assert.notEqual(secondVerdictId, generationOneVerdictId);
  assert.equal(secondRecord.claim.core_join_renewal.generation, 2);
  const secondJoined = await runtime.bindCoreJoinVerdict(identity, {
    work_id: work.work_id,
    plan_id: planId,
    evaluation_id: initialEvaluation.evaluation_id,
  }, { releaseIntent: secondReleaseIntent, coreJoinRecord: secondRecord });
  assert.equal(secondJoined.renewal_generation, 2);
  assert.equal(secondJoined.renewal_of_verdict_id, generationOneVerdictId);
  assert.equal(pool.releaseJoins.size, 3);
  assert.equal(
    pool.releaseJoins.get(key("tenant-a", initialEvaluation.evaluation_id, 2)).verdict_id,
    secondVerdictId,
  );
  assert.equal(
    pool.evaluations.get(key("tenant-a", work.work_id, planId)).length,
    evaluationCountBeforeRenewal + 1,
  );
  assert.equal(initialCoreJoinRecord.verdict.verdict_id, initialVerdictId);
  assert.equal(generationOneRecord.verdict.verdict_id, generationOneVerdictId);

  // A locally observed consumed predecessor must fail before any renewal
  // evaluation, release join, or audit event is persisted.
  const generationTwoJoin = pool.releaseJoins.get(
    key("tenant-a", initialEvaluation.evaluation_id, 2),
  );
  const generationTwoRecord = generationTwoJoin.core_join_record;
  const generationTwoRecordDigest = generationTwoJoin.core_join_record_digest;
  const clockBeforeConsumedProbe = clockMillis;
  const evaluationCountBeforeConsumedProbe =
    pool.evaluations.get(key("tenant-a", work.work_id, planId)).length;
  const releaseJoinCountBeforeConsumedProbe = pool.releaseJoins.size;
  const eventCountBeforeConsumedProbe =
    (pool.events.get(key("tenant-a", work.work_id)) || []).length;
  generationTwoJoin.core_join_record = {
    ...structuredClone(generationTwoRecord),
    uses: 1,
    consumed_at: "2099-08-15T12:00:00.000Z",
  };
  generationTwoJoin.core_join_record_digest = digest(
    generationTwoJoin.core_join_record,
  );
  clockMillis = Date.parse(secondRecord.verdict.expires_at) + 1;
  await assert.rejects(
    runtime.prepareEffectiveCoreJoinEvaluation(identity, {
      work_id: work.work_id,
      plan_id: planId,
      evaluation_id: initialEvaluation.evaluation_id,
      release: releaseInput,
    }),
    /continuity_core_join_renewal_predecessor_unavailable/,
  );
  assert.equal(
    pool.evaluations.get(key("tenant-a", work.work_id, planId)).length,
    evaluationCountBeforeConsumedProbe,
  );
  assert.equal(pool.releaseJoins.size, releaseJoinCountBeforeConsumedProbe);
  assert.equal(
    (pool.events.get(key("tenant-a", work.work_id)) || []).length,
    eventCountBeforeConsumedProbe,
  );
  generationTwoJoin.core_join_record = generationTwoRecord;
  generationTwoJoin.core_join_record_digest = generationTwoRecordDigest;
  clockMillis = clockBeforeConsumedProbe;

  // Continue the release flow only with the newest still-active authority.
  evaluation = secondRenewal;
  releaseIntent = secondReleaseIntent;
  coreJoinRecord = secondRecord;
  verdict = secondRecord.verdict;
  verdictId = secondVerdictId;

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
  assert.equal(coreJoinRecord.claim.checks.evidence_digest, evaluationDigest);

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
    evidence_digest: evaluationDigest,
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
  assert.equal(authorization.evidence_digest, evaluationDigest);
  assert.equal(authorization.release_intent_digest, releaseIntentDigest);
  assert.equal(authorization.core_join_verdict_digest, coreJoinClaimDigest);
  assert.equal(authorization.verification_scope, "github_merge_and_checks_only");
  assert.equal(authorization.services_verified, false);
  assert.deepEqual(authorization.live_services, []);

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
    { evidence_digest: coreJoinRecordDigest },
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

  const releaseJoinRow = pool.releaseJoins.get(
    key("tenant-a", evaluation.evaluation_id, 2),
  );
  const originalCoreJoinRecord = releaseJoinRow.core_join_record;
  const originalCoreJoinRecordDigest = releaseJoinRow.core_join_record_digest;
  const wrongEvaluationRecord = structuredClone(originalCoreJoinRecord);
  wrongEvaluationRecord.claim.evaluation_digest = "0".repeat(64);
  releaseJoinRow.core_join_record = wrongEvaluationRecord;
  releaseJoinRow.core_join_record_digest = digest(wrongEvaluationRecord);
  const wrongEvaluationAuthorization = redigestAuthorization(
    authorization,
    {},
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

  const wrongChecksEvidenceRecord = structuredClone(originalCoreJoinRecord);
  wrongChecksEvidenceRecord.claim.checks.evidence_digest = "1".repeat(64);
  releaseJoinRow.core_join_record = wrongChecksEvidenceRecord;
  releaseJoinRow.core_join_record_digest = digest(wrongChecksEvidenceRecord);
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-wrong-checks-evidence-binding",
    }, redigestAuthorization(authorization, {}, "4")),
    /continuity_external_release_authorization_mismatch/,
  );
  releaseJoinRow.core_join_record = originalCoreJoinRecord;
  releaseJoinRow.core_join_record_digest = originalCoreJoinRecordDigest;

  const originalReleaseIntent = releaseJoinRow.release_intent;
  const originalReleaseIntentDigest = releaseJoinRow.release_intent_digest;
  const wrongManifestEvidenceIntent = structuredClone(originalReleaseIntent);
  wrongManifestEvidenceIntent.verification.evidence_digest = "2".repeat(64);
  delete wrongManifestEvidenceIntent.release_intent_digest;
  const wrongManifestEvidenceIntentDigest = digest(wrongManifestEvidenceIntent);
  wrongManifestEvidenceIntent.release_intent_digest = wrongManifestEvidenceIntentDigest;
  releaseJoinRow.release_intent = wrongManifestEvidenceIntent;
  releaseJoinRow.release_intent_digest = wrongManifestEvidenceIntentDigest;
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-wrong-manifest-evidence-binding",
    }, redigestAuthorization(authorization, {
      release_intent_digest: wrongManifestEvidenceIntentDigest,
    }, "5")),
    /continuity_external_release_authorization_mismatch/,
  );
  releaseJoinRow.release_intent = originalReleaseIntent;
  releaseJoinRow.release_intent_digest = originalReleaseIntentDigest;

  const expiredAuthorization = redigestAuthorization(authorization, {
    issued_at: "2026-07-29T13:10:00.000Z",
    expires_at: "2026-07-29T13:20:00.000Z",
  }, "a");
  await assert.rejects(
    runtime.finalizeClosure(identity, baseFinalize, expiredAuthorization),
    /continuity_trusted_core_closure_receipt_required/,
  );

  const sameHostAuthorization = redigestAuthorization(
    authorization,
    { host_kind: "chatgpt_native" },
    "0",
  );
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-same-host-regression",
    }, sameHostAuthorization),
    /continuity_live_verification_required/,
  );

  const planRow = pool.plans.get(key("tenant-a", planId));
  const originalPlan = structuredClone(planRow.plan);
  planRow.plan.host_type = "browser_native";
  planRow.plan_digest = digest(planRow.plan);
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-invalid-plan-host",
    }, authorization),
    /continuity_host_policy_scope_mismatch/,
  );
  planRow.plan = structuredClone(originalPlan);
  planRow.plan_digest = digest(planRow.plan);

  const wrongRepositoryAuthorization = redigestAuthorization(
    authorization,
    { repository: "other/repo" },
    "f",
  );
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-wrong-repository",
    }, wrongRepositoryAuthorization),
    /continuity_host_policy_scope_mismatch/,
  );

  const reverseHostAuthorization = redigestAuthorization(
    authorization,
    { host_kind: "chatgpt_native" },
    "1",
  );
  planRow.plan.host_type = "codex_native";
  planRow.plan_digest = digest(planRow.plan);
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-reverse-host-handoff",
    }, reverseHostAuthorization),
    /continuity_host_policy_scope_mismatch/,
  );
  planRow.plan = structuredClone(originalPlan);
  planRow.plan_digest = digest(planRow.plan);

  const unknownReceiptHostAuthorization = redigestAuthorization(
    authorization,
    { host_kind: "browser_native" },
    "2",
  );
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-unknown-receipt-host",
    }, unknownReceiptHostAuthorization),
    /continuity_trusted_core_closure_receipt_required/,
  );

  const wrongLogicalSessionAuthorization = redigestAuthorization(
    authorization,
    { host_session_fingerprint: "6".repeat(64) },
    "3",
  );
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-wrong-logical-session",
    }, wrongLogicalSessionAuthorization),
    /continuity_trusted_core_closure_receipt_required/,
  );

  identity.agentPresence.transport_bound = false;
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-cross-host-unbound-transport",
    }, authorization),
    /continuity_host_policy_scope_mismatch/,
  );
  identity.agentPresence.transport_bound = true;

  planRow.plan.coordinator_session_fingerprint = "e".repeat(64);
  planRow.plan_digest = digest(planRow.plan);
  await assert.rejects(
    runtime.finalizeClosure(identity, {
      ...baseFinalize,
      idempotency_key: "closure-finalize-cross-host-wrong-session",
    }, authorization),
    /continuity_host_policy_scope_mismatch/,
  );

  planRow.plan.coordinator_session_fingerprint =
    identity.agentPresence.host_transport_session_fingerprint;
  planRow.plan_digest = digest(planRow.plan);
  assert.notEqual(
    planRow.plan.coordinator_session_fingerprint,
    authorization.host_session_fingerprint,
  );
  const crossHostAuthorization = redigestAuthorization(authorization, {
    verification_scope: "full_release",
    services_verified: true,
    live_services: [{
      service_id: "srv-core-mcp",
      environment: "production",
      live_commit: liveCommit,
      health_status: "healthy",
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      rollback_commit: "a".repeat(40),
      rollback_status: "previous_live_attested",
      readback_digest: "8".repeat(64),
    }],
  }, "1");
  const finalized = await runtime.finalizeClosure(identity, {
    ...baseFinalize,
    idempotency_key: "closure-finalize-cross-host",
  }, crossHostAuthorization);
  assert.equal(finalized.completed, true);
  assert.equal(finalized.final_receipt.host_type, "codex_native");
  assert.equal(planRow.plan.host_type, "chatgpt_native");
  assert.equal(pool.works.get(key("tenant-a", work.work_id)).status, "completed");
  assert.equal(planRow.status, "closed");
});

test("continuity runtime exposes no parallel delegation authority", () => {
  const pool = new ContinuityPool();
  const runtime = createWorkContinuityRuntime({}, { pool });
  assert.equal(runtime.issueDelegation, undefined);
  assert.equal(runtime.consumeDelegation, undefined);
  assert.equal(runtime.revokeDelegation, undefined);
  assert.doesNotMatch(runtime.schemaSql, /core_continuity_delegations/);
});
