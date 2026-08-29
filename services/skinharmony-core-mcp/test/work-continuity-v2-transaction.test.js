import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createWorkContinuityV2Store,
  deriveAuthenticatedTenantWorkAcl,
} from "../src/work-continuity-v2-store.js";

function key(...parts) { return parts.join("\0"); }
function cloneMap(map) { return new Map([...map].map(([k, v]) => [k, structuredClone(v)])); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function stableDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

class AtomicWorkPool {
  constructor() {
    this.reviews = new Map();
    this.bootstrapRequests = new Map();
    this.legacy = new Map();
    this.works = new Map();
    this.tasks = new Map();
    this.events = new Map();
    this.reports = new Map();
    this.sequences = new Map();
    this.participants = new Map();
    this.leases = new Map();
    this.queries = [];
    this.queryParameters = [];
    this.databaseNow = "2026-08-08T10:00:00.000Z";
  }

  snapshot() {
    return Object.fromEntries(["reviews", "bootstrapRequests", "legacy", "works", "tasks", "events", "reports", "sequences", "participants", "leases"]
      .map((name) => [name, cloneMap(this[name])]));
  }

  restore(snapshot) {
    for (const [name, value] of Object.entries(snapshot)) this[name] = value;
  }

  async connect() {
    const pool = this;
    let snapshot = null;
    return {
      async query(sql, parameters = []) {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN") { snapshot = pool.snapshot(); return { rows: [], rowCount: 0 }; }
        if (normalized === "COMMIT") { snapshot = null; return { rows: [], rowCount: 0 }; }
        if (normalized === "ROLLBACK") { if (snapshot) pool.restore(snapshot); snapshot = null; return { rows: [], rowCount: 0 }; }
        return pool.query(sql, parameters);
      },
      insertLegacy(identity, input) {
        const workKey = key(identity.tenantId, input.work_id);
        const existing = pool.legacy.get(workKey);
        if (existing) return existing;
        const row = {
          tenant_id: identity.tenantId, work_id: input.work_id, project_id: input.project_id,
          parent_work_id: input.parent_work_id || null, idea: input.idea, objective: input.objective,
          status: "active", next_action: input.next_action, created_at: "2026-08-08T10:00:00.000Z",
          updated_at: "2026-08-08T10:00:00.000Z", intent_digest: input.intent_digest || "a".repeat(64),
        };
        pool.legacy.set(workKey, row);
        return row;
      },
      release() {},
    };
  }

  async query(sql, parameters = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    this.queries.push(q);
    this.queryParameters.push({ sql: q, parameters: structuredClone(parameters) });
    if (q.includes("CREATE TABLE IF NOT EXISTS tenant_work")) return { rows: [], rowCount: 0 };
    if (q.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
    if (q.startsWith("SELECT checked_at,") && q.includes("clock_timestamp()")) {
      const checkedAt = new Date(this.databaseNow);
      return { rows: [{
        checked_at: checkedAt.toISOString(),
        authorization_current: checkedAt.getTime() < Date.parse(parameters[0]),
      }], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_bootstrap_request")) {
      const [tenantId, subjectUserId, requestId, requestDigest, reviewId, consumedWorkId = null] = parameters;
      const requestKey = key(tenantId, subjectUserId, requestId);
      if (this.bootstrapRequests.has(requestKey)) return { rows: [], rowCount: 0 };
      if ([...this.bootstrapRequests.values()].some((row) =>
        row.tenant_id === tenantId && row.review_id === reviewId)) {
        throw new Error("tenant_work_bootstrap_request_review_id_key");
      }
      const row = { tenant_id: tenantId, subject_user_id: subjectUserId, request_id: requestId,
        request_digest: requestDigest, review_id: reviewId, consumed_work_id: consumedWorkId,
        created_at: "2026-08-08T10:00:00.000Z", updated_at: "2026-08-08T10:00:00.000Z" };
      this.bootstrapRequests.set(requestKey, row);
      return { rows: q.includes("RETURNING *") ? [structuredClone(row)] : [], rowCount: 1 };
    }
    if (q.startsWith("SELECT * FROM tenant_work_bootstrap_request")) {
      const row = this.bootstrapRequests.get(key(parameters[0], parameters[1], parameters[2]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("UPDATE tenant_work_bootstrap_request SET review_id")) {
      const row = this.bootstrapRequests.get(key(parameters[0], parameters[1], parameters[2]));
      if (!row || row.request_digest !== parameters[5]) return { rows: [], rowCount: 0 };
      row.review_id = parameters[3];
      row.consumed_work_id = parameters[4];
      row.updated_at = "2026-08-08T10:00:01.000Z";
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (q.startsWith("UPDATE tenant_work_bootstrap_request SET consumed_work_id")) {
      const row = this.bootstrapRequests.get(key(parameters[0], parameters[1], parameters[2]));
      if (!row || row.consumed_work_id || row.request_digest !== parameters[4] || row.review_id !== parameters[5]) {
        return { rows: [], rowCount: 0 };
      }
      row.consumed_work_id = parameters[3];
      row.updated_at = "2026-08-08T10:00:01.000Z";
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (q.startsWith("SELECT * FROM tenant_work_open_review") && q.includes("subject_user_id=$2")) {
      const rows = [...this.reviews.values()].filter((review) =>
        review.tenant_id === parameters[0] && review.subject_user_id === parameters[1] &&
        review.request_id === parameters[2]);
      rows.sort((left, right) => Number(Boolean(right.consumed_work_id)) - Number(Boolean(left.consumed_work_id)) ||
        String(right.consumed_at || "").localeCompare(String(left.consumed_at || "")) ||
        String(left.created_at || "").localeCompare(String(right.created_at || "")));
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT * FROM tenant_work_open_review")) {
      const row = this.reviews.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO tenant_work_open_review")) {
      const [tenantId, reviewId, subjectUserId, requestId, projectId, intentDigest, requestDigest,
        reviewDigest, reviewResult, decisionRequired, expiresAt] = parameters;
      const row = { tenant_id: tenantId, review_id: reviewId, subject_user_id: subjectUserId,
        request_id: requestId, project_id: projectId, intent_digest: intentDigest,
        request_digest: requestDigest, review_digest: reviewDigest, review_result: JSON.parse(reviewResult),
        decision_required: decisionRequired, expires_at: expiresAt, consumed_at: null,
        consumed_by_user_id: null, decision: null, decision_digest: null, consumed_work_id: null,
        created_at: "2026-08-08T10:00:00.000Z" };
      this.reviews.set(key(tenantId, reviewId), row);
      return { rows: q.includes("RETURNING *") ? [structuredClone(row)] : [], rowCount: 1 };
    }
    if (q.startsWith("UPDATE tenant_work_open_review SET")) {
      const row = this.reviews.get(key(parameters[0], parameters[1]));
      if (!row || row.consumed_at) return { rows: [], rowCount: 0 };
      Object.assign(row, { consumed_at: "2026-08-08T10:00:01.000Z", consumed_by_user_id: parameters[2],
        decision: parameters[3], decision_digest: parameters[4], consumed_work_id: parameters[5] });
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_code_sequence")) {
      const sequenceKey = key(parameters[0], parameters[1], "20260808");
      const sequence = (this.sequences.get(sequenceKey) || 0) + 1;
      this.sequences.set(sequenceKey, sequence);
      return { rows: [{ day: "20260808", sequence }], rowCount: 1 };
    }
    if (q.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND legacy_work_id=$2")) {
      const row = [...this.works.values()].find((work) => work.tenant_id === parameters[0] && work.legacy_work_id === parameters[1]);
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND (legacy_work_id=$2 OR work_id=$2)")) {
      const row = [...this.works.values()].find((work) => work.tenant_id === parameters[0] &&
        (work.legacy_work_id === parameters[1] || work.work_id === parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT legacy_projection_sequence FROM tenant_work")) {
      const row = [...this.works.values()].find((work) => work.tenant_id === parameters[0] &&
        (work.legacy_work_id === parameters[1] || work.work_id === parameters[1]));
      return { rows: row ? [{ legacy_projection_sequence: row.legacy_projection_sequence || 0 }] : [],
        rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT w.project_id,w.status,a.anchor,a.intent_digest")) {
      const row = this.legacy.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone({ project_id: row.project_id, status: row.status,
        anchor: row.anchor || null, intent_digest: row.intent_digest || null })] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO tenant_work ")) {
      let row;
      if (parameters.length === 25) {
        const [tenantId, workId, legacyWorkId, workCode, workName, workType, projectId, ownerUserId,
          teamId, assigned, supervising, agents, visibility, priority, priorityScore, priorityVersion,
          priorityContext, intentDigest, objective, nextAction, agentId, sessionFingerprint, criteria,
          idea, architecture] = parameters;
        row = { tenant_id: tenantId, work_id: workId, legacy_work_id: legacyWorkId, work_code: workCode,
          work_name: workName, work_type: workType, project_id: projectId, owner_user_id: ownerUserId,
          created_by_user_id: ownerUserId, team_id: teamId, assigned_user_ids: JSON.parse(assigned),
          supervising_user_ids: JSON.parse(supervising), agent_ids: JSON.parse(agents), visibility_scope: visibility,
          status: q.includes("'PLANNED'") ? "PLANNED" : "ACTIVE",
          priority, priority_score: priorityScore, priority_version: priorityVersion,
          priority_context: JSON.parse(priorityContext), intent_digest: intentDigest, objective, next_action: nextAction,
          created_by_agent_id: agentId, created_by_session_fingerprint: sessionFingerprint,
          acceptance_criteria: JSON.parse(criteria), idea, architecture: JSON.parse(architecture),
          progress_bp: 0, created_at: "2026-08-08T10:00:00.000Z",
          updated_at: "2026-08-08T10:00:00.000Z" };
      } else {
        const [tenantId, workId, workCode, workName, projectId, createdAt, updatedAt, status,
          objective, nextAction, parentWorkId, projectionSequence, projectionEventHash,
          projectionUpdatedAt] = parameters;
        row = { tenant_id: tenantId, work_id: workId, legacy_work_id: workId, work_code: workCode,
          work_name: workName, work_type: "legacy", project_id: projectId, owner_user_id: null,
          created_by_user_id: null, assigned_user_ids: [], supervising_user_ids: [], agent_ids: [],
          visibility_scope: "private", created_at: createdAt, started_at: createdAt, updated_at: updatedAt,
          status, objective, next_action: nextAction, parent_work_id: parentWorkId, progress_bp: 0,
          priority: "P4", priority_score: 0, legacy_projection_sequence: projectionSequence,
          legacy_projection_event_hash: projectionEventHash,
          legacy_projection_updated_at: projectionUpdatedAt };
      }
      this.works.set(key(row.tenant_id, row.work_id), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("UPDATE tenant_work SET project_id=$3")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      if (!row) return { rows: [], rowCount: 0 };
      Object.assign(row, { project_id: parameters[2], parent_work_id: parameters[3],
        work_name: parameters[4], objective: parameters[5], next_action: parameters[6],
        status: parameters[7], updated_at: parameters[8], legacy_projection_sequence: parameters[9],
        legacy_projection_event_hash: parameters[10], legacy_projection_updated_at: parameters[11] });
      if (parameters[12].includes(row.status)) {
        row.closed_at ||= parameters[8];
        row.archived_at ||= parameters[8];
      }
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (q.startsWith("UPDATE tenant_work SET work_name=$3,work_type=$4")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      if (!row) return { rows: [], rowCount: 0 };
      Object.assign(row, {
        work_name: parameters[2], work_type: parameters[3], project_id: parameters[4],
        owner_user_id: parameters[5], created_by_user_id: parameters[5], team_id: parameters[6],
        assigned_user_ids: JSON.parse(parameters[7]), supervising_user_ids: JSON.parse(parameters[8]),
        agent_ids: JSON.parse(parameters[9]), visibility_scope: parameters[10], priority: parameters[11],
        priority_score: parameters[12], priority_version: parameters[13], priority_context: JSON.parse(parameters[14]),
        intent_digest: parameters[15], objective: parameters[16], next_action: parameters[17],
        created_by_agent_id: parameters[18], created_by_session_fingerprint: parameters[19],
        acceptance_criteria: JSON.parse(parameters[20]), idea: parameters[21], architecture: JSON.parse(parameters[22]),
      });
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (q.startsWith("UPDATE tenant_work SET legacy_projection_sequence=$3")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      if (!row || row.legacy_work_id !== parameters[1]) return { rows: [], rowCount: 0 };
      Object.assign(row, {
        legacy_projection_sequence: parameters[2],
        legacy_projection_event_hash: parameters[3],
        legacy_projection_updated_at: "2026-08-08T10:00:02.000Z",
        updated_at: "2026-08-08T10:00:02.000Z",
      });
      return { rows: [{ work_id: row.work_id }], rowCount: 1 };
    }
    if (q.startsWith("UPDATE tenant_work SET assignment_target_agent_id=$3")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      if (!row || row.status !== parameters[4]) return { rows: [], rowCount: 0 };
      Object.assign(row, {
        assignment_target_agent_id: parameters[2],
        assignment_target_client_type: parameters[3],
        assignment_status: "OFFERED",
        assignment_offered_at: "2026-08-08T10:00:02.000Z",
        assignment_accepted_at: null,
      });
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (q.startsWith("UPDATE tenant_work SET agent_ids=$3::jsonb,assignment_status='ACCEPTED'")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      if (!row || row.assignment_status !== "OFFERED" ||
          row.assignment_target_agent_id !== parameters[3] ||
          row.assignment_target_client_type !== parameters[4]) return { rows: [], rowCount: 0 };
      Object.assign(row, {
        agent_ids: JSON.parse(parameters[2]),
        assignment_status: "ACCEPTED",
        assignment_accepted_at: "2026-08-08T10:00:03.000Z",
      });
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (q.startsWith("UPDATE tenant_work SET status='ARCHIVED'")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      if (!row || row.status !== parameters[4]) return { rows: [], rowCount: 0 };
      Object.assign(row, {
        status: "ARCHIVED",
        archived_at: "2026-08-08T10:00:02.000Z",
        archived_from_status: parameters[2],
        archived_reason: parameters[3],
        assignment_status: "REVOKED",
        updated_at: "2026-08-08T10:00:02.000Z",
      });
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (q.startsWith("UPDATE tenant_work SET status='PLANNED'")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      if (!row || row.status !== "ARCHIVED") return { rows: [], rowCount: 0 };
      Object.assign(row, {
        status: "PLANNED",
        archived_at: null,
        archived_from_status: null,
        archived_reason: null,
        assignment_target_agent_id: null,
        assignment_target_client_type: null,
        assignment_status: null,
        assignment_offered_at: null,
        assignment_accepted_at: null,
        reopened_at: "2026-08-08T10:00:03.000Z",
        reopen_count: Number(row.reopen_count || 0) + 1,
        next_action: parameters[2],
        updated_at: "2026-08-08T10:00:03.000Z",
      });
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_leases SET status='released'")) {
      return { rows: [], rowCount: 0 };
    }
    if (q.startsWith("INSERT INTO tenant_work_task")) {
      const row = { tenant_id: parameters[0], task_id: parameters[1], work_id: parameters[2],
        title: parameters[3], weight: parameters[4], status: "planned", required: parameters[5], acceptance_verified: false };
      this.tasks.set(key(row.tenant_id, row.task_id), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT tenant_id,work_id,sequence_number,event_type,payload,") &&
        q.includes("open_work_review_consumed") && q.includes("work_v2_created")) {
      const rows = [...this.events.values()].filter((event) =>
        event.tenant_id === parameters[0] && event.work_id === parameters[1] &&
        ["open_work_review_consumed", "work_v2_created"].includes(event.event_type))
        .sort((left, right) => left.sequence_number - right.sequence_number);
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT tenant_id,work_id,sequence_number,event_type,payload,") &&
        q.includes("event_type='work_archived_v3'") && q.includes("idempotency_key_digest")) {
      const row = [...this.events.values()]
        .filter((event) => event.tenant_id === parameters[0] && event.work_id === parameters[1] &&
          event.event_type === "work_archived_v3" && event.payload?.idempotency_key_digest === parameters[2])
        .sort((left, right) => right.sequence_number - left.sequence_number)[0];
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT sequence_number,event_hash FROM tenant_work_event")) {
      const rows = [...this.events.values()].filter((event) => event.tenant_id === parameters[0] && event.work_id === parameters[1])
        .sort((a, b) => a.sequence_number - b.sequence_number);
      return { rows: rows.length ? [structuredClone(rows.at(-1))] : [], rowCount: rows.length ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO tenant_work_event")) {
      const row = { tenant_id: parameters[0], work_id: parameters[1], event_id: parameters[2],
        sequence_number: parameters[3], event_type: parameters[4], payload: JSON.parse(parameters[5]),
        previous_event_hash: parameters[6], event_hash: parameters[7], created_by_user_id: parameters[8] };
      this.events.set(key(row.tenant_id, row.event_id), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND status = ANY")) {
      const rows = [...this.works.values()].filter((work) => work.tenant_id === parameters[0] && parameters[1].includes(work.status));
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 ORDER BY") ||
        q.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND project_id=")) {
      const rows = [...this.works.values()].filter((work) => work.tenant_id === parameters[0] &&
        (parameters.length === 1 || work.project_id === parameters[1]));
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT w.work_id,w.project_id,w.parent_work_id")) {
      const rows = [...this.legacy.values()].filter((work) => work.tenant_id === parameters[0] &&
        (!parameters[1] || work.project_id === parameters[1]))
        .slice(0, parameters[2]);
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT work_id,project_id,parent_work_id,idea")) {
      const row = this.legacy.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT count(DISTINCT p.session_id)")) {
      return { rows: [{ active_participants: 0, active_leases: 0, active_branches: 0 }], rowCount: 1 };
    }
    if (q.startsWith("SELECT work_id,report_digest,created_at")) {
      const rows = parameters[1].flatMap((workId) => {
        const row = this.reports.get(key(parameters[0], workId));
        return row ? [structuredClone(row)] : [];
      });
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("SELECT status,expires_at FROM core_continuity_participants")) return { rows: [], rowCount: 0 };
    if (q.startsWith("SELECT status,expires_at FROM core_continuity_leases")) return { rows: [], rowCount: 0 };
    throw new Error(`fake_query_unhandled:${q}`);
  }
}

function identity(subject = "owner", role = "tenant_owner") {
  const base = { tenantId: "tenant-a", subject, userId: subject,
    agentPresence: { agent_id: `agent-${subject}`, session_fingerprint: "f".repeat(64) },
    authenticatedTenantMembership: { schema_version: "tenant_membership_binding_v1", authenticated: true,
      tenant_id: "tenant-a", subject, role, expires_at: "2030-01-01T00:00:00.000Z",
      team_ids: [], managed_team_ids: role === "team_manager" ? ["team-a"] : [], assigned_work_ids: [] } };
  return { ...base, tenant_work_acl: deriveAuthenticatedTenantWorkAcl(base, Date.parse("2026-08-08T10:00:00.000Z")) };
}

function createInput() {
  return { intent_type: "CREATE_WORK", request_id: "request-001", project_id: "nyra-core",
    session_id: "session-001", work_name: "Continuity transaction", work_type: "generic",
    idea: "Atomic work", objective: "Create legacy and V2 atomically", architecture: {},
    next_action: "run tests", visibility_scope: "private", acceptance_criteria: ["atomic"],
    tasks: [{ title: "transaction", weight: 1, required: true }], intent_digest: "a".repeat(64) };
}

function boundedUniqueText(prefix, index, length) {
  const marker = `${prefix}-${String(index).padStart(3, "0")}-`;
  return `${marker}${"x".repeat(length - marker.length)}`;
}

function legacyRuntime(pool) {
  return { initialize: async () => {}, ensureWithClient: async (client, who, input) => {
    const row = client.insertLegacy(who, input);
    return { work_id: row.work_id, intent_digest: row.intent_digest,
      event: { event_hash: "b".repeat(64) } };
  } };
}

function bridgeLegacyRuntime(pool, calls) {
  return { initialize: async () => {}, ensureWithClient: async (client, who, input) => {
    calls.push(structuredClone(input));
    const row = client.insertLegacy(who, input);
    const anchor = {
      schema_version: "intent_anchor_v1",
      initial_message: input.initial_message,
      idea: input.idea,
      objective: input.objective,
      acceptance_criteria: input.acceptance_criteria,
      constraints: input.constraints,
      source: { client_type: input.client_type, session_id: input.session_id },
      immutable: true,
    };
    row.anchor = anchor;
    row.intent_digest = stableDigest(anchor);
    return { work_id: row.work_id, intent_digest: row.intent_digest,
      event: { sequence_number: 1, event_hash: "a".repeat(64) },
      intent_event: { sequence_number: 2, event_hash: "b".repeat(64) } };
  } };
}

function legacyRuntimeWithConcurrentProjection(pool) {
  return { initialize: async () => {}, ensureWithClient: async (client, who, input) => {
    const row = client.insertLegacy(who, input);
    // Mirrors the compatibility projector racing immediately after legacy
    // creation, before the V2 coordinator reaches its insert.
    if (!pool.works.has(key(who.tenantId, input.work_id))) {
      pool.works.set(key(who.tenantId, input.work_id), {
        tenant_id: who.tenantId, work_id: input.work_id, legacy_work_id: input.work_id,
        work_code: "NYRA-20260808-0001", work_name: input.idea, work_type: "legacy",
        project_id: input.project_id, owner_user_id: null, created_by_user_id: null,
        assigned_user_ids: [], supervising_user_ids: [], agent_ids: [], visibility_scope: "private",
        status: "ACTIVE", priority: "P4", priority_score: 0, intent_digest: null,
        objective: input.objective, next_action: input.next_action, acceptance_criteria: [], progress_bp: 0,
        legacy_projection_sequence: 2, legacy_projection_event_hash: "c".repeat(64),
        legacy_projection_updated_at: "2026-08-08T10:00:00.000Z",
      });
    }
    return { work_id: row.work_id, intent_digest: row.intent_digest,
      event: { event_hash: "b".repeat(64) } };
  } };
}

async function reviewed(store, input) {
  const review = await store.openWorkReview(identity(), { intent_type: "CREATE_WORK",
    request: `${input.work_name} ${input.objective}`, create_request: input });
  return { ...input, review_id: review.review_id, review_digest: review.review_digest };
}

function coreAuthorizationReceipt() {
  const coreMaterial = {
    schema_version: "core_action_authorization_receipt_v1",
    authority: "universal_core",
    authorization_id: `cae_${"1".repeat(40)}`,
    tenant_id: "tenant-a",
    action_type: "work.continuity.v2.create",
    idempotency_key_digest: "2".repeat(64),
    request_digest: "3".repeat(64),
    response_digest: "4".repeat(64),
    issued_at: "2026-08-08T09:59:00.000Z",
    expires_at: "2026-08-08T10:01:00.000Z",
  };
  const coreReceipt = { ...coreMaterial, receipt_digest: stableDigest(coreMaterial) };
  const material = {
    schema_version: "work_bootstrap_core_authorization_receipt_v2",
    authority: "universal_core",
    route: "/v1/action-evaluator",
    target: `work_bootstrap:create:chatgpt_prod:chatgpt_native:${"a".repeat(64)}`,
    decision_id: coreReceipt.authorization_id,
    decision: "allow",
    mediation: "allow",
    owner_confirmation_required: true,
    confirmation_satisfied: true,
    core_authorization_receipt: coreReceipt,
  };
  return { ...material, receipt_digest: stableDigest(material) };
}

test("V2 store accepts exact shared bootstrap text boundaries", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:00:00.000Z"),
  });
  const acceptanceCriteria = Array.from({ length: 250 }, (_, index) =>
    boundedUniqueText("acceptance", index, 2_000));
  const constraints = Array.from({ length: 100 }, (_, index) =>
    boundedUniqueText("constraint", index, 1_000));
  const created = await store.createWork(identity(), {
    ...createInput(),
    acceptance_criteria: acceptanceCriteria,
    constraints,
  });
  assert.equal(created.acceptance_criteria.length, 250);
  assert.equal(created.acceptance_criteria.at(-1).length, 2_000);
  assert.equal(pool.works.size, 1);
});

test("V2 store rejects acceptance and constraint count or item-length overflow", async () => {
  const acceptanceCriteria = Array.from({ length: 250 }, (_, index) =>
    boundedUniqueText("acceptance", index, 2_000));
  const constraints = Array.from({ length: 100 }, (_, index) =>
    boundedUniqueText("constraint", index, 1_000));
  const negativeCases = [
    [{ acceptance_criteria: [...acceptanceCriteria, "overflow"] }, /acceptance_criteria_invalid/],
    [{ acceptance_criteria: ["x".repeat(2_001)] }, /acceptance_criteria_invalid/],
    [{ constraints: [...constraints, "overflow"] }, /constraints_invalid/],
    [{ constraints: ["x".repeat(1_001)] }, /constraints_invalid/],
  ];
  for (const [override, expected] of negativeCases) {
    const pool = new AtomicWorkPool();
    const store = createWorkContinuityV2Store({
      pool,
      now: () => new Date("2026-08-08T10:00:00.000Z"),
    });
    const invalidInput = { ...createInput(), ...override };
    await assert.rejects(store.openWorkReview(identity(), {
      intent_type: "CREATE_WORK",
      request: invalidInput.objective,
      create_request: invalidInput,
    }), expected);
    assert.equal(pool.bootstrapRequests.size, 0);
    assert.equal(pool.reviews.size, 0);
    await assert.rejects(store.createWork(identity(), {
      ...invalidInput,
    }), expected);
    assert.equal(pool.works.size, 0);
  }
});

for (const phase of ["review_consumed", "legacy_created", "v2_work_created", "v2_tasks_created", "v2_events_created"]) {
  test(`coordinated create rolls back every durable phase after ${phase}`, async () => {
    const pool = new AtomicWorkPool();
    const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
      now: () => new Date("2026-08-08T10:00:00.000Z"),
      failureInjector: (current) => { if (current === phase) throw new Error(`injected_${phase}`); } });
    const input = await reviewed(store, createInput());
    await assert.rejects(store.createNewWork(identity(), input), new RegExp(`injected_${phase}`));
    assert.equal(pool.legacy.size, 0);
    assert.equal(pool.works.size, 0);
    assert.equal(pool.tasks.size, 0);
    assert.equal(pool.events.size, 0);
    assert.equal(pool.reviews.get(key("tenant-a", input.review_id)).consumed_at, null);
  });
}

test("exact retry converges on one linked legacy/V2 identity and one consumed review", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = await reviewed(store, createInput());
  pool.queries.length = 0;
  const first = await store.createNewWork(identity(), input);
  const replay = await store.createNewWork(identity(), input);
  assert.equal(first.work.work_id, replay.work.work_id);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(pool.legacy.size, 1);
  assert.equal(pool.works.size, 1);
  assert.equal(pool.tasks.size, 1);
  assert.equal(pool.events.size, 2);
  assert.equal(pool.reviews.get(key("tenant-a", input.review_id)).consumed_work_id, first.work.work_id);
  assert.equal(pool.bootstrapRequests.get(key("tenant-a", "owner", input.request_id)).consumed_work_id,
    first.work.work_id);
  const bindingLock = pool.queries.findIndex((query) =>
    query.startsWith("SELECT * FROM tenant_work_bootstrap_request"));
  const reviewLock = pool.queries.findIndex((query) =>
    query.startsWith("SELECT * FROM tenant_work_open_review"));
  assert.ok(bindingLock >= 0 && reviewLock > bindingLock,
    "create must lock the durable request mapping before its review");
});

test("owner reconstructs a missing legacy bridge from retained V2 fields exactly once", async () => {
  const pool = new AtomicWorkPool();
  const workId = "11111111-1111-4111-8111-111111111111";
  pool.works.set(key("tenant-a", workId), {
    tenant_id: "tenant-a", work_id: workId, legacy_work_id: workId,
    work_code: "NYRA-20260808-0001", work_name: "Canonical V2 work", work_type: "software_git",
    project_id: "nyra-core", owner_user_id: "owner", created_by_user_id: "owner",
    assigned_user_ids: [], supervising_user_ids: [], agent_ids: [], visibility_scope: "private",
    status: "ACTIVE", priority: "P4", priority_score: 0, intent_digest: "c".repeat(64),
    objective: "Restore the missing bridge without changing the V2 identity.",
    next_action: "Plan the verifier", acceptance_criteria: ["Bridge is tenant-bound and idempotent."],
    idea: null, architecture: { bounded: true }, progress_bp: 0,
    legacy_projection_sequence: 2, legacy_projection_event_hash: "d".repeat(64),
  });
  const calls = [];
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: bridgeLegacyRuntime(pool, calls),
    now: () => new Date("2026-08-08T10:00:00.000Z") });

  const first = await store.ensureLegacyBridge(identity(), {
    work_id: workId,
    project_id: "client-controlled-tenant-must-not-be-read",
  });
  const replay = await store.ensureLegacyBridge(identity(), { work_id: workId });

  assert.equal(first.state, "reconstructed");
  assert.equal(first.execution_authorized, false);
  assert.equal(replay.state, "already_linked");
  assert.equal(replay.idempotent_replay, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].project_id, "nyra-core");
  assert.equal(calls[0].objective, "Restore the missing bridge without changing the V2 identity.");
  assert.deepEqual(calls[0].acceptance_criteria, ["Bridge is tenant-bound and idempotent."]);
  assert.deepEqual(calls[0].architecture, { bounded: true });
  assert.match(calls[0].session_id, /^v2bridge-[a-f0-9]{48}$/);
  assert.equal(pool.works.get(key("tenant-a", workId)).legacy_projection_event_hash, "b".repeat(64));
  assert.equal(pool.events.size, 1);
});

test("legacy bridge repair fails closed for a non-owner or an inconsistent V2 link", async () => {
  const workId = "11111111-1111-4111-8111-111111111111";
  const makeStore = () => {
    const pool = new AtomicWorkPool();
    pool.works.set(key("tenant-a", workId), {
      tenant_id: "tenant-a", work_id: workId, legacy_work_id: workId,
      work_code: "NYRA-20260808-0001", work_name: "Canonical V2 work", work_type: "software_git",
      project_id: "nyra-core", owner_user_id: "owner", created_by_user_id: "owner",
      assigned_user_ids: [], supervising_user_ids: [], agent_ids: [], visibility_scope: "private",
      status: "ACTIVE", priority: "P4", priority_score: 0, intent_digest: "c".repeat(64),
      objective: "Restore safely.", next_action: "Plan the verifier", acceptance_criteria: ["bounded"],
      idea: null, architecture: {}, progress_bp: 0,
    });
    return { pool, store: createWorkContinuityV2Store({ pool, legacyRuntime: bridgeLegacyRuntime(pool, []),
      now: () => new Date("2026-08-08T10:00:00.000Z") }) };
  };
  {
    const { store } = makeStore();
    await assert.rejects(store.ensureLegacyBridge(identity("member", "member"), { work_id: workId }),
      /legacy_bridge_owner_required/);
  }
  {
    const { pool, store } = makeStore();
    pool.works.get(key("tenant-a", workId)).legacy_work_id = "22222222-2222-4222-8222-222222222222";
    await assert.rejects(store.ensureLegacyBridge(identity(), { work_id: workId }), /legacy_bridge_identity_mismatch/);
  }
  {
    const { pool, store } = makeStore();
    pool.legacy.set(key("tenant-a", workId), {
      tenant_id: "tenant-a", work_id: workId, project_id: "nyra-core", status: "active",
      intent_digest: "d".repeat(64), anchor: null,
    });
    await assert.rejects(store.ensureLegacyBridge(identity(), { work_id: workId }),
      /legacy_bridge_existing_state_invalid/);
  }
});

test("request identity survives replica restart and consumed-review expiry without minting a duplicate", async () => {
  const pool = new AtomicWorkPool();
  let current = new Date("2026-08-08T10:00:00.000Z");
  const options = { pool, legacyRuntime: legacyRuntime(pool), now: () => current };
  const firstStore = createWorkContinuityV2Store(options);
  const request = createInput();
  const reviewedInput = await reviewed(firstStore, request);
  const first = await firstStore.createNewWork(identity(), reviewedInput);

  current = new Date("2026-08-08T10:20:00.000Z");
  const restartedStore = createWorkContinuityV2Store(options);
  const reopened = await restartedStore.openWorkReview(identity(), {
    intent_type: "CREATE_WORK",
    request: `${request.work_name} ${request.objective}`,
    create_request: request,
  });
  assert.equal(reopened.review_id, reviewedInput.review_id);
  assert.equal(reopened.review_digest, reviewedInput.review_digest);
  assert.equal(reopened.consumed, true);
  assert.equal(reopened.consumed_work_id, first.work.work_id);
  assert.equal(reopened.idempotent_replay, true);

  const replay = await restartedStore.createNewWork(identity(), {
    ...request,
    review_id: reopened.review_id,
    review_digest: reopened.review_digest,
  });
  assert.equal(replay.work.work_id, first.work.work_id);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(pool.works.size, 1);
  assert.equal(pool.legacy.size, 1);
  assert.equal(pool.reviews.size, 1);
  assert.equal(pool.bootstrapRequests.size, 1);
});

test("one request id cannot be rebound to a changed Work specification", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const request = createInput();
  await store.openWorkReview(identity(), {
    intent_type: "CREATE_WORK", request: request.objective, create_request: request,
  });
  await assert.rejects(store.openWorkReview(identity(), {
    intent_type: "CREATE_WORK",
    request: "changed objective",
    create_request: { ...request, objective: "materially changed objective" },
  }), /open_work_review_idempotency_conflict/);
  assert.equal(pool.reviews.size, 1);
  assert.equal(pool.bootstrapRequests.size, 1);
});

test("create fails closed when ambiguous legacy reviews have no durable request binding", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = await reviewed(store, createInput());
  pool.bootstrapRequests.clear();
  const original = pool.reviews.get(key("tenant-a", input.review_id));
  const conflictingReviewId = "99999999-9999-4999-8999-999999999999";
  pool.reviews.set(key("tenant-a", conflictingReviewId), {
    ...structuredClone(original),
    review_id: conflictingReviewId,
    review_digest: "f".repeat(64),
    request_digest: "e".repeat(64),
    consumed_work_id: "88888888-8888-4888-8888-888888888888",
    consumed_at: "2026-08-08T09:59:00.000Z",
  });

  await assert.rejects(
    store.createNewWork(identity(), input),
    /open_work_review_request_binding_invalid/,
  );
  assert.equal(pool.bootstrapRequests.size, 0);
  assert.equal(pool.works.size, 0);
  assert.equal(pool.legacy.size, 0);
});

test("persists the bounded Universal Core creation receipt in the Work event ledger", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = await reviewed(store, createInput());
  const receipt = coreAuthorizationReceipt();
  const created = await store.createNewWork(identity(), {
    ...input,
    _core_authorization_receipt: receipt,
  });
  const createdEvent = [...pool.events.values()].find((event) =>
    event.event_type === "work_v2_created");

  assert.deepEqual(created.core_authorization_receipt, receipt);
  assert.deepEqual(createdEvent.payload.core_authorization_receipt, receipt);
  const replay = await store.createNewWork(identity(), {
    ...input,
    _core_authorization_receipt: receipt,
  });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.core_authorization_receipt, null);
  assert.deepEqual(createdEvent.payload.core_authorization_receipt, receipt);
  pool.databaseNow = "2026-08-08T10:05:00.000Z";
  const durableReadback = await store.readCreatedWorkByBootstrapRequest(identity(), input);
  assert.equal(durableReadback.work.work_id, created.work.work_id);
  assert.equal(durableReadback.idempotent_replay, true);
  assert.equal(durableReadback.replay_source, "durable_bootstrap_mapping");
  assert.equal(durableReadback.execution_authorized, false);
  assert.equal(durableReadback.core_authorization_receipt, null);
  assert.deepEqual(durableReadback.persisted_core_authorization_receipt, receipt);
  const originalEventHash = createdEvent.event_hash;
  createdEvent.event_hash = "f".repeat(64);
  await assert.rejects(
    store.readCreatedWorkByBootstrapRequest(identity(), input),
    /work_bootstrap_replay_evidence_invalid/,
  );
  createdEvent.event_hash = originalEventHash;
  await assert.rejects(store.createNewWork(identity(), {
    ...input,
    _core_authorization_receipt: { ...receipt, decision: "block" },
  }), /work_bootstrap_core_authorization_receipt_invalid/);
  const malformedCore = { ...receipt.core_authorization_receipt, response_digest: "5".repeat(64) };
  const { receipt_digest: ignoredReceiptDigest, ...receiptMaterial } = receipt;
  void ignoredReceiptDigest;
  const malformedMaterial = { ...receiptMaterial, core_authorization_receipt: malformedCore };
  await assert.rejects(store.createNewWork(identity(), {
    ...input,
    _core_authorization_receipt: {
      ...malformedMaterial,
      receipt_digest: stableDigest(malformedMaterial),
    },
  }), /work_bootstrap_core_authorization_receipt_invalid/);
});

test("late durable bootstrap replay accepts a request that originally omitted intent_digest", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const request = createInput();
  delete request.intent_digest;
  const input = await reviewed(store, request);
  const created = await store.createNewWork(identity(), {
    ...input,
    _core_authorization_receipt: coreAuthorizationReceipt(),
  });

  assert.equal(created.work.intent_digest, "a".repeat(64));
  pool.databaseNow = "2026-08-08T10:05:00.000Z";
  const replay = await store.readCreatedWorkByBootstrapRequest(identity(), input);
  assert.equal(replay.work.work_id, created.work.work_id);
  assert.equal(replay.work.intent_digest, "a".repeat(64));
  assert.equal(replay.replay_source, "durable_bootstrap_mapping");
  assert.equal(replay.execution_authorized, false);
  assert.equal(replay.core_authorization_receipt, null);
});

test("Core receipt expiry is checked with the database clock after lock and before commit", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = await reviewed(store, createInput());
  const coreMaterial = {
    schema_version: "core_action_authorization_receipt_v1",
    authority: "universal_core",
    authorization_id: `cae_${"1".repeat(40)}`,
    tenant_id: "tenant-a",
    action_type: "work.continuity.v2.create",
    idempotency_key_digest: "2".repeat(64),
    request_digest: "3".repeat(64),
    response_digest: "4".repeat(64),
    issued_at: "2026-08-08T09:59:00.000Z",
    expires_at: "2026-08-08T10:01:00.000Z",
  };
  const coreReceipt = { ...coreMaterial, receipt_digest: stableDigest(coreMaterial) };
  const material = {
    schema_version: "work_bootstrap_core_authorization_receipt_v2",
    authority: "universal_core",
    route: "/v1/action-evaluator",
    target: `work_bootstrap:create:chatgpt_prod:chatgpt_native:${"a".repeat(64)}`,
    decision_id: coreReceipt.authorization_id,
    decision: "allow",
    mediation: "allow",
    owner_confirmation_required: true,
    confirmation_satisfied: true,
    core_authorization_receipt: coreReceipt,
  };
  const receipt = { ...material, receipt_digest: stableDigest(material) };

  pool.databaseNow = coreMaterial.expires_at;
  await assert.rejects(store.createNewWork(identity(), {
    ...input,
    _core_authorization_receipt: receipt,
  }), /work_bootstrap_core_authorization_receipt_expired/);
  assert.equal(pool.reviews.get(key("tenant-a", input.review_id)).consumed_at, null);
  assert.equal(pool.legacy.size, 0);
  assert.equal(pool.works.size, 0);

  pool.databaseNow = "2026-08-08T10:00:00.000Z";
  let checks = 0;
  const originalQuery = pool.query.bind(pool);
  pool.query = async (sql, parameters) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("SELECT checked_at,") && normalized.includes("clock_timestamp()")) {
      checks += 1;
      if (checks === 2) pool.databaseNow = coreMaterial.expires_at;
    }
    return originalQuery(sql, parameters);
  };
  await assert.rejects(store.createNewWork(identity(), {
    ...input,
    _core_authorization_receipt: receipt,
  }), /work_bootstrap_core_authorization_receipt_expired/);
  assert.equal(checks, 2);
  assert.equal(pool.reviews.get(key("tenant-a", input.review_id)).consumed_at, null);
  assert.equal(pool.legacy.size, 0);
  assert.equal(pool.works.size, 0);
  assert.equal(pool.events.size, 0);
});

test("review digest rejects material Work specification substitution", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = await reviewed(store, createInput());
  await assert.rejects(
    store.createNewWork(identity(), {
      ...input,
      architecture: { substituted: true },
    }),
    /open_work_review_request_binding_invalid/,
  );
  assert.equal(pool.works.size, 0);
  assert.equal(pool.legacy.size, 0);
  assert.equal(pool.reviews.get(key("tenant-a", input.review_id)).consumed_at, null);
});

test("review digest binds caller-supplied task identities in the canonical task graph", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const taskA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const taskB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const input = await reviewed(store, {
    ...createInput(),
    tasks: [{ task_id: taskA, title: "transaction", weight: 1, required: true }],
  });
  await assert.rejects(store.createNewWork(identity(), {
    ...input,
    tasks: [{ task_id: taskB, title: "transaction", weight: 1, required: true }],
  }), /open_work_review_request_binding_invalid/);
  assert.equal(pool.works.size, 0);
  assert.equal(pool.tasks.size, 0);
  assert.equal(pool.reviews.get(key("tenant-a", input.review_id)).consumed_at, null);
});

test("coordinated create promotes a concurrent legacy projection to the requested V2 identity", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntimeWithConcurrentProjection(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = await reviewed(store, createInput());
  const first = await store.createNewWork(identity(), input);
  const row = pool.works.get(key("tenant-a", first.work.work_id));
  assert.equal(first.work.work_name, input.work_name);
  assert.equal(first.work.work_type, input.work_type);
  assert.equal(first.work.intent_digest, input.intent_digest);
  assert.deepEqual(first.work.acceptance_criteria, input.acceptance_criteria);
  assert.equal(row.legacy_projection_sequence, 2, "the compatibility cursor must remain durable");
  assert.equal(pool.tasks.size, 1);
  Object.assign(pool.legacy.get(key("tenant-a", first.work.work_id)), {
    source_sequence_number: 3, source_event_type: "work_updated", source_event_hash: "d".repeat(64),
    source_event_payload: {},
  });
  await store.preflightGallery(identity(), { project_id: input.project_id });
  assert.equal(pool.works.get(key("tenant-a", first.work.work_id)).work_type, input.work_type,
    "a delayed legacy event must not overwrite the promoted V2 identity");
  const replay = await store.createNewWork(identity(), input);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(pool.tasks.size, 1, "an exact retry must not duplicate DTT tasks");
});

test("significant overlap requires an owner decision and does not consume on denial", async () => {
  const pool = new AtomicWorkPool();
  pool.works.set(key("tenant-a", "11111111-1111-4111-8111-111111111111"), {
    tenant_id: "tenant-a", work_id: "11111111-1111-4111-8111-111111111111", legacy_work_id: null,
    work_code: "NYRA-20260808-0001", work_name: "Continuity transaction", work_type: "generic",
    project_id: "nyra-core", owner_user_id: "owner", created_by_user_id: "owner", assigned_user_ids: [],
    supervising_user_ids: [], agent_ids: [], visibility_scope: "private", status: "ACTIVE", priority: "P1",
    priority_score: 600, progress_bp: 2000, next_action: "continue", updated_at: "2026-08-08T09:00:00.000Z" });
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = await reviewed(store, createInput());
  await assert.rejects(store.createNewWork(identity(), input), /open_work_review_proceed_decision_required/);
  assert.equal(pool.reviews.get(key("tenant-a", input.review_id)).consumed_at, null);
  const created = await store.createNewWork(identity(), { ...input, review_decision: "CONTINUE_NEW_WORK" });
  assert.equal(created.review.decision, "CONTINUE_NEW_WORK");
});

test("Gallery V3 queues, archives, and reopens native Work without restoring execution state", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = await reviewed(store, createInput());

  const queued = await store.queueNewWork(identity(), input);
  assert.equal(queued.work.status, "PLANNED");
  assert.equal(queued.work.legacy_work_id, null);
  assert.equal(queued.work.idea, input.idea);
  assert.deepEqual(queued.work.architecture, input.architecture);
  assert.equal((await store.listWorks(identity(), { view: "operational" })).length, 1);

  const archived = await store.archiveWork(identity(), {
    work_id: queued.work.work_id,
    reason: "In attesa di una decisione di priorità.",
    idempotency_key: "gallery-archive-0001",
  });
  assert.equal(archived.work.status, "ARCHIVED");
  assert.equal(archived.work.archived_from_status, "PLANNED");
  assert.equal(archived.released_lease_count, 0);
  assert.equal(archived.idempotent_replay, false);
  assert.equal((await store.listWorks(identity(), { view: "operational" })).length, 0);
  assert.equal((await store.listWorks(identity(), { view: "archive" }))[0].work_id, queued.work.work_id);

  const reopened = await store.reopenWork(identity(), {
    work_id: queued.work.work_id,
    reason: "La priorità è stata confermata.",
    next_action: "Assegna il Work a Codex per il piano.",
  });
  assert.equal(reopened.work.status, "PLANNED");
  assert.equal(reopened.work.archived_at, null);
  assert.equal(reopened.work.reopen_count, 1);
  assert.equal(reopened.work.next_action, "Assegna il Work a Codex per il piano.");
  assert.deepEqual([...pool.events.values()].map((event) => event.event_type), [
    "work_queued_v3", "work_archived_v3", "work_reopened_v3",
  ]);
});

test("Gallery V3 archive replays one committed archive and rejects key reuse with a different reason", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  const queued = await store.queueNewWork(identity(), await reviewed(store, createInput()));
  const request = {
    work_id: queued.work.work_id,
    reason: "Archiviato in attesa della nuova priorità.",
    idempotency_key: "gallery-archive-replay-0001",
  };

  const archived = await store.archiveWork(identity(), request);
  const replay = await store.archiveWork(identity(), request);
  assert.equal(replay.idempotent_replay, true);
  assert.deepEqual(replay.work, archived.work);
  assert.equal(replay.released_lease_count, archived.released_lease_count);
  assert.deepEqual(replay.event, archived.event);
  assert.equal([...pool.events.values()].filter((event) => event.event_type === "work_archived_v3").length, 1);

  await assert.rejects(store.archiveWork(identity(), {
    ...request,
    reason: "Una diversa motivazione non può riutilizzare la stessa chiave.",
  }), /work_archive_idempotency_conflict/);
  assert.equal([...pool.events.values()].filter((event) => event.event_type === "work_archived_v3").length, 1);
});

test("a private Gallery assignment loses agent read access on archive, reopen, and reassignment", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  const queued = await store.queueNewWork(identity(), await reviewed(store, createInput()));
  const workId = queued.work.work_id;
  const codex = identity("codex", "member");
  codex.agentPresence.client_type = "codex";
  await store.assignQueuedWork(identity(), {
    work_id: workId,
    target_agent_id: "agent-codex",
    target_client_type: "codex",
  });
  await store.acceptQueuedWorkAssignment(codex, { work_id: workId });
  assert.deepEqual((await store.listWorks(codex, { view: "my" })).map((work) => work.work_id), [workId]);

  await store.archiveWork(identity(), {
    work_id: workId,
    reason: "Ferma il lavoro prima della nuova assegnazione.",
    idempotency_key: "gallery-acl-archive-0001",
  });
  assert.deepEqual(await store.listWorks(codex, { view: "archive" }), []);

  await store.reopenWork(identity(), {
    work_id: workId,
    reason: "La priorità è stata rivalutata.",
  });
  assert.deepEqual(await store.listWorks(codex, { view: "operational" }), []);

  await store.assignQueuedWork(identity(), {
    work_id: workId,
    target_agent_id: "agent-other",
    target_client_type: "codex",
  });
  const other = identity("other", "member");
  other.agentPresence.client_type = "codex";
  await store.acceptQueuedWorkAssignment(other, { work_id: workId });
  assert.deepEqual(await store.listWorks(codex, { view: "operational" }), []);
  assert.deepEqual((await store.listWorks(other, { view: "my" })).map((work) => work.work_id), [workId]);
  assert.deepEqual((await store.listWorks(identity(), { view: "my" })).map((work) => work.work_id), [workId]);
});

test("Gallery V3 rejects a queue whose reviewed idea or architecture changed", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = await reviewed(store, createInput());

  await assert.rejects(store.queueNewWork(identity(), {
    ...input,
    idea: "A different idea must not reuse the review.",
  }), /open_work_review_request_binding_invalid/);
  await assert.rejects(store.queueNewWork(identity(), {
    ...input,
    architecture: { component: "changed-after-review" },
  }), /open_work_review_request_binding_invalid/);
  assert.equal(pool.works.size, 0);
});

test("Gallery V3 rejects a caller-supplied Work id already bound to another Work", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  const existing = await store.queueNewWork(identity(), await reviewed(store, createInput()));
  const collisionId = existing.work.work_id;
  const candidate = {
    ...createInput(),
    request_id: "request-collision-002",
    work_id: collisionId,
    work_name: "Different queued Work",
    idea: "A distinct Gallery request",
    objective: "Must not consume a review for an existing Work id",
  };
  const reviewedCandidate = await reviewed(store, candidate);

  await assert.rejects(
    store.queueNewWork(identity(), { ...reviewedCandidate, review_decision: "CONTINUE_NEW_WORK" }),
    /tenant_work_queue_work_id_collision/,
  );
  assert.equal(
    pool.reviews.get(key("tenant-a", reviewedCandidate.review_id)).consumed_at,
    null,
    "the rejected collision must leave its review available for a corrected request",
  );
  assert.equal(pool.works.size, 1);
});

test("an exact Codex agent can accept a Gallery offer, but an impersonating host cannot", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  const queued = await store.queueNewWork(identity(), await reviewed(store, createInput()));
  const offer = await store.assignQueuedWork(identity(), {
    work_id: queued.work.work_id,
    target_agent_id: "agent-codex",
    target_client_type: "codex",
  });
  assert.equal(offer.work.assignment_status, "OFFERED");

  const wrongHost = identity("wrong-host");
  wrongHost.agentPresence.client_type = "codex";
  await assert.rejects(store.acceptQueuedWorkAssignment(wrongHost, {
    work_id: queued.work.work_id,
  }), /work_assignment_acceptance_denied/);

  const codex = identity("codex");
  codex.agentPresence.client_type = "codex";
  const accepted = await store.acceptQueuedWorkAssignment(codex, {
    work_id: queued.work.work_id,
  });
  assert.equal(accepted.work.assignment_status, "ACCEPTED");
  assert.deepEqual(accepted.work.agent_ids.sort(), ["agent-codex", "agent-owner"]);
  assert.equal(accepted.work.status, "PLANNED");
});

test("a blocked Work requires a review decision but does not prevent an independent queued Work", async () => {
  const pool = new AtomicWorkPool();
  pool.works.set(key("tenant-a", "11111111-1111-4111-8111-111111111111"), {
    tenant_id: "tenant-a", work_id: "11111111-1111-4111-8111-111111111111", legacy_work_id: null,
    work_code: "NYRA-20260808-0001", work_name: "Blocked legacy concern", work_type: "generic",
    project_id: "nyra-core", owner_user_id: "owner", created_by_user_id: "owner", assigned_user_ids: [],
    supervising_user_ids: [], agent_ids: [], visibility_scope: "private", status: "BLOCKED",
    priority: "P4", priority_score: 0, progress_bp: 0, next_action: "resolve separate blocker",
    updated_at: "2026-08-08T09:00:00.000Z",
  });
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = await reviewed(store, {
    ...createInput(),
    request_id: "request-queued-after-block",
    work_name: "Gallery workflow cleanup",
    idea: "Separate backlog work",
    objective: "Make the gallery queue manageable",
  });
  const queued = await store.queueNewWork(identity(), {
    ...input,
    review_decision: "CONTINUE_NEW_WORK",
  });
  assert.equal(queued.work.status, "PLANNED");
  assert.equal(pool.works.size, 2);
});

test("completed archives remain immutable and cannot be reopened", async () => {
  const pool = new AtomicWorkPool();
  const workId = "55555555-5555-4555-8555-555555555555";
  pool.works.set(key("tenant-a", workId), {
    tenant_id: "tenant-a", work_id: workId, legacy_work_id: null,
    work_code: "NYRA-20260808-0008", work_name: "Completed", work_type: "generic",
    project_id: "nyra-core", owner_user_id: "owner", created_by_user_id: "owner",
    assigned_user_ids: [], supervising_user_ids: [], agent_ids: [], visibility_scope: "private",
    status: "ARCHIVED", archived_at: "2026-08-08T09:00:00.000Z", archived_from_status: null,
    priority: "P4", priority_score: 0, progress_bp: 10000, updated_at: "2026-08-08T09:00:00.000Z",
  });
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  await assert.rejects(store.reopenWork(identity(), {
    work_id: workId,
    reason: "Do not rewrite completed history.",
  }), /work_reopen_status_invalid/);
});

test("two no-conflict reviews cannot race into duplicate same-project Works", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const firstInput = await reviewed(store, createInput());
  const secondInput = await reviewed(store, { ...createInput(), request_id: "request-002",
    session_id: "session-002" });
  const first = await store.createNewWork(identity(), firstInput);
  await assert.rejects(
    store.createNewWork(identity(), secondInput),
    /open_work_review_stale_conflict/,
  );
  assert.equal(pool.works.size, 1);
  assert.equal(pool.legacy.size, 1);
  assert.equal(pool.reviews.get(key("tenant-a", secondInput.review_id)).consumed_at, null);
  assert.equal(first.work.work_name, "Continuity transaction");
  assert.equal(pool.queries.some((query) => query.startsWith("SELECT pg_advisory_xact_lock")), true);
  const lockCall = pool.queryParameters.find((call) =>
    call.sql.startsWith("SELECT pg_advisory_xact_lock"));
  assert.match(lockCall.parameters[0], /^tenant_work_bootstrap:[a-f0-9]{64}$/);
  assert.equal(lockCall.parameters[0].includes("\0"), false,
    "PostgreSQL text advisory-lock keys must never contain a NUL byte");
});

test("an owner-approved review remains consumable when a legacy candidate is redacted from its rendered list", async () => {
  const pool = new AtomicWorkPool();
  const legacyId = "66666666-6666-4666-8666-666666666666";
  pool.works.set(key("tenant-a", legacyId), {
    tenant_id: "tenant-a", work_id: legacyId, legacy_work_id: legacyId,
    work_code: "NYRA-CONVERSE-V1-0001", work_name: "Nyra conversational host runtime",
    work_type: "legacy", project_id: "nyra-converse-v1", owner_user_id: "owner", created_by_user_id: "owner",
    assigned_user_ids: [], supervising_user_ids: [], agent_ids: [], visibility_scope: "private",
    status: "HANDOFF", priority: "P4", priority_score: 0, progress_bp: 0,
    objective: "Nyra host runtime and governed conversation", next_action: "obtain Core ticket",
    acceptance_criteria: [], updated_at: "2026-08-08T09:59:00.000Z",
  });
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = {
    ...createInput(), request_id: "request-redacted-legacy-candidate", session_id: "session-redacted",
    project_id: "nyra-core-layering", work_name: "Nyra conversational layering",
    objective: "Govern Nyra host runtime with a distinct Work and Core ticket",
  };
  const review = await store.openWorkReview(identity(), { intent_type: "CREATE_WORK",
    request: `${input.work_name} ${input.objective}`, create_request: input });
  assert.equal(review.selected_work_id, legacyId);
  assert.equal(review.requires_owner_decision, true);
  const stored = pool.reviews.get(key("tenant-a", review.review_id));
  stored.review_result = { ...stored.review_result, candidates: [] };

  const created = await store.createNewWork(identity(), {
    ...input, review_id: review.review_id, review_digest: review.review_digest,
    review_decision: "CONTINUE_NEW_WORK",
  });
  assert.equal(created.work.project_id, "nyra-core-layering");
  assert.equal(pool.works.size, 2);
});

test("preflight projects legacy rows without inventing ownership and preserves Gallery v1 shape", async () => {
  const pool = new AtomicWorkPool();
  const legacyId = "22222222-2222-4222-8222-222222222222";
  pool.legacy.set(key("tenant-a", legacyId), { tenant_id: "tenant-a", work_id: legacyId,
    project_id: "nyra-core", parent_work_id: null, idea: "Legacy continuity", objective: "project safely",
    status: "active", next_action: "resume", created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-08T09:00:00.000Z", source_sequence_number: 1,
    source_event_type: "work_created", source_event_hash: "a".repeat(64), source_event_payload: {} });
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  const gallery = await store.preflightGallery(identity(), { project_id: "nyra-core" });
  assert.equal(gallery.schema_version, "tenant_work_gallery_v1");
  assert.equal(gallery.source_schema_version, "work_continuity_v2");
  assert.equal(gallery.works[0].work_id, legacyId);
  assert.equal(gallery.works[0].status, "active");
  assert.equal(pool.works.get(key("tenant-a", legacyId)).owner_user_id, null);
  const insert = pool.queries.find((query) => query.startsWith("INSERT INTO tenant_work "));
  assert.match(insert, /\$8::varchar/);
  assert.equal((insert.match(/\$8::varchar/g) || []).length, 3,
    "PostgreSQL must infer one varchar type for status and both archive predicates");
});

test("Gallery projection advances from the authoritative Work event and exact replay is idempotent", async () => {
  const pool = new AtomicWorkPool();
  const legacyId = "55555555-5555-4555-8555-555555555555";
  pool.legacy.set(key("tenant-a", legacyId), { tenant_id: "tenant-a", work_id: legacyId,
    project_id: "nyra-core", parent_work_id: null, idea: "Projected continuity", objective: "stay aligned",
    status: "active", next_action: "start", created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-08T09:00:00.000Z", source_sequence_number: 1,
    source_event_type: "work_created", source_event_hash: "a".repeat(64), source_event_payload: {} });
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  await store.preflightGallery(identity(), { project_id: "nyra-core" });
  const source = pool.legacy.get(key("tenant-a", legacyId));
  Object.assign(source, { status: "release_ready", next_action: "release", updated_at: "2026-08-08T10:01:00.000Z",
    source_sequence_number: 2, source_event_type: "core_join_issued",
    source_event_hash: "b".repeat(64), source_event_payload: {} });
  const first = await store.preflightGallery(identity(), { project_id: "nyra-core" });
  assert.equal(first.works[0].status, "release_ready");
  assert.equal(pool.works.get(key("tenant-a", legacyId)).status, "HANDOFF");
  assert.equal(pool.works.get(key("tenant-a", legacyId)).legacy_projection_sequence, 2);
  const eventCount = pool.events.size;
  await store.preflightGallery(identity(), { project_id: "nyra-core" });
  assert.equal(pool.events.size, eventCount, "same authoritative event must not append another projection event");
});

test("terminal projection requires immutable Core closure evidence", async () => {
  const pool = new AtomicWorkPool();
  const legacyId = "66666666-6666-4666-8666-666666666666";
  pool.legacy.set(key("tenant-a", legacyId), { tenant_id: "tenant-a", work_id: legacyId,
    project_id: "nyra-core", parent_work_id: null, idea: "Terminal continuity", objective: "close safely",
    status: "active", next_action: "start", created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-08T09:00:00.000Z", source_sequence_number: 1,
    source_event_type: "work_created", source_event_hash: "a".repeat(64), source_event_payload: {} });
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  await store.preflightGallery(identity(), { project_id: "nyra-core" });
  const source = pool.legacy.get(key("tenant-a", legacyId));
  Object.assign(source, { status: "completed", next_action: "", updated_at: "2026-08-08T10:01:00.000Z",
    source_sequence_number: 2, source_event_type: "checkpoint_created",
    source_event_hash: "b".repeat(64), source_event_payload: {} });
  await store.preflightGallery(identity(), { project_id: "nyra-core" });
  assert.equal(pool.works.get(key("tenant-a", legacyId)).status, "ACTIVE");
  Object.assign(source, { source_sequence_number: 3, source_event_type: "closure_finalized",
    source_event_hash: "c".repeat(64) });
  await store.preflightGallery(identity(), { project_id: "nyra-core" });
  const projected = pool.works.get(key("tenant-a", legacyId));
  assert.equal(projected.status, "COMPLETED");
  assert.equal(projected.archived_at, "2026-08-08T10:01:00.000Z");
});

test("archive exposes a bounded final report summary and stale dry-run preserves relations", async () => {
  const pool = new AtomicWorkPool();
  const terminalId = "33333333-3333-4333-8333-333333333333";
  const successorId = "44444444-4444-4444-8444-444444444444";
  pool.works.set(key("tenant-a", terminalId), { tenant_id: "tenant-a", work_id: terminalId,
    work_code: "NYRA-20260808-0002", work_name: "Closed", work_type: "generic", project_id: "nyra-core",
    owner_user_id: "owner", created_by_user_id: "owner", assigned_user_ids: [], supervising_user_ids: [], agent_ids: [],
    visibility_scope: "private", status: "COMPLETED", priority: "P4", priority_score: 0, progress_bp: 10000,
    closed_at: "2026-08-08T09:00:00.000Z", updated_at: "2026-08-08T09:00:00.000Z" });
  pool.works.set(key("tenant-a", successorId), { tenant_id: "tenant-a", work_id: successorId,
    work_code: "NYRA-20260808-0003", work_name: "Superseded", work_type: "generic", project_id: "nyra-core",
    owner_user_id: "owner", created_by_user_id: "owner", assigned_user_ids: [], supervising_user_ids: [], agent_ids: [],
    visibility_scope: "private", status: "ACTIVE", priority: "P4", priority_score: 0, progress_bp: 0,
    successor_work_id: terminalId, updated_at: "2026-07-01T09:00:00.000Z" });
  pool.reports.set(key("tenant-a", terminalId), { work_id: terminalId, report_digest: "c".repeat(64),
    created_at: "2026-08-08T09:00:00.000Z", final_status: "COMPLETED",
    report_closed_at: "2026-08-08T09:00:00.000Z", report_final_evidence_digest: "d".repeat(64) });
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  const archive = await store.listWorks(identity(), { view: "archive", project_id: "nyra-core" });
  assert.equal(archive[0].final_report_summary.report_digest, "c".repeat(64));
  assert.equal(archive[0].final_report_summary.final_status, "COMPLETED");
  const stale = await store.reconcileStaleDryRun(identity(), { project_id: "nyra-core" });
  const related = stale.classifications.find((item) => item.work_id === successorId);
  assert.equal(related.classification, "SUPERSEDED");
  assert.equal(related.successor_work_id, terminalId);
});

test("Open Work Review rejects resume/chat intents", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  await assert.rejects(store.openWorkReview(identity(), { intent_type: "RESUME_WORK",
    request: "resume", create_request: createInput() }), /open_work_review_create_intent_required/);
});
