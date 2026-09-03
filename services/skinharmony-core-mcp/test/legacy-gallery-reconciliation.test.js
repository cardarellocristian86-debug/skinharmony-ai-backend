import assert from "node:assert/strict";
import test from "node:test";

import {
  ADDITIVE_SCHEMA_SQL,
  createWorkContinuityV2Store,
} from "../src/work-continuity-v2-store.js";
import { WORK_CONTINUITY_TOOLS } from "../src/work-continuity-tools.js";

const SOURCE = "11111111-1111-4111-8111-111111111111";
const SUCCESSOR = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-11T20:00:00.000Z");
const OLD = "2026-08-08T20:00:00.000Z";

function identity({ confirmed = true, tenant = "tenant-a" } = {}) {
  return {
    tenantId: tenant,
    subject: "owner-a",
    ownerConfirmed: confirmed,
    confirmationReference: confirmed ? "owner-approved-legacy-gallery-reconciliation" : "",
    agentPresence: { agent_id: "owner-agent", session_fingerprint: "a".repeat(32) },
    tenant_work_acl: {
      server_derived: true,
      tenant_id: tenant,
      user_id: "owner-a",
      role: "tenant_owner",
      team_ids: [],
      managed_team_ids: [],
      assigned_work_ids: [],
      is_tenant_owner: true,
      is_super_admin: false,
    },
  };
}

function legacyRow(workId, status, projectId = "skinharmony-ai-backend") {
  return {
    tenant_id: "tenant-a",
    work_id: workId,
    project_id: projectId,
    parent_work_id: null,
    idea: `Legacy ${workId}`,
    objective: "Reconcile historical Gallery state",
    status,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: OLD,
    next_action: "historical action",
  };
}

function v2Row(workId, status, projectId = "skinharmony-ai-backend") {
  return {
    tenant_id: "tenant-a",
    work_id: workId,
    legacy_work_id: workId,
    work_code: `LEGACY-${workId.slice(0, 8)}`,
    work_name: `Legacy ${workId}`,
    work_type: "legacy",
    project_id: projectId,
    owner_user_id: null,
    created_by_user_id: null,
    assigned_user_ids: [],
    supervising_user_ids: [],
    agent_ids: [],
    visibility_scope: "private",
    status,
    progress_bp: 0,
    priority: "P4",
    priority_score: 0,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: OLD,
    closed_at: null,
    archived_at: null,
    cancelled_at: null,
    successor_work_id: null,
    superseded_by_work_id: null,
    next_action: "historical action",
  };
}

class ReconciliationPool {
  constructor({ sourceStatus = "active", sourceV2Status = "ACTIVE", activePresence = false,
    readOnlyPresence = false, spoofedReadOnlyPresence = false, activeBranch = false,
    successor = false, successorEvidence = false, sourceClosureEvidence = false } = {}) {
    this.legacy = new Map([[`tenant-a:${SOURCE}`, legacyRow(SOURCE, sourceStatus)]]);
    this.works = new Map([[`tenant-a:${SOURCE}`, v2Row(SOURCE, sourceV2Status)]]);
    if (successor) {
      this.legacy.set(`tenant-a:${SUCCESSOR}`, legacyRow(SUCCESSOR, "completed"));
      this.works.set(`tenant-a:${SUCCESSOR}`, {
        ...v2Row(SUCCESSOR, "COMPLETED"),
        closed_at: "2026-08-10T18:00:00.000Z",
        archived_at: "2026-08-10T18:00:00.000Z",
      });
    }
    this.participants = activePresence
      ? [{ session_id: "active-work-session", branch_id: null, status: "active", expires_at: "2026-08-12T00:00:00.000Z" }]
      : [];
    if (readOnlyPresence || spoofedReadOnlyPresence) {
      this.participants.push({ session_id: "nyra-read-session", branch_id: null,
        status: "active", expires_at: "2026-08-12T00:00:00.000Z" });
    }
    this.leases = (readOnlyPresence || spoofedReadOnlyPresence)
      ? [{ session_id: "nyra-read-session", branch_id: null,
        purpose: "Nyra governed read-only Work context",
        nyra_read_binding_attested: readOnlyPresence,
        status: "active", expires_at: "2026-08-12T00:00:00.000Z" }]
      : [];
    this.branches = activeBranch ? [{ branch_id: "33333333-3333-4333-8333-333333333333" }] : [];
    this.v2Events = [];
    this.legacyEvents = [];
    if (sourceClosureEvidence) {
      this.legacyEvents.push({
        tenant_id: "tenant-a", work_id: SOURCE, sequence_number: 4,
        event_type: "closure_finalized", event_hash: "c".repeat(64),
        created_at: "2026-08-10T18:00:00.000Z", payload: {},
      });
    }
    this.receipts = successorEvidence
      ? new Map([[`tenant-a:${SUCCESSOR}`, { receipt_digest: "d".repeat(64) }]])
      : new Map();
    this.reports = successorEvidence
      ? new Map([[`tenant-a:${SUCCESSOR}`, { report_digest: "e".repeat(64) }]])
      : new Map();
    this.calls = [];
  }

  async query(sql, params = []) {
    const queryText = typeof sql === "string" ? sql : sql.text;
    const q = queryText.replace(/\s+/g, " ").trim();
    if (!params.length && Array.isArray(sql?.values)) params = sql.values;
    this.calls.push({ sql: q, params });
    if (q.includes("CREATE TABLE IF NOT EXISTS tenant_work")) return { rows: [] };
    if (q.startsWith("SELECT work_id,project_id,parent_work_id,idea,objective,status,created_at,updated_at,next_action FROM core_continuity_works")) {
      const row = this.legacy.get(`${params[0]}:${params[1]}`);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (q.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND legacy_work_id=$2")) {
      const row = [...this.works.values()].find((item) =>
        item.tenant_id === params[0] && item.legacy_work_id === params[1]);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (q.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND (legacy_work_id=$2 OR work_id=$2)")) {
      const row = [...this.works.values()].find((item) => item.tenant_id === params[0] &&
        (item.legacy_work_id === params[1] || item.work_id === params[1]));
      return { rows: row ? [{ ...row }] : [] };
    }
    if (q.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2")) {
      const row = this.works.get(`${params[0]}:${params[1]}`);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (q.startsWith("SELECT payload,event_hash,sequence_number FROM tenant_work_event")) {
      const row = [...this.v2Events].reverse().find((item) => item.tenant_id === params[0] &&
        item.work_id === params[1] && item.event_type === "legacy_work_reconciled_closed" &&
        item.payload.idempotency_key_digest === params[2]);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (q.startsWith("SELECT tenant_id,work_id,sequence_number,event_type,payload,")) {
      const row = [...this.v2Events].reverse().find((item) => item.tenant_id === params[0] &&
        item.work_id === params[1] && item.event_type === "historical_bridge_archived_v1" &&
        item.payload.idempotency_key_digest === params[2]);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (q.startsWith("SELECT session_id,branch_id,status,expires_at FROM core_continuity_participants") ||
        q.startsWith("SELECT status,expires_at FROM core_continuity_participants")) {
      return { rows: params[1] === SOURCE ? this.participants.map((row) => ({ ...row })) : [] };
    }
    if (q.startsWith("SELECT session_id,branch_id,purpose,status,expires_at,nyra_read_binding_attested FROM core_continuity_leases") ||
        q.startsWith("SELECT status,expires_at FROM core_continuity_leases")) {
      return { rows: params[1] === SOURCE ? this.leases.map((row) => ({ ...row })) : [] };
    }
    if (q.startsWith("SELECT branch_id FROM core_continuity_branches")) {
      return { rows: params[1] === SOURCE ? this.branches.map((row) => ({ ...row })) : [] };
    }
    if (q.startsWith("SELECT status,updated_at FROM core_continuity_works")) {
      const row = this.legacy.get(`${params[0]}:${params[1]}`);
      return { rows: row ? [{ status: row.status, updated_at: row.updated_at }] : [] };
    }
    if (q.startsWith("SELECT work_id,status,updated_at FROM core_continuity_works")) {
      const row = this.legacy.get(`${params[0]}:${params[1]}`);
      return { rows: row ? [{ work_id: row.work_id, status: row.status, updated_at: row.updated_at }] : [] };
    }
    if (q.startsWith("SELECT work_id,project_id,status FROM core_continuity_works")) {
      const row = this.legacy.get(`${params[0]}:${params[1]}`);
      return { rows: row ? [{ work_id: row.work_id, project_id: row.project_id, status: row.status }] : [] };
    }
    if (q.startsWith("SELECT work_id,legacy_work_id,project_id,status FROM tenant_work")) {
      const row = [...this.works.values()].find((item) => item.tenant_id === params[0] &&
        (item.work_id === params[1] || item.legacy_work_id === params[1]));
      return { rows: row ? [{ work_id: row.work_id, legacy_work_id: row.legacy_work_id,
        project_id: row.project_id, status: row.status }] : [] };
    }
    if (q.startsWith("SELECT r.receipt_digest,f.report_digest,tw.status FROM tenant_work tw")) {
      const work = this.works.get(`${params[0]}:${params[1]}`);
      const receipt = this.receipts.get(`${params[0]}:${params[1]}`);
      const report = this.reports.get(`${params[0]}:${params[1]}`);
      return { rows: work && ["COMPLETED", "ARCHIVED"].includes(work.status) && receipt && report
        ? [{ ...receipt, ...report, status: work.status }] : [] };
    }
    if (q.startsWith("SELECT event_type,event_hash,created_at FROM core_continuity_events")) {
      const row = [...this.legacyEvents].reverse().find((item) => item.tenant_id === params[0] &&
        item.work_id === params[1] && params[2].includes(item.event_type));
      return { rows: row ? [{ event_type: row.event_type, event_hash: row.event_hash,
        created_at: row.created_at }] : [] };
    }
    if (q.startsWith("SELECT event_type,event_hash FROM core_continuity_events")) {
      const row = [...this.legacyEvents].reverse().find((item) => item.tenant_id === params[0] &&
        item.work_id === params[1] && params[2].includes(item.event_type));
      return { rows: row ? [{ event_type: row.event_type, event_hash: row.event_hash }] : [] };
    }
    if (q.startsWith("UPDATE tenant_work SET status=$3")) {
      const key = `${params[0]}:${params[1]}`;
      const work = this.works.get(key);
      if (!work || work.status !== params[5]) return { rows: [], rowCount: 0 };
      Object.assign(work, {
        status: params[2], closed_at: work.closed_at || params[6] || NOW.toISOString(),
        archived_at: work.archived_at || NOW.toISOString(),
        cancelled_at: params[2] === "CANCELLED" ? (work.cancelled_at || NOW.toISOString()) : work.cancelled_at,
        closure_type: "legacy_reconciliation", closure_reason: params[3], next_action: "",
        successor_work_id: params[4], superseded_by_work_id: params[4], updated_at: NOW.toISOString(),
      });
      return { rows: [{ closed_at: work.closed_at, archived_at: work.archived_at }], rowCount: 1 };
    }
    if (q.startsWith("UPDATE tenant_work SET status='ARCHIVED'")) {
      const key = `${params[0]}:${params[1]}`;
      const work = this.works.get(key);
      if (!work || work.status !== params[4]) return { rows: [], rowCount: 0 };
      Object.assign(work, {
        status: "ARCHIVED", archived_at: NOW.toISOString(), archived_from_status: params[2],
        archived_reason: params[3], closure_type: "historical_bridge_archive",
        closure_reason: params[3], assignment_status: "REVOKED", updated_at: NOW.toISOString(),
      });
      return { rows: [{ ...work }], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_works SET status=$3")) {
      const key = `${params[0]}:${params[1]}`;
      const work = this.legacy.get(key);
      if (!work || work.status !== params[3]) return { rows: [], rowCount: 0 };
      Object.assign(work, { status: params[2], next_action: "", updated_at: NOW.toISOString() });
      return { rows: [{ updated_at: work.updated_at }], rowCount: 1 };
    }
    if (q.startsWith("SELECT sequence_number,event_hash FROM core_continuity_events")) {
      const rows = this.legacyEvents.filter((item) => item.tenant_id === params[0] && item.work_id === params[1]);
      const row = rows.sort((a, b) => b.sequence_number - a.sequence_number)[0];
      return { rows: row ? [{ sequence_number: row.sequence_number, event_hash: row.event_hash }] : [] };
    }
    if (q.startsWith("INSERT INTO core_continuity_events")) {
      this.legacyEvents.push({ tenant_id: params[0], work_id: params[1], event_id: params[2],
        sequence_number: params[3], event_type: params[4], payload: JSON.parse(params[5]),
        previous_event_hash: params[6], event_hash: params[7] });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT sequence_number,event_hash FROM tenant_work_event")) {
      const rows = this.v2Events.filter((item) => item.tenant_id === params[0] && item.work_id === params[1]);
      const row = rows.sort((a, b) => b.sequence_number - a.sequence_number)[0];
      return { rows: row ? [{ sequence_number: row.sequence_number, event_hash: row.event_hash }] : [] };
    }
    if (q.startsWith("INSERT INTO tenant_work_event")) {
      this.v2Events.push({ tenant_id: params[0], work_id: params[1], event_id: params[2],
        sequence_number: params[3], event_type: params[4], payload: JSON.parse(params[5]),
        previous_event_hash: params[6], event_hash: params[7] });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 ORDER BY")) {
      return { rows: [...this.works.values()].filter((item) => item.tenant_id === params[0]).map((item) => ({ ...item })) };
    }
    if (q.startsWith("SELECT work_id,report_digest,created_at")) return { rows: [] };
    throw new Error(`unexpected_query:${q}`);
  }
}

function store(pool) {
  return createWorkContinuityV2Store({ pool, now: () => new Date(NOW) });
}

test("legacy reconciliation tool is owner-confirmed, exact and preserves terminal semantics", () => {
  const tool = WORK_CONTINUITY_TOOLS.find((item) => item.name === "tenant_work_legacy_reconcile_close");
  const catalog = WORK_CONTINUITY_TOOLS.find((item) => item.name === "work_continuity_work_catalog");
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool._meta["skinharmony/ownerConfirmationRequired"], true);
  assert.equal(tool._meta["skinharmony/dedicatedCoreGate"], true);
  assert.equal(tool._meta["skinharmony/serverOwnedGovernance"], true);
  assert.deepEqual(tool.inputSchema.properties.action.enum,
    ["CANCEL", "SUPERSEDE", "REPAIR_COMPLETED_PROJECTION"]);
  assert(catalog.inputSchema.properties.status.enum.includes("cancelled"));
  assert(catalog.inputSchema.properties.status.enum.includes("superseded"));
});

test("historical bridged archive is owner-confirmed and never claims a closure", () => {
  const tool = WORK_CONTINUITY_TOOLS.find((item) => item.name === "tenant_work_historical_archive_v3");
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool._meta["skinharmony/ownerConfirmationRequired"], true);
  assert.equal(tool._meta["skinharmony/dedicatedCoreGate"], true);
  assert.deepEqual(tool.inputSchema.properties.expected_classification.enum, ["STALE", "ABANDONED"]);
});

test("historical bridged archive retains the legacy record, requires stale inactivity, and replays exactly", async () => {
  const pool = new ReconciliationPool({ sourceStatus: "release_ready", sourceV2Status: "BLOCKED" });
  const linked = pool.works.get(`tenant-a:${SOURCE}`);
  linked.work_type = "software_git";
  const runtime = store(pool);
  const args = {
    work_id: SOURCE,
    expected_classification: "STALE",
    reason: "The immutable native task binding changed, so this historical bridge cannot be honestly closed.",
    idempotency_key: "archive-historical-bridge-0001",
  };
  const first = await runtime.archiveHistoricalBridgedWork(identity(), args);
  assert.equal(first.work.status, "ARCHIVED");
  assert.equal(first.classification, "STALE");
  assert.equal(first.closure_claimed, false);
  assert.equal(pool.legacy.get(`tenant-a:${SOURCE}`).status, "release_ready");
  assert.equal(pool.works.get(`tenant-a:${SOURCE}`).closed_at, null);
  assert.equal(pool.v2Events.at(-1).event_type, "historical_bridge_archived_v1");
  assert.equal(pool.v2Events.at(-1).payload.closure_claimed, false);

  const eventCount = pool.v2Events.length;
  const replay = await runtime.archiveHistoricalBridgedWork(identity(), args);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(pool.v2Events.length, eventCount);

  const activePool = new ReconciliationPool({ sourceStatus: "release_ready", sourceV2Status: "BLOCKED", activePresence: true });
  activePool.works.get(`tenant-a:${SOURCE}`).work_type = "software_git";
  await assert.rejects(store(activePool).archiveHistoricalBridgedWork(identity(), args),
    /historical_bridge_archive_active_work_denied/);

  const readOnlyPool = new ReconciliationPool({ sourceStatus: "release_ready", sourceV2Status: "BLOCKED", readOnlyPresence: true });
  readOnlyPool.works.get(`tenant-a:${SOURCE}`).work_type = "software_git";
  const readOnlyArchive = await store(readOnlyPool).archiveHistoricalBridgedWork(identity(), args);
  assert.equal(readOnlyArchive.work.status, "ARCHIVED");

  const spoofedReadOnlyPool = new ReconciliationPool({ sourceStatus: "release_ready", sourceV2Status: "BLOCKED", spoofedReadOnlyPresence: true });
  spoofedReadOnlyPool.works.get(`tenant-a:${SOURCE}`).work_type = "software_git";
  await assert.rejects(store(spoofedReadOnlyPool).archiveHistoricalBridgedWork(identity(), args),
    /historical_bridge_archive_active_work_denied/);

  const branchPool = new ReconciliationPool({ sourceStatus: "release_ready", sourceV2Status: "BLOCKED", activeBranch: true });
  branchPool.works.get(`tenant-a:${SOURCE}`).work_type = "software_git";
  await assert.rejects(store(branchPool).archiveHistoricalBridgedWork(identity(), args),
    /historical_bridge_archive_active_work_denied/);
});

test("stale cancellation is tenant-scoped, dual-audited, archived and idempotent without completion", async () => {
  const pool = new ReconciliationPool();
  const runtime = store(pool);
  const args = {
    work_id: SOURCE,
    action: "CANCEL",
    expected_status: "active",
    expected_classification: "STALE",
    reason: "Historical duplicate has no remaining work or successor dependency.",
    idempotency_key: "cancel-legacy-source-0001",
  };
  const first = await runtime.reconcileLegacyClosed(identity(), args);
  assert.equal(first.status, "CANCELLED");
  assert.equal(first.legacy_status, "cancelled");
  assert.equal(first.completed, false);
  assert.equal(first.closed, true);
  assert.equal(first.closure_receipt_created, false);
  assert.equal(pool.works.get(`tenant-a:${SOURCE}`).status, "CANCELLED");
  assert.equal(pool.legacy.get(`tenant-a:${SOURCE}`).status, "cancelled");
  assert.equal(pool.v2Events.at(-1).payload.completed, false);
  assert.equal(pool.v2Events.at(-1).payload.legacy_event_hash, pool.legacyEvents.at(-1).event_hash);
  assert.equal(pool.calls.some((call) => /^(?:DELETE|DROP)\b/i.test(call.sql) ||
    /^INSERT INTO tenant_work_closure_receipt\b/i.test(call.sql)), false);

  const eventCounts = [pool.v2Events.length, pool.legacyEvents.length];
  const replay = await runtime.reconcileLegacyClosed(identity(), args);
  assert.equal(replay.idempotent_replay, true);
  assert.deepEqual([pool.v2Events.length, pool.legacyEvents.length], eventCounts);
  await assert.rejects(runtime.reconcileLegacyClosed(identity(), { ...args,
    reason: "Different request under the same idempotency key." }),
  /legacy_reconciliation_idempotency_conflict/);

  const archived = await runtime.listWorks(identity(), { view: "archive" });
  assert.equal(archived.some((work) => work.work_id === SOURCE && work.status === "CANCELLED"), true);
});

test("reconciliation rejects missing owner proof and any effective participant", async () => {
  await assert.rejects(store(new ReconciliationPool()).reconcileLegacyClosed(identity({ confirmed: false }), {
    work_id: SOURCE, action: "CANCEL", expected_status: "active", expected_classification: "STALE",
    reason: "No longer required.", idempotency_key: "missing-owner-proof-0001",
  }), /legacy_reconciliation_owner_confirmation_required/);

  await assert.rejects(store(new ReconciliationPool({ activePresence: true })).reconcileLegacyClosed(identity(), {
    work_id: SOURCE, action: "CANCEL", expected_status: "active", expected_classification: "STALE",
    reason: "No longer required.", idempotency_key: "active-presence-denied-0001",
  }), /legacy_reconciliation_active_work_denied/);
});

test("legacy reconciliation cannot terminalize an adapter-backed V2 Work", async () => {
  const pool = new ReconciliationPool();
  pool.works.get(`tenant-a:${SOURCE}`).work_type = "research";
  await assert.rejects(store(pool).reconcileLegacyClosed(identity(), {
    work_id: SOURCE,
    action: "CANCEL",
    expected_status: "active",
    expected_classification: "STALE",
    reason: "This must be rejected before any terminal mutation.",
    idempotency_key: "adapter-backed-denied-0001",
  }), /legacy_reconciliation_work_type_invalid/);
  assert.equal(pool.calls.filter((call) => call.sql.startsWith("UPDATE ")).length, 0);
  assert.equal(pool.v2Events.length, 0);
  assert.equal(pool.legacyEvents.length, 0);
});

test("stale dry-run never suggests legacy reconciliation for adapter-backed V2 Work", async () => {
  const pool = new ReconciliationPool();
  pool.works.get(`tenant-a:${SOURCE}`).work_type = "research";
  const dryRun = await store(pool).reconcileStaleDryRun(identity());
  const classification = dryRun.classifications.find((item) => item.work_id === SOURCE);
  assert.equal(classification.work_type, "research");
  assert.equal(classification.legacy_reconciliation_eligible, false);
  assert.deepEqual(classification.allowed_actions, []);
  assert.equal(classification.owner_confirmation_required, false);
});

test("stale dry-run suppresses every mutation when authoritative V1 and projected V2 drift", async () => {
  const driftPool = new ReconciliationPool({
    sourceStatus: "release_ready",
    sourceV2Status: "BLOCKED",
  });
  const drift = await store(driftPool).reconcileStaleDryRun(identity());
  const classification = drift.classifications.find((item) => item.work_id === SOURCE);
  assert.equal(classification.projection_drift, true);
  assert.equal(classification.authoritative_status, "release_ready");
  assert.equal(classification.projected_status, "BLOCKED");
  assert.deepEqual(classification.allowed_actions, []);
  assert.equal(classification.owner_confirmation_required, false);
  assert.equal(classification.server_closure_evidence_required, false);
});

test("stale dry-run fails closed when the authoritative legacy Work is missing", async () => {
  const pool = new ReconciliationPool();
  pool.legacy.delete(`tenant-a:${SOURCE}`);
  const dryRun = await store(pool).reconcileStaleDryRun(identity());
  const classification = dryRun.classifications.find((item) => item.work_id === SOURCE);
  assert.equal(classification.projection_drift, true);
  assert.equal(classification.authoritative_status, null);
  assert.equal(classification.projected_status, "ACTIVE");
  assert.deepEqual(classification.allowed_actions, []);
  assert.equal(classification.owner_confirmation_required, false);
});

test("stale dry-run classifies from authoritative V1 time, not a stale V2 projection", async () => {
  const recentPool = new ReconciliationPool();
  const authoritativeUpdatedAt = new Date(Date.now() - 60_000).toISOString();
  recentPool.legacy.get(`tenant-a:${SOURCE}`).updated_at = authoritativeUpdatedAt;
  const recent = await store(recentPool).reconcileStaleDryRun(identity());
  const recentClassification = recent.classifications.find((item) => item.work_id === SOURCE);
  assert.equal(recentClassification.projection_drift, false);
  assert.equal(recentClassification.timestamp_projection_drift, true);
  assert.equal(recentClassification.authoritative_updated_at, authoritativeUpdatedAt);
  assert.equal(recentClassification.projected_updated_at, OLD);
  assert.equal(recentClassification.classification, "ACTIVE_VALID");
  assert.deepEqual(recentClassification.allowed_actions, []);
  assert.equal(recentClassification.owner_confirmation_required, false);

  const stale = await store(new ReconciliationPool()).reconcileStaleDryRun(identity());
  const staleClassification = stale.classifications.find((item) => item.work_id === SOURCE);
  assert.equal(staleClassification.timestamp_projection_drift, false);
  assert.equal(staleClassification.classification, "STALE");
  assert.deepEqual(staleClassification.allowed_actions, ["CANCEL", "SUPERSEDE"]);
});

test("stale dry-run suppresses actions when authoritative V1 time is invalid", async () => {
  const pool = new ReconciliationPool();
  pool.legacy.get(`tenant-a:${SOURCE}`).updated_at = "invalid";
  const dryRun = await store(pool).reconcileStaleDryRun(identity());
  const classification = dryRun.classifications.find((item) => item.work_id === SOURCE);
  assert.equal(classification.timestamp_projection_drift, true);
  assert.deepEqual(classification.allowed_actions, []);
  assert.equal(classification.owner_confirmation_required, false);
});

test("release-ready supersession requires exact same-project server closure evidence", async () => {
  const args = {
    work_id: SOURCE,
    action: "SUPERSEDE",
    expected_status: "release_ready",
    expected_classification: "STALE",
    reason: "A completed successor contains the authoritative release outcome.",
    successor_work_id: SUCCESSOR,
    idempotency_key: "supersede-release-ready-0001",
  };
  await assert.rejects(store(new ReconciliationPool({
    sourceStatus: "release_ready", sourceV2Status: "HANDOFF", successor: true,
  })).reconcileLegacyClosed(identity(), args), /legacy_release_ready_server_evidence_required/);

  const pool = new ReconciliationPool({
    sourceStatus: "release_ready", sourceV2Status: "HANDOFF", successor: true, successorEvidence: true,
  });
  const result = await store(pool).reconcileLegacyClosed(identity(), args);
  assert.equal(result.status, "SUPERSEDED");
  assert.equal(result.completed, false);
  assert.equal(result.server_evidence.source, "tenant_work_closure_receipt");
  assert.equal(pool.works.get(`tenant-a:${SOURCE}`).superseded_by_work_id, SUCCESSOR);
  assert.equal(pool.legacy.get(`tenant-a:${SOURCE}`).status, "superseded");
});

test("completed projection repair needs its own persisted finalization event and never re-executes", async () => {
  const args = {
    work_id: SOURCE,
    action: "REPAIR_COMPLETED_PROJECTION",
    expected_status: "completed",
    expected_classification: "COMPLETED_BUT_UNCLOSED",
    reason: "Project the already-finalized legacy closure into the V2 archive view.",
    idempotency_key: "repair-completed-projection-0001",
  };
  await assert.rejects(store(new ReconciliationPool({
    sourceStatus: "completed", sourceV2Status: "COMPLETED",
  })).reconcileLegacyClosed(identity(), args), /legacy_completed_server_evidence_required/);

  const pool = new ReconciliationPool({
    sourceStatus: "completed", sourceV2Status: "COMPLETED", sourceClosureEvidence: true,
  });
  const legacyUpdatedAt = pool.legacy.get(`tenant-a:${SOURCE}`).updated_at;
  const result = await store(pool).reconcileLegacyClosed(identity(), args);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.completed, true);
  assert.equal(result.closure_receipt_created, false);
  assert.equal(result.server_evidence.source, "legacy_closure_finalized_event");
  assert.equal(pool.works.get(`tenant-a:${SOURCE}`).closed_at, "2026-08-10T18:00:00.000Z");
  assert.equal(pool.legacy.get(`tenant-a:${SOURCE}`).updated_at, legacyUpdatedAt,
    "projection repair must not replay or rewrite the completed legacy Work");
  assert.equal(pool.calls.some((call) => call.sql.startsWith("UPDATE core_continuity_works SET status=$3")), false);
});
