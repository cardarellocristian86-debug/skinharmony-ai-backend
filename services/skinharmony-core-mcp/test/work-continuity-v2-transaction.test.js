import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkContinuityV2Store,
  deriveAuthenticatedTenantWorkAcl,
} from "../src/work-continuity-v2-store.js";

function key(...parts) { return parts.join("\0"); }
function cloneMap(map) { return new Map([...map].map(([k, v]) => [k, structuredClone(v)])); }

class AtomicWorkPool {
  constructor() {
    this.reviews = new Map();
    this.legacy = new Map();
    this.works = new Map();
    this.tasks = new Map();
    this.events = new Map();
    this.reports = new Map();
    this.sequences = new Map();
    this.participants = new Map();
    this.leases = new Map();
    this.queries = [];
  }

  snapshot() {
    return Object.fromEntries(["reviews", "legacy", "works", "tasks", "events", "reports", "sequences", "participants", "leases"]
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
    if (q.includes("CREATE TABLE IF NOT EXISTS tenant_work")) return { rows: [], rowCount: 0 };
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
        consumed_by_user_id: null, decision: null, decision_digest: null, consumed_work_id: null };
      this.reviews.set(key(tenantId, reviewId), row);
      return { rows: [], rowCount: 1 };
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
    if (q.startsWith("INSERT INTO tenant_work ")) {
      let row;
      if (parameters.length === 23) {
        const [tenantId, workId, legacyWorkId, workCode, workName, workType, projectId, ownerUserId,
          teamId, assigned, supervising, agents, visibility, priority, priorityScore, priorityVersion,
          priorityContext, intentDigest, objective, nextAction, agentId, sessionFingerprint, criteria] = parameters;
        row = { tenant_id: tenantId, work_id: workId, legacy_work_id: legacyWorkId, work_code: workCode,
          work_name: workName, work_type: workType, project_id: projectId, owner_user_id: ownerUserId,
          created_by_user_id: ownerUserId, team_id: teamId, assigned_user_ids: JSON.parse(assigned),
          supervising_user_ids: JSON.parse(supervising), agent_ids: JSON.parse(agents), visibility_scope: visibility,
          status: "ACTIVE", priority, priority_score: priorityScore, priority_version: priorityVersion,
          priority_context: JSON.parse(priorityContext), intent_digest: intentDigest, objective, next_action: nextAction,
          created_by_agent_id: agentId, created_by_session_fingerprint: sessionFingerprint,
          acceptance_criteria: JSON.parse(criteria), progress_bp: 0, created_at: "2026-08-08T10:00:00.000Z",
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
        acceptance_criteria: JSON.parse(parameters[20]), legacy_projection_sequence: null,
        legacy_projection_event_hash: null, legacy_projection_updated_at: null,
      });
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_task")) {
      const row = { tenant_id: parameters[0], task_id: parameters[1], work_id: parameters[2],
        title: parameters[3], weight: parameters[4], status: "planned", required: parameters[5], acceptance_verified: false };
      this.tasks.set(key(row.tenant_id, row.task_id), row);
      return { rows: [], rowCount: 1 };
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

function legacyRuntime(pool) {
  return { initialize: async () => {}, ensureWithClient: async (client, who, input) => {
    const row = client.insertLegacy(who, input);
    return { work_id: row.work_id, intent_digest: row.intent_digest,
      event: { event_hash: "b".repeat(64) } };
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
  const first = await store.createNewWork(identity(), input);
  const replay = await store.createNewWork(identity(), input);
  assert.equal(first.work.work_id, replay.work.work_id);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(pool.legacy.size, 1);
  assert.equal(pool.works.size, 1);
  assert.equal(pool.tasks.size, 1);
  assert.equal(pool.events.size, 2);
  assert.equal(pool.reviews.get(key("tenant-a", input.review_id)).consumed_work_id, first.work.work_id);
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
  assert.equal(row.legacy_projection_sequence, null);
  assert.equal(pool.tasks.size, 1);
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
