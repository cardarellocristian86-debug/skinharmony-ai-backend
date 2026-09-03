import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createGenericWorkCoreJoinVerifier,
  createWorkContinuityV2Store,
  deriveAuthenticatedTenantWorkAcl,
  deriveTenantWorkClosureVerification,
} from "../src/work-continuity-v2-store.js";
import {
  createHostNativeFinalizeAuthorizationProof,
  createLocalGenericWorkCoreJoinSigner,
} from "../../universal-core-service/src/genericWorkCoreJoin.js";
import { createCoreHandlers } from "../src/core-handlers.js";
import { createWorkContinuityRuntime } from "../src/work-continuity-runtime.js";

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
async function manualClosureAuthority({ workId, intentDigest, repository = "owner/repo" } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const keyId = "gwcj-test-manual-closure";
  const signer = createLocalGenericWorkCoreJoinSigner({
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
    keyId,
  });
  const verifier = createGenericWorkCoreJoinVerifier({
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    keyId,
  });
  const receiptId = `hnmmr_${"6".repeat(40)}`;
  const receiptDigest = "7".repeat(64);
  const targetCommit = "9".repeat(40);
  const baseCommit = "1".repeat(40);
  const headCommit = "2".repeat(40);
  const sourceAction = {
    kind: "github.merge", repository, head_branch: "agent/manual-closure",
    base_branch: "main", pull_request: 390, head_commit: headCommit,
    expected_base_commit: baseCommit, checks_commit: headCommit,
    provider_execution: false,
  };
  const predecessor = {
    schema_version: "host_native_owner_manual_merge_predecessor_v2",
    predecessor_type: "owner_manual_github_merge_readback",
    manual_merge_readback_id: receiptId,
    manual_merge_readback_digest: receiptDigest,
    source_readback_digest: "3".repeat(64),
    core_join_verdict_id: `hnj_${"4".repeat(40)}`,
    core_join_record_digest: "5".repeat(64),
    result_commit: targetCommit,
    source_action: sourceAction,
    source_action_digest: stableDigest(sourceAction),
    source_evidence_digest: receiptDigest,
    source_required_checks_policy_digest: "8".repeat(64),
    retrospective_ticket_issued: false,
    provider_execution: false,
  };
  const githubUnsigned = {
    api_origin: "https://api.github.com", repository, action_kind: "render.observe",
    head_branch: sourceAction.head_branch, base_branch: "main", pull_request: 390,
    merged: true, head_commit: headCommit, expected_base_commit: baseCommit,
    merge_commit: targetCommit, target_commit: targetCommit, branch: "main",
    branch_commit: targetCommit, checks_commit: headCommit, checks_passed: true,
    required_checks: ["unit-tests"], observed_checks: [{
      name: "unit-tests", status: "completed", conclusion: "success",
      head_commit: headCommit,
    }], rollback_commit: "a".repeat(40), rollback_commit_available: true,
    source_action_kind: "github.merge", source_action_digest: stableDigest(sourceAction),
    manual_merge_readback_id: receiptId,
    manual_merge_readback_digest: receiptDigest,
    source_readback_digest: predecessor.source_readback_digest,
    required_checks_policy_digest: predecessor.source_required_checks_policy_digest,
  };
  const github = { ...githubUnsigned, readback_digest: stableDigest(githubUnsigned) };
  const serviceUnsigned = {
    service_id: "core", environment: "production",
    origin: "https://core.onrender.com", health_path: "/healthz",
    deployment_id: null, live_commit: targetCommit, version: null,
    health_status: "healthy", health_contract_digest: "b".repeat(64),
    previous_live_commit: "c".repeat(40), rollback_commit: "a".repeat(40),
    rollback_status: "previous_live_attested",
  };
  const service = { ...serviceUnsigned, readback_digest: stableDigest(serviceUnsigned) };
  const authorizationUnsigned = {
    schema_version: "host_native_finalize_authorization_v1",
    trusted: true, allowed: true, decision: "ALLOW_FINALIZE",
    decision_id: "hnt_manual-observe-12345678", tenant_id: "tenant-a", work_id: workId,
    repository, target_commit: targetCommit,
    action_ticket_id: "hnt_manual-observe-12345678",
    action_ticket_digest: "d".repeat(64), release_manifest_digest: "e".repeat(64),
    release_intent_digest: "f".repeat(64),
    core_join_verdict_id: predecessor.core_join_verdict_id,
    core_join_verdict_digest: "0".repeat(64), core_join_resolution_digest: "1".repeat(64),
    changed_files: ["services/core.js"], predecessor,
    predecessor_chain_digest: stableDigest(predecessor), evidence_digest: receiptDigest,
    host_kind: "codex_native", host_session_fingerprint: "c".repeat(64),
    host_result_digest: "2".repeat(64), host_readback_digest: "3".repeat(64),
    external_readback_digest: "4".repeat(64), readback_digest: "4".repeat(64),
    result_commit_verified: true, verification_scope: "full_release",
    services_verified: true, github_readback: github, live_services: [service],
    outcome_source: "verified_completion", readback_source: "core_server_external_readback_v1",
    issued_at: "2026-08-08T10:00:02.000Z", expires_at: "2026-08-08T10:05:02.000Z",
    host_policy_override: false, host_policy_must_allow: true,
    external_execution_allowed: false, host_execution_required: true,
    provider_execution: false,
  };
  const authorizationDigest = stableDigest(authorizationUnsigned);
  const authorization = {
    ...authorizationUnsigned, authorization_digest: authorizationDigest,
    signature: `hnf_${"5".repeat(64)}`,
  };
  const proof = await createHostNativeFinalizeAuthorizationProof({
    authorization,
    intentAnchorDigest: intentDigest,
    signer,
  });
  return { authorization, proof, verifier, signer, receiptId, receiptDigest };
}

class AtomicWorkPool {
  constructor() {
    this.reviews = new Map();
    this.bootstrapRequests = new Map();
    this.legacy = new Map();
    this.works = new Map();
    this.tasks = new Map();
    this.evidence = new Map();
    this.joins = new Map();
    this.closures = new Map();
    this.finalReports = new Map();
    this.coreEvents = new Map();
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
    return Object.fromEntries(["reviews", "bootstrapRequests", "legacy", "works", "tasks", "evidence", "joins", "closures", "finalReports", "coreEvents", "events", "reports", "sequences", "participants", "leases"]
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
        const queryText = typeof sql === "string" ? sql : sql.text;
        const normalized = queryText.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN") { snapshot = pool.snapshot(); return { rows: [], rowCount: 0 }; }
        if (normalized === "COMMIT") { snapshot = null; return { rows: [], rowCount: 0 }; }
        if (normalized === "ROLLBACK") { if (snapshot) pool.restore(snapshot); snapshot = null; return { rows: [], rowCount: 0 }; }
        if (normalized.startsWith("SET LOCAL ")) return { rows: [], rowCount: 0 };
        return pool.query(queryText, parameters);
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
    const queryText = typeof sql === "string" ? sql : sql.text;
    const q = queryText.replace(/\s+/g, " ").trim();
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
    if (q.startsWith("SELECT legacy_work_id FROM tenant_work")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      return {
        rows: row ? [{ legacy_work_id: row.legacy_work_id || null }] : [],
        rowCount: row ? 1 : 0,
      };
    }
    if (q.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND (legacy_work_id=$2 OR work_id=$2)")) {
      const rows = [...this.works.values()].filter((work) => work.tenant_id === parameters[0] &&
        (work.legacy_work_id === parameters[1] || work.work_id === parameters[1]));
      return { rows: structuredClone(rows), rowCount: rows.length };
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
    if (q.startsWith("SELECT anchor,intent_digest FROM core_continuity_intent_anchors")) {
      const row = this.legacy.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone({ anchor: row.anchor || null,
        intent_digest: row.intent_digest || null })] : [], rowCount: row ? 1 : 0 };
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
    if (q.startsWith("UPDATE tenant_work SET status=$3::varchar,next_action=$4")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      if (!row || Number(row.legacy_projection_sequence || 0) >= Number(parameters[5])) {
        return { rows: [], rowCount: 0 };
      }
      Object.assign(row, {
        status: parameters[2],
        next_action: parameters[3],
        updated_at: Date.parse(row.updated_at) > Date.parse(parameters[4])
          ? row.updated_at
          : parameters[4],
        legacy_projection_sequence: parameters[5],
        legacy_projection_event_hash: parameters[6],
        legacy_projection_updated_at: parameters[7],
      });
      if (parameters[8].includes(row.status)) {
        row.closed_at ||= parameters[4];
        row.archived_at ||= parameters[4];
      }
      return { rows: [structuredClone(row)], rowCount: 1 };
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
      const rows = [];
      for (const lease of this.leases.values()) {
        if (lease.tenant_id === parameters[0] && lease.work_id === parameters[1] &&
            lease.status === "active") {
          lease.status = "released";
          lease.released_at ||= "2026-08-08T10:00:03.000Z";
          lease.expires_at = "2026-08-08T10:00:03.000Z";
          rows.push({ lease_id: lease.lease_id });
        }
      }
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("UPDATE core_continuity_participants SET status='closed'")) {
      const rows = [];
      for (const participant of this.participants.values()) {
        if (participant.tenant_id === parameters[0] &&
            participant.work_id === parameters[1] && participant.status === "active") {
          participant.status = "closed";
          participant.last_seen_at = "2026-08-08T10:00:03.000Z";
          participant.expires_at = "2026-08-08T10:00:03.000Z";
          rows.push({ session_id: participant.session_id });
        }
      }
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("SELECT work_id,title,weight,status,required FROM tenant_work_task")) {
      const row = this.tasks.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO tenant_work_task")) {
      const taskKey = key(parameters[0], parameters[1]);
      const previous = this.tasks.get(taskKey);
      if (q.includes("ON CONFLICT (tenant_id,task_id)") && previous &&
          previous.work_id !== parameters[2]) {
        return { rows: [], rowCount: 0 };
      }
      const row = { ...(previous || {}), tenant_id: parameters[0], task_id: parameters[1],
        work_id: parameters[2], title: parameters[3], weight: parameters[4],
        status: q.includes("ON CONFLICT (tenant_id,task_id)") ? parameters[5] : "planned",
        required: q.includes("ON CONFLICT (tenant_id,task_id)") ? parameters[6] : parameters[5],
        acceptance_verified: previous?.acceptance_verified || false };
      this.tasks.set(key(row.tenant_id, row.task_id), row);
      return { rows: q.includes("RETURNING work_id") ? [{ work_id: row.work_id }] : [], rowCount: 1 };
    }
    if (q.startsWith("SELECT evidence_id,digest,metadata FROM tenant_work_evidence")) {
      const row = [...this.evidence.values()].find((item) =>
        item.tenant_id === parameters[0] && item.work_id === parameters[1] &&
        item.kind === "owner_manual_merge_release" &&
        item.metadata?.manual_merge_readback_id === parameters[2]);
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT work_id,kind,digest,required, independently_verified")) {
      const row = this.evidence.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO tenant_work_evidence")) {
      const evidenceKey = key(parameters[0], parameters[1]);
      if (q.includes("ON CONFLICT (tenant_id,evidence_id)") && this.evidence.has(evidenceKey)) {
        return { rows: [], rowCount: 0 };
      }
      const genericCandidate = q.includes("ON CONFLICT (tenant_id,evidence_id)");
      const row = genericCandidate ? {
        tenant_id: parameters[0], evidence_id: parameters[1], work_id: parameters[2],
        kind: parameters[3], digest: parameters[4], required: parameters[5],
        independently_verified: parameters[6], verified_by_agent_id: parameters[7],
        verified_by_session_fingerprint: parameters[8], weight: parameters[9],
        metadata: JSON.parse(parameters[10]), created_at: "2026-08-08T10:00:02.000Z",
      } : {
        tenant_id: parameters[0], evidence_id: parameters[1], work_id: parameters[2],
        kind: "owner_manual_merge_release", digest: parameters[3], required: true,
        independently_verified: true, verified_by_agent_id: parameters[4],
        verified_by_session_fingerprint: parameters[5], weight: 1,
        metadata: JSON.parse(parameters[6]), created_at: "2026-08-08T10:00:02.000Z",
      };
      this.evidence.set(key(row.tenant_id, row.evidence_id), row);
      return { rows: q.includes("RETURNING work_id") ? [{ work_id: row.work_id }] : [], rowCount: 1 };
    }
    if (q.startsWith("SELECT * FROM tenant_work_evidence")) {
      const rows = [...this.evidence.values()].filter((item) =>
        item.tenant_id === parameters[0] && item.work_id === parameters[1] &&
        (!q.includes("required=true") || item.required === true));
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT * FROM tenant_work_task")) {
      const rows = [...this.tasks.values()].filter((item) =>
        item.tenant_id === parameters[0] && item.work_id === parameters[1] &&
        (!q.includes("required=true") || item.required === true))
        .sort((left, right) => String(left.task_id).localeCompare(String(right.task_id)));
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT status,acceptance_verified FROM tenant_work_task")) {
      const rows = [...this.tasks.values()].filter((item) =>
        item.tenant_id === parameters[0] && item.work_id === parameters[1] &&
        item.required === true).map(({ status, acceptance_verified }) =>
        ({ status, acceptance_verified }));
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT title,weight,status,required,acceptance_verified FROM tenant_work_task")) {
      const rows = [...this.tasks.values()].filter((item) =>
        item.tenant_id === parameters[0] && item.work_id === parameters[1]);
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT weight,required,independently_verified FROM tenant_work_evidence")) {
      const rows = [...this.evidence.values()].filter((item) =>
        item.tenant_id === parameters[0] && item.work_id === parameters[1]);
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT core_join_digest FROM tenant_work_core_join")) {
      const row = this.joins.get(key(parameters[0], parameters[1]));
      return { rows: row ? [{ core_join_digest: row.core_join_digest }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT count(*) FILTER (WHERE parent_work_id=$2")) {
      const operational = new Set(parameters[2]);
      const rows = [...this.works.values()].filter((work) => work.tenant_id === parameters[0]);
      return { rows: [{
        dependent_work_count: rows.filter((work) => work.parent_work_id === parameters[1] &&
          operational.has(work.status)).length,
        blocking_dependencies: rows.filter((work) => work.work_id === parameters[3] &&
          operational.has(work.status)).length,
      }], rowCount: 1 };
    }
    if (q.startsWith("UPDATE tenant_work SET progress_bp=$3")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      if (!row) return { rows: [], rowCount: 0 };
      Object.assign(row, {
        progress_bp: parameters[2], progress_version: parameters[3], progress_source: parameters[4],
        priority: parameters[5], priority_score: parameters[6], priority_version: parameters[7],
        priority_context: JSON.parse(parameters[8]), updated_at: "2026-08-08T10:00:03.000Z",
      });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT * FROM tenant_work_core_join")) {
      const row = this.joins.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT * FROM tenant_work_closure_receipt")) {
      const row = this.closures.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO tenant_work_closure_receipt")) {
      const row = { tenant_id: parameters[0], receipt_id: parameters[1],
        work_id: parameters[2], adapter: parameters[3], core_join_digest: parameters[4],
        final_evidence_digest: parameters[5], receipt_digest: parameters[6] };
      this.closures.set(key(row.tenant_id, row.work_id), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_final_report")) {
      const row = { tenant_id: parameters[0], work_id: parameters[1],
        report: JSON.parse(parameters[2]), report_digest: parameters[3] };
      this.finalReports.set(key(row.tenant_id, row.work_id), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT tenant_id,work_id,report,report_digest,created_at FROM tenant_work_final_report")) {
      const row = this.finalReports.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("UPDATE tenant_work SET status='COMPLETED'")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      if (!row) return { rows: [], rowCount: 0 };
      Object.assign(row, { status: "COMPLETED", closed_at: parameters[2],
        archived_at: parameters[2], final_evidence_digest: parameters[3],
        closure_type: parameters[4], closure_reason: "acceptance_criteria_verified",
        progress_bp: 10000, updated_at: "2026-08-08T10:00:03.000Z" });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_works SET status='completed'")) {
      const row = this.legacy.get(key(parameters[0], parameters[1]));
      if (row) Object.assign(row, { status: "completed", next_action: "",
        updated_at: "2026-08-08T10:00:03.000Z" });
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT sequence_number,event_hash FROM core_continuity_events")) {
      const rows = [...this.coreEvents.values()].filter((event) =>
        event.tenant_id === parameters[0] && event.work_id === parameters[1])
        .sort((a, b) => a.sequence_number - b.sequence_number);
      return { rows: rows.length ? [structuredClone(rows.at(-1))] : [],
        rowCount: rows.length ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO core_continuity_events")) {
      const row = { tenant_id: parameters[0], work_id: parameters[1],
        event_id: parameters[2], sequence_number: parameters[3], event_type: parameters[4],
        payload: JSON.parse(parameters[5]), previous_event_hash: parameters[6],
        event_hash: parameters[7], created_by: parameters[8] };
      this.coreEvents.set(key(row.tenant_id, row.event_id), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT status FROM core_continuity_works")) {
      const row = this.legacy.get(key(parameters[0], parameters[1]));
      return { rows: row ? [{ status: row.status }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT work_id FROM core_continuity_works")) {
      const row = this.legacy.get(key(parameters[0], parameters[1]));
      return { rows: row ? [{ work_id: row.work_id }] : [], rowCount: row ? 1 : 0 };
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
    if (q.startsWith("SELECT tenant_id,work_id,sequence_number,event_type,payload,previous_event_hash,event_hash FROM tenant_work_event")) {
      const rows = [...this.events.values()].filter((event) =>
        event.tenant_id === parameters[0] && event.work_id === parameters[1] &&
        event.event_type === "generic_closure_finalized")
        .sort((left, right) => Number(right.sequence_number) - Number(left.sequence_number));
      return { rows: rows.length ? [structuredClone(rows[0])] : [],
        rowCount: rows.length ? 1 : 0 };
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
    if (q.startsWith("SELECT w.tenant_id,w.work_id,w.project_id,w.parent_work_id")) {
      const rows = [...this.legacy.values()].slice(0, parameters[0]);
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

class LockAwareIntegratedWorkPool extends AtomicWorkPool {
  constructor() {
    super();
    this.idempotency = new Map();
    this.coreRowLocks = new Map();
    this.nextClientId = 0;
    this.firstCoreLockObserved = new Promise((resolve) => {
      this.resolveFirstCoreLockObserved = resolve;
    });
    this.secondCoreLockWaiting = new Promise((resolve) => {
      this.resolveSecondCoreLockWaiting = resolve;
    });
    this.firstCoreLockGate = new Promise((resolve) => {
      this.releaseFirstCoreLockGate = resolve;
    });
    this.firstCoreLockPaused = false;
    this.secondCoreLockSignalled = false;
  }

  async acquireCoreRowLock(clientId, lockKey) {
    let lock = this.coreRowLocks.get(lockKey);
    if (!lock) {
      lock = { owner: null, waiters: [] };
      this.coreRowLocks.set(lockKey, lock);
    }
    while (lock.owner !== null && lock.owner !== clientId) {
      if (!this.secondCoreLockSignalled) {
        this.secondCoreLockSignalled = true;
        this.resolveSecondCoreLockWaiting();
      }
      await new Promise((resolve) => lock.waiters.push(resolve));
    }
    lock.owner = clientId;
    if (!this.firstCoreLockPaused) {
      this.firstCoreLockPaused = true;
      this.resolveFirstCoreLockObserved();
      await this.firstCoreLockGate;
    }
  }

  releaseCoreRowLocks(clientId) {
    for (const lock of this.coreRowLocks.values()) {
      if (lock.owner !== clientId) continue;
      lock.owner = null;
      const waiter = lock.waiters.shift();
      waiter?.();
    }
  }

  async connect() {
    const pool = this;
    const clientId = ++this.nextClientId;
    return {
      async query(sql, parameters = []) {
        const queryText = typeof sql === "string" ? sql : sql.text;
        const normalized = queryText.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN") return { rows: [], rowCount: 0 };
        if (normalized === "COMMIT" || normalized === "ROLLBACK") {
          pool.releaseCoreRowLocks(clientId);
          return { rows: [], rowCount: 0 };
        }
        if (
          normalized.includes("FROM core_continuity_works") &&
          normalized.includes("FOR UPDATE") &&
          (normalized.startsWith("SELECT work_id") || normalized.startsWith("SELECT status"))
        ) {
          await pool.acquireCoreRowLock(clientId, key(parameters[0], parameters[1]));
        }
        if (normalized.startsWith("SET LOCAL ")) return { rows: [], rowCount: 0 };
        return pool.query(queryText, parameters);
      },
      release() {
        pool.releaseCoreRowLocks(clientId);
      },
    };
  }

  async query(sql, parameters = []) {
    const queryText = typeof sql === "string" ? sql : sql.text;
    const normalized = queryText.replace(/\s+/g, " ").trim();
    if (normalized.includes("CREATE TABLE IF NOT EXISTS core_continuity_works")) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("SELECT operation,request_digest,result FROM core_continuity_idempotency")) {
      const row = this.idempotency.get(key(parameters[0], parameters[1], parameters[2]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (normalized.startsWith("SELECT work_id FROM core_continuity_works")) {
      const row = this.legacy.get(key(parameters[0], parameters[1]));
      return { rows: row ? [{ work_id: row.work_id }] : [], rowCount: row ? 1 : 0 };
    }
    return super.query(queryText, parameters);
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

function candidateWork(index, overrides = {}) {
  const suffix = String(index).padStart(12, "0");
  return {
    tenant_id: "tenant-a", work_id: `00000000-0000-4000-8000-${suffix}`, legacy_work_id: null,
    work_code: `NYRA-20260808-${String(index).padStart(4, "0")}`,
    work_name: `Unrelated candidate ${index}`, work_type: "generic", project_id: "nyra-core",
    owner_user_id: "owner", created_by_user_id: "owner", assigned_user_ids: [],
    supervising_user_ids: [], agent_ids: [], visibility_scope: "private", status: "ACTIVE",
    priority: "P4", priority_score: 0, progress_bp: 0, next_action: "continue",
    updated_at: "2026-08-08T10:00:00.000Z",
    ...overrides,
  };
}

function boundedUniqueText(prefix, index, length) {
  const marker = `${prefix}-${String(index).padStart(3, "0")}-`;
  return `${marker}${"x".repeat(length - marker.length)}`;
}

function fixtureLegacyAnchor(input) {
  return {
    schema_version: "intent_anchor_v1",
    initial_message: "transaction fixture bootstrap",
    idea: input.idea,
    objective: input.objective,
    acceptance_criteria: input.acceptance_criteria,
    constraints: input.constraints || [],
    source: { client_type: input.client_type || "codex", session_id: input.session_id },
    immutable: true,
  };
}

function legacyRuntime(pool) {
  return { initialize: async () => {}, ensureWithClient: async (client, who, input) => {
    const row = client.insertLegacy(who, input);
    row.anchor = fixtureLegacyAnchor(input);
    row.intent_digest = stableDigest(row.anchor);
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

test("V2 UUID inputs canonicalize before persistence and event hashing", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:00:00.000Z"),
  });
  const uppercaseWorkId = "ABCDEF12-3456-4ABC-8DEF-ABCDEF123456";
  const canonicalWorkId = uppercaseWorkId.toLowerCase();
  const created = await store.createWork(identity(), {
    ...createInput(),
    work_id: uppercaseWorkId,
  });
  const createdEvent = [...pool.events.values()].find((event) =>
    event.event_type === "work_v2_created");

  assert.equal(created.work_id, canonicalWorkId);
  assert.equal(createdEvent.work_id, canonicalWorkId);
  assert.equal(createdEvent.event_hash, stableDigest({
    tenant_id: createdEvent.tenant_id,
    work_id: canonicalWorkId,
    sequence_number: createdEvent.sequence_number,
    event_type: createdEvent.event_type,
    payload: createdEvent.payload,
    previous_event_hash: createdEvent.previous_event_hash,
  }));
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

for (const staleShape of ["legacy", "expired"]) {
  test(`unconsumed ${staleShape} open review is refreshed under its durable request binding`, async () => {
    const pool = new AtomicWorkPool();
    let current = new Date("2026-08-08T10:00:00.000Z");
    const store = createWorkContinuityV2Store({
      pool,
      legacyRuntime: legacyRuntime(pool),
      now: () => current,
    });
    const request = {
      ...createInput(),
      request_id: `request-refresh-${staleShape}`,
      session_id: `session-refresh-${staleShape}`,
    };
    const first = await store.openWorkReview(identity(), {
      intent_type: "CREATE_WORK",
      request: request.objective,
      create_request: request,
    });
    const stored = pool.reviews.get(key("tenant-a", first.review_id));
    if (staleShape === "legacy") {
      const { resolution_contract: _legacyContract, ...legacyResult } =
        stored.review_result;
      stored.review_result = legacyResult;
    } else {
      current = new Date("2026-08-08T10:20:00.000Z");
    }
    const refreshed = await store.openWorkReview(identity(), {
      intent_type: "CREATE_WORK",
      request: request.objective,
      create_request: request,
    });
    assert.notEqual(refreshed.review_id, first.review_id);
    assert.equal(refreshed.idempotent_replay, false);
    assert.equal(refreshed.consumed, false);
    assert.match(refreshed.resolution_contract.contract_digest, /^[a-f0-9]{64}$/);
    assert.equal(pool.reviews.size, 2, "stale review remains append-only audit evidence");
    assert.equal(
      pool.bootstrapRequests.get(key("tenant-a", "owner", request.request_id)).review_id,
      refreshed.review_id,
    );
  });
}

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

test("separates canonical V2 intent from the legacy anchor and replays the historical encoding safely", async () => {
  const pool = new AtomicWorkPool();
  const legacyAnchor = {
    schema_version: "intent_anchor_v1",
    initial_message: "legacy bootstrap",
    idea: "Atomic work",
    objective: "Create legacy and V2 atomically",
    acceptance_criteria: ["atomic"],
    constraints: [],
    source: { client_type: "codex", session_id: "session-001" },
    immutable: true,
  };
  const legacyIntentDigest = stableDigest(legacyAnchor);
  const divergentLegacyRuntime = {
    initialize: async () => {},
    ensureWithClient: async (client, who, input) => {
      const row = client.insertLegacy(who, input);
      row.anchor = legacyAnchor;
      row.intent_digest = legacyIntentDigest;
      return { work_id: row.work_id, intent_digest: legacyIntentDigest,
        event: { event_hash: "b".repeat(64) } };
    },
  };
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: divergentLegacyRuntime,
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = await reviewed(store, createInput());
  const created = await store.createNewWork(identity(), {
    ...input,
    _core_authorization_receipt: coreAuthorizationReceipt(),
  });
  const createdEvent = [...pool.events.values()].find((event) =>
    event.event_type === "work_v2_created");

  assert.equal(created.work.intent_digest, input.intent_digest);
  assert.equal(createdEvent.payload.intent_digest, input.intent_digest);
  assert.equal(createdEvent.payload.legacy_intent_digest, legacyIntentDigest);

  // Recreate the immutable event shape emitted by the previous writer: its
  // intent_digest contained the legacy anchor and had no separate legacy field.
  const historicalPayload = { ...createdEvent.payload, intent_digest: legacyIntentDigest };
  delete historicalPayload.legacy_intent_digest;
  createdEvent.payload = historicalPayload;
  createdEvent.event_hash = stableDigest({
    tenant_id: createdEvent.tenant_id,
    work_id: createdEvent.work_id,
    sequence_number: createdEvent.sequence_number,
    event_type: createdEvent.event_type,
    payload: historicalPayload,
    previous_event_hash: createdEvent.previous_event_hash,
  });
  pool.databaseNow = "2026-08-08T10:05:00.000Z";
  const replay = await store.readCreatedWorkByBootstrapRequest(identity(), input);
  assert.equal(replay.work.intent_digest, input.intent_digest);
  assert.equal(replay.replay_source, "durable_bootstrap_mapping");

  createdEvent.payload.intent_digest = "f".repeat(64);
  createdEvent.event_hash = stableDigest({
    tenant_id: createdEvent.tenant_id,
    work_id: createdEvent.work_id,
    sequence_number: createdEvent.sequence_number,
    event_type: createdEvent.event_type,
    payload: createdEvent.payload,
    previous_event_hash: createdEvent.previous_event_hash,
  });
  await assert.rejects(
    store.readCreatedWorkByBootstrapRequest(identity(), input),
    /work_bootstrap_replay_evidence_invalid/,
  );
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

  const expectedIntentDigest = stableDigest(fixtureLegacyAnchor(input));
  assert.equal(created.work.intent_digest, expectedIntentDigest);
  pool.databaseNow = "2026-08-08T10:05:00.000Z";
  const replay = await store.readCreatedWorkByBootstrapRequest(identity(), input);
  assert.equal(replay.work.work_id, created.work.work_id);
  assert.equal(replay.work.intent_digest, expectedIntentDigest);
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
  await store.projectLegacyCatalog(identity(), { project_id: input.project_id });
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

test("archiving an unbridged V2 Work never releases an identically named Core lease", async () => {
  const pool = new AtomicWorkPool();
  const workId = "62626262-6262-4262-8262-626262626262";
  const leaseId = "63636363-6363-4363-8363-636363636363";
  pool.works.set(key("tenant-a", workId), candidateWork(114, {
    work_id: workId, legacy_work_id: null, status: "PLANNED",
  }));
  pool.legacy.set(key("tenant-a", workId), {
    tenant_id: "tenant-a", work_id: workId, project_id: "foreign-core-project",
    status: "active", next_action: "retain lease",
    updated_at: "2026-08-08T10:00:00.000Z",
  });
  pool.leases.set(key("tenant-a", workId, leaseId), {
    tenant_id: "tenant-a", work_id: workId, lease_id: leaseId,
    status: "active", expires_at: "2026-08-08T11:00:00.000Z",
  });
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:00:03.000Z"),
  });

  const archived = await store.archiveWork(identity(), {
    work_id: workId, reason: "Archive only the V2 identity.",
    idempotency_key: "archive-core-namespace-collision",
  });
  const replay = await store.archiveWork(identity(), {
    work_id: workId, reason: "Archive only the V2 identity.",
    idempotency_key: "archive-core-namespace-collision",
  });

  assert.equal(archived.released_lease_count, 0);
  assert.equal(replay.released_lease_count, 0);
  assert.equal(pool.leases.get(key("tenant-a", workId, leaseId)).status, "active");
  assert.equal(pool.legacy.get(key("tenant-a", workId)).status, "active");
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

test("Gallery V3 rejects a caller-supplied Work id owned by the Core namespace", async () => {
  const pool = new AtomicWorkPool();
  const collisionId = "61616161-6161-4161-8161-616161616161";
  pool.legacy.set(key("tenant-a", collisionId), {
    tenant_id: "tenant-a", work_id: collisionId, project_id: "other-core-project",
    status: "active", next_action: "remain separate",
    updated_at: "2026-08-08T10:00:00.000Z",
  });
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:00:00.000Z"),
  });
  const candidate = {
    ...createInput(), request_id: "request-core-namespace-collision",
    work_id: collisionId, work_name: "Native V2 collision",
    idea: "Must not alias a Core Work", objective: "Keep namespaces disjoint",
  };
  const input = await reviewed(store, candidate);

  await assert.rejects(store.queueNewWork(identity(), input),
    /tenant_work_core_id_collision/);
  const namespaceLock = pool.queryParameters.findIndex((call) =>
    call.sql.startsWith("SELECT pg_advisory_xact_lock") &&
    call.parameters[0] === "tenant-a" && call.parameters[1] === collisionId);
  const coreCollisionRead = pool.queries.findIndex((query) =>
    query.startsWith("SELECT work_id FROM core_continuity_works"));
  assert.ok(namespaceLock >= 0 && namespaceLock < coreCollisionRead,
    "V2 must own the shared namespace lock before checking Core");
  assert.equal(pool.works.size, 0);
  assert.equal(pool.reviews.get(key("tenant-a", input.review_id)).consumed_at, null);
  assert.equal(pool.legacy.get(key("tenant-a", collisionId)).status, "active");
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

test("an unchanged bounded review survives a different database row order", async () => {
  const pool = new AtomicWorkPool();
  for (let index = 1; index <= 6; index += 1) {
    const work = candidateWork(index);
    pool.works.set(key(work.tenant_id, work.work_id), work);
  }
  let resolutionReads = 0;
  const originalQuery = pool.query.bind(pool);
  pool.query = async (sql, parameters) => {
    const result = await originalQuery(sql, parameters);
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND status = ANY")) {
      resolutionReads += 1;
      if (resolutionReads > 1) result.rows.reverse();
    }
    return result;
  };
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const request = createInput();
  const review = await store.openWorkReview(identity(), {
    intent_type: "CREATE_WORK", request: `${request.work_name} ${request.objective}`,
    create_request: request,
  });

  assert.deepEqual(review.candidates.map((candidate) => candidate.work_id),
    [1, 2, 3, 4, 5].map((index) => candidateWork(index).work_id));
  assert.equal(review.requires_owner_decision, true);
  const created = await store.createNewWork(identity(), {
    ...request,
    review_id: review.review_id,
    review_digest: review.review_digest,
    review_decision: "PARALLEL_VALID",
  });
  assert.equal(created.review.decision, "PARALLEL_VALID");
  assert.equal(pool.reviews.get(key("tenant-a", review.review_id)).consumed_at !== null, true);
  const canonicalReads = pool.queries.filter((query) =>
    query.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND status = ANY"));
  assert.equal(canonicalReads.length, 2);
  assert.equal(new Set(canonicalReads).size, 1,
    "review persistence and consumption must use the same canonical Work query");
  assert.match(canonicalReads[0], /ORDER BY work_id ASC$/);
});

test("review consumption reuses the persisted resolver query when create text diverges", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = {
    ...createInput(), request_id: "request-divergent-resolver", session_id: "session-divergent-resolver",
    work_name: "Create-only collision beta",
    objective: "A deliberately different create payload",
  };
  const resolverQuery = "Resolver-only incident alpha Preserve the original lexical boundary";
  const review = await store.openWorkReview(identity(), {
    intent_type: "CREATE_WORK", request: resolverQuery, create_request: input,
  });
  assert.equal(review.requires_owner_decision, false);
  assert.equal(review.resolution_contract.resolver_query, resolverQuery);
  assert.match(review.resolution_contract.resolver_query_digest, /^[a-f0-9]{64}$/);
  assert.match(review.resolution_contract.work_projection_digest, /^[a-f0-9]{64}$/);
  assert.match(review.resolution_contract.contract_digest, /^[a-f0-9]{64}$/);

  const createOnlyCollision = candidateWork(2, {
    project_id: "different-project",
    work_name: input.work_name,
    objective: input.objective,
  });
  pool.works.set(key(createOnlyCollision.tenant_id, createOnlyCollision.work_id), createOnlyCollision);
  const created = await store.createNewWork(identity(), {
    ...input,
    review_id: review.review_id,
    review_digest: review.review_digest,
  });
  assert.equal(created.review.decision, "NO_CONFLICT_PROCEED");
});

test("a new conflict against the persisted resolver query invalidates the review", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = {
    ...createInput(), request_id: "request-new-resolver-conflict", session_id: "session-new-resolver-conflict",
    work_name: "Create payload remains unrelated",
    objective: "The resolver query is the durable conflict boundary",
  };
  const resolverQuery = "Fresh resolver conflict gamma";
  const review = await store.openWorkReview(identity(), {
    intent_type: "CREATE_WORK", request: resolverQuery, create_request: input,
  });
  assert.equal(review.requires_owner_decision, false);
  const conflict = candidateWork(3, {
    work_name: resolverQuery,
    objective: "A Work created after the open review",
  });
  pool.works.set(key(conflict.tenant_id, conflict.work_id), conflict);

  await assert.rejects(store.createNewWork(identity(), {
    ...input,
    review_id: review.review_id,
    review_digest: review.review_digest,
  }), /open_work_review_stale_conflict/);
  assert.equal(pool.reviews.get(key("tenant-a", review.review_id)).consumed_at, null);
});

test("review consumption fails closed when the persisted resolver contract is altered", async () => {
  const pool = new AtomicWorkPool();
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = createInput();
  const review = await store.openWorkReview(identity(), {
    intent_type: "CREATE_WORK", request: "Immutable resolver text", create_request: input,
  });
  const stored = pool.reviews.get(key("tenant-a", review.review_id));
  stored.review_result = {
    ...stored.review_result,
    resolution_contract: {
      ...stored.review_result.resolution_contract,
      resolver_query: "Substituted resolver text",
    },
  };
  await assert.rejects(store.openWorkReview(identity(), {
    intent_type: "CREATE_WORK", request: "Immutable resolver text", create_request: input,
  }), /open_work_review_resolution_contract_invalid/);
  await assert.rejects(store.createNewWork(identity(), {
    ...input, review_id: review.review_id, review_digest: review.review_digest,
  }), /open_work_review_resolution_contract_invalid/);
  assert.equal(pool.legacy.size, 0);
});

test("an unchanged visible cross-project candidate does not invalidate a project-scoped review", async () => {
  const pool = new AtomicWorkPool();
  const crossProject = candidateWork(1, {
    project_id: "other-project",
    work_name: "Continuity transaction",
    next_action: "Create legacy and V2 atomically",
  });
  pool.works.set(key(crossProject.tenant_id, crossProject.work_id), crossProject);
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const request = createInput();
  const review = await store.openWorkReview(identity(), {
    intent_type: "CREATE_WORK", request: `${request.work_name} ${request.objective}`,
    create_request: request,
  });

  assert.equal(review.classification, "CONTINUE_EXISTING",
    "the resolver must see the visible lexical match before project projection");
  assert.deepEqual(review.candidates, [],
    "the persisted candidate projection remains bounded to the requested project");
  assert.equal(review.requires_owner_decision, true);
  const created = await store.createNewWork(identity(), {
    ...request,
    review_id: review.review_id,
    review_digest: review.review_digest,
    review_decision: "CONTINUE_NEW_WORK",
  });
  assert.equal(created.review.decision, "CONTINUE_NEW_WORK");
  assert.equal(pool.reviews.get(key("tenant-a", review.review_id)).consumed_at !== null, true);
});

test("a genuinely new top-five candidate still invalidates an open review", async () => {
  const pool = new AtomicWorkPool();
  for (let index = 1; index <= 5; index += 1) {
    const work = candidateWork(index);
    pool.works.set(key(work.tenant_id, work.work_id), work);
  }
  const store = createWorkContinuityV2Store({ pool, legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:00.000Z") });
  const input = await reviewed(store, createInput());
  const newCandidate = candidateWork(0);
  pool.works.set(key(newCandidate.tenant_id, newCandidate.work_id), newCandidate);

  await assert.rejects(store.createNewWork(identity(), {
    ...input,
    review_decision: "PARALLEL_VALID",
  }), /open_work_review_stale_conflict/);
  assert.equal(pool.reviews.get(key("tenant-a", input.review_id)).consumed_at, null);
  assert.equal(pool.legacy.size, 0);
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

test("preflight is a pure projection read and ignores legacy-only rows", async () => {
  const pool = new AtomicWorkPool();
  const legacyId = "22222222-2222-4222-8222-222222222222";
  pool.legacy.set(key("tenant-a", legacyId), { tenant_id: "tenant-a", work_id: legacyId,
    project_id: "nyra-core", parent_work_id: null, idea: "Legacy continuity", objective: "project safely",
    status: "active", next_action: "resume", created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-08T09:00:00.000Z", source_sequence_number: 1,
    source_event_type: "work_created", source_event_hash: "a".repeat(64), source_event_payload: {} });
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-08T10:00:00.000Z") });
  const stateBefore = pool.snapshot();
  const gallery = await store.preflightGallery(identity(), { project_id: "nyra-core" });
  assert.equal(gallery.schema_version, "tenant_work_gallery_v1");
  assert.equal(gallery.source_schema_version, "work_continuity_v2");
  assert.deepEqual(gallery.works, []);
  assert.deepEqual(pool.snapshot(), stateBefore,
    "an owner preflight must not create a projection or append an event");
  assert.equal(pool.queries.some((query) => query.includes("FROM core_continuity_works")), false,
    "preflight must not scan the legacy writer source");
  assert.equal(pool.queries.every((query) => query.startsWith("SELECT ")), true,
    `preflight issued a non-read query: ${pool.queries.join(" | ")}`);
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
  await store.projectLegacyCatalog(identity(), { project_id: "nyra-core" });
  const source = pool.legacy.get(key("tenant-a", legacyId));
  Object.assign(source, { status: "release_ready", next_action: "release", updated_at: "2026-08-08T10:01:00.000Z",
    source_sequence_number: 2, source_event_type: "core_join_issued",
    source_event_hash: "b".repeat(64), source_event_payload: {} });
  await store.projectLegacyCatalog(identity(), { project_id: "nyra-core" });
  const first = await store.preflightGallery(identity(), { project_id: "nyra-core" });
  assert.equal(first.works[0].status, "release_ready");
  assert.equal(pool.works.get(key("tenant-a", legacyId)).status, "HANDOFF");
  assert.equal(pool.works.get(key("tenant-a", legacyId)).legacy_projection_sequence, 2);
  const eventCount = pool.events.size;
  await store.projectLegacyCatalog(identity(), { project_id: "nyra-core" });
  assert.equal(pool.events.size, eventCount, "same authoritative event must not append another projection event");
});

test("linked V2 projection advances operational state without replacing canonical identity", async () => {
  const pool = new AtomicWorkPool();
  const legacyId = "77777777-7777-4777-8777-777777777777";
  const canonical = candidateWork(77, {
    work_id: legacyId,
    legacy_work_id: legacyId,
    work_name: "Canonical V2 delivery",
    work_type: "software_git",
    project_id: "canonical-project",
    owner_user_id: "owner",
    created_by_user_id: "owner",
    intent_digest: "d".repeat(64),
    idea: "Canonical idea",
    objective: "Canonical objective",
    acceptance_criteria: ["canonical criterion"],
    architecture: { runtime: { service: "canonical" } },
    status: "ACTIVE",
    next_action: "canonical next action",
    updated_at: "2026-08-08T10:00:00.000Z",
    legacy_projection_sequence: 1,
    legacy_projection_event_hash: "a".repeat(64),
    legacy_projection_updated_at: "2026-08-08T10:00:00.000Z",
  });
  pool.works.set(key("tenant-a", legacyId), canonical);
  const source = {
    tenant_id: "tenant-a",
    work_id: legacyId,
    project_id: "legacy-project-must-not-win",
    parent_work_id: null,
    idea: "Legacy name must not win",
    objective: "Legacy objective must not win",
    status: "blocked",
    next_action: "resolve the projected blocker",
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-08T10:01:00.000Z",
    source_sequence_number: 2,
    source_event_type: "incident_recorded",
    source_event_hash: "b".repeat(64),
    source_event_payload: {},
  };
  pool.legacy.set(key("tenant-a", legacyId), source);
  const canonicalFields = [
    "work_id", "legacy_work_id", "work_code", "work_name", "work_type", "project_id",
    "owner_user_id", "created_by_user_id", "intent_digest", "idea", "objective",
    "acceptance_criteria", "architecture",
  ];
  const selectCanonicalFields = (work) => Object.fromEntries(
    canonicalFields.map((field) => [field, structuredClone(work[field])]),
  );
  const before = selectCanonicalFields(canonical);
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:02:00.000Z"),
  });

  await store.projectLegacyCatalog(identity(), { project_id: source.project_id });

  const projected = pool.works.get(key("tenant-a", legacyId));
  assert.equal(projected.status, "BLOCKED");
  assert.equal(projected.next_action, "resolve the projected blocker");
  assert.equal(projected.legacy_projection_sequence, 2);
  assert.equal(projected.legacy_projection_event_hash, "b".repeat(64));
  assert.deepEqual(selectCanonicalFields(projected), before);
  const projectionEvents = () => [...pool.events.values()].filter(
    (event) => event.event_type === "legacy_work_projection_synced",
  );
  assert.equal(projectionEvents().length, 1);

  await store.projectLegacyCatalog(identity(), { project_id: source.project_id });
  assert.equal(projectionEvents().length, 1, "exact source replay must be a no-op");

  Object.assign(source, {
    status: "active",
    next_action: "stale event must not regress state",
    source_sequence_number: 1,
    source_event_hash: "a".repeat(64),
  });
  await store.projectLegacyCatalog(identity(), { project_id: source.project_id });
  assert.equal(projected.status, "BLOCKED");
  assert.equal(projected.next_action, "resolve the projected blocker");
  assert.equal(projected.legacy_projection_sequence, 2);
  assert.equal(projectionEvents().length, 1, "older source sequence must be a no-op");

  Object.assign(source, {
    status: "completed",
    next_action: "",
    source_sequence_number: 3,
    source_event_type: "checkpoint_created",
    source_event_hash: "c".repeat(64),
  });
  await store.projectLegacyCatalog(identity(), { project_id: source.project_id });
  assert.equal(projected.status, "BLOCKED", "terminal state still requires closure evidence");
  assert.equal(projected.legacy_projection_sequence, 2);
  assert.equal(projectionEvents().length, 1);

  Object.assign(source, {
    source_sequence_number: 4,
    source_event_type: "closure_finalized",
    source_event_hash: "d".repeat(64),
  });
  await store.projectLegacyCatalog(identity(), { project_id: source.project_id });
  assert.equal(projected.status, "COMPLETED");
  assert.equal(projected.legacy_projection_sequence, 4);
  assert.equal(projectionEvents().length, 2);
  assert.deepEqual(selectCanonicalFields(projected), before);
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
  await store.projectLegacyCatalog(identity(), { project_id: "nyra-core" });
  const source = pool.legacy.get(key("tenant-a", legacyId));
  Object.assign(source, { status: "completed", next_action: "", updated_at: "2026-08-08T10:01:00.000Z",
    source_sequence_number: 2, source_event_type: "checkpoint_created",
    source_event_hash: "b".repeat(64), source_event_payload: {} });
  await store.projectLegacyCatalog(identity(), { project_id: "nyra-core" });
  assert.equal(pool.works.get(key("tenant-a", legacyId)).status, "ACTIVE");
  Object.assign(source, { source_sequence_number: 3, source_event_type: "closure_finalized",
    source_event_hash: "c".repeat(64) });
  await store.projectLegacyCatalog(identity(), { project_id: "nyra-core" });
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

test("V2 read remains state-pure when only an admin-visible legacy Work exists", async () => {
  const pool = new AtomicWorkPool();
  const workId = "96969696-9696-4969-8969-969696969696";
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:00:00.000Z"),
  });
  await store.initialize();
  pool.legacy.set(key("tenant-a", workId), {
    tenant_id: "tenant-a",
    work_id: workId,
    project_id: "nyra-core",
    idea: "Legacy-only Work",
    objective: "Remain unprojected during read.",
    status: "active",
    next_action: "Use the explicit projection writer.",
    created_at: "2026-08-08T09:00:00.000Z",
    updated_at: "2026-08-08T09:00:00.000Z",
    source_sequence_number: 1,
    source_event_type: "work_created",
    source_event_hash: "a".repeat(64),
    source_event_payload: {},
  });
  const before = JSON.stringify(Object.fromEntries([
    "legacy", "works", "events", "sequences",
  ].map((name) => [name, [...pool[name]]])));

  await assert.rejects(store.readWork(identity(), { work_id: workId }),
    /tenant_work_not_found/);

  const after = JSON.stringify(Object.fromEntries([
    "legacy", "works", "events", "sequences",
  ].map((name) => [name, [...pool[name]]])));
  assert.equal(after, before);
  assert.equal(pool.works.size, 0);
  assert.equal(pool.events.size, 0);
});

test("legacy catalog and backfill fail closed on an unbridged V2 UUID collision", async () => {
  const pool = new AtomicWorkPool();
  const workId = "64646464-6464-4464-8464-646464646464";
  const v2 = candidateWork(115, {
    work_id: workId, legacy_work_id: null, work_name: "Canonical V2 identity",
    project_id: "v2-project", objective: "Must remain unchanged",
  });
  pool.works.set(key("tenant-a", workId), v2);
  pool.legacy.set(key("tenant-a", workId), {
    tenant_id: "tenant-a", work_id: workId, project_id: "foreign-core-project",
    idea: "Foreign Core identity", objective: "Must never overwrite V2",
    status: "active", next_action: "remain separate",
    created_at: "2026-08-08T09:00:00.000Z",
    updated_at: "2026-08-08T10:00:00.000Z",
    source_sequence_number: 1, source_event_type: "work_created",
    source_event_hash: "a".repeat(64), source_event_payload: {},
  });
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:00:03.000Z"),
  });
  const before = pool.snapshot();

  await assert.rejects(store.projectLegacyCatalog(identity(), {
    project_id: "foreign-core-project",
  }), /tenant_work_legacy_link_conflict/);
  await assert.rejects(store.backfillLegacyProjection({ limit: 10 }),
    /tenant_work_legacy_link_conflict/);

  assert.deepEqual(pool.works, before.works);
  assert.deepEqual(pool.events, before.events);
  assert.deepEqual(pool.sequences, before.sequences);
  assert.equal(pool.works.get(key("tenant-a", workId)).work_name,
    "Canonical V2 identity");
});

test("task and evidence identifiers cannot cross an ACL-disjoint Work boundary", async () => {
  const pool = new AtomicWorkPool();
  const workA = "abababab-abab-4bab-8bab-abababababab";
  const workB = "bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc";
  const taskId = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
  const evidenceId = "dededede-dede-4ede-8ede-dededededede";
  pool.works.set(key("tenant-a", workA), candidateWork(110, {
    work_id: workA, owner_user_id: "alice", created_by_user_id: "alice",
  }));
  pool.works.set(key("tenant-a", workB), candidateWork(111, {
    work_id: workB, owner_user_id: "bob", created_by_user_id: "bob",
  }));
  pool.tasks.set(key("tenant-a", taskId), {
    tenant_id: "tenant-a", task_id: taskId, work_id: workB,
    title: "Bob task", weight: 3, status: "planned", required: true,
    acceptance_verified: false,
  });
  pool.evidence.set(key("tenant-a", evidenceId), {
    tenant_id: "tenant-a", evidence_id: evidenceId, work_id: workB,
    kind: "bob_evidence", digest: "b".repeat(64), required: false,
    independently_verified: false, verified_by_agent_id: null,
    verified_by_session_fingerprint: null, weight: 2, metadata: { owner: "bob" },
  });
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:00:03.000Z"),
  });
  const alice = identity("alice", "member");
  const before = pool.snapshot();

  await assert.rejects(store.recordTask(alice, {
    work_id: workA, task_id: taskId, title: "Alice overwrite", weight: 1,
  }), /tenant_work_task_binding_conflict/);
  await assert.rejects(store.recordEvidence(alice, {
    work_id: workA, evidence_id: evidenceId, kind: "alice_evidence",
    digest: "a".repeat(64), metadata: { owner: "alice" },
  }), /tenant_work_evidence_binding_conflict/);

  assert.deepEqual(pool.works, before.works);
  assert.deepEqual(pool.tasks, before.tasks);
  assert.deepEqual(pool.evidence, before.evidence);
  assert.equal(pool.tasks.get(key("tenant-a", taskId)).work_id, workB);
  assert.equal(pool.evidence.get(key("tenant-a", evidenceId)).work_id, workB);
});

test("transaction-bound derived-state queries are strictly sequential", async () => {
  const pool = new AtomicWorkPool();
  const originalConnect = pool.connect.bind(pool);
  let maximumConcurrentQueries = 0;
  pool.connect = async () => {
    const client = await originalConnect();
    const originalQuery = client.query.bind(client);
    let activeQueries = 0;
    return {
      ...client,
      async query(...args) {
        activeQueries += 1;
        maximumConcurrentQueries = Math.max(maximumConcurrentQueries, activeQueries);
        if (activeQueries > 1) {
          activeQueries -= 1;
          throw new Error("transaction_client_query_overlap");
        }
        try {
          await new Promise((resolve) => setImmediate(resolve));
          return await originalQuery(...args);
        } finally {
          activeQueries -= 1;
        }
      },
    };
  };
  const workId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const taskId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  pool.works.set(key("tenant-a", workId), candidateWork(115, {
    work_id: workId,
    owner_user_id: "alice",
    created_by_user_id: "alice",
  }));
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:00:03.000Z"),
  });

  const result = await store.recordTask(identity("alice", "member"), {
    work_id: workId,
    task_id: taskId,
    title: "Verify sequential transaction queries",
    status: "completed",
    required: true,
  });

  assert.equal(maximumConcurrentQueries, 1);
  assert.equal(pool.tasks.get(key("tenant-a", taskId)).status, "completed");
  assert.equal(result.work.work_id, workId);
});

test("terminal task and candidate-evidence replay is exact and state-pure", async () => {
  const pool = new AtomicWorkPool();
  const workId = "efefefef-efef-4fef-8fef-efefefefefef";
  const taskId = "10101010-1010-4010-8010-101010101010";
  const evidenceId = "20202020-2020-4020-8020-202020202020";
  pool.works.set(key("tenant-a", workId), candidateWork(112, {
    work_id: workId, owner_user_id: "alice", created_by_user_id: "alice",
    status: "COMPLETED", updated_at: "2026-08-08T10:00:02.000Z",
  }));
  pool.tasks.set(key("tenant-a", taskId), {
    tenant_id: "tenant-a", task_id: taskId, work_id: workId,
    title: "Persisted task", weight: 1, status: "planned", required: true,
    acceptance_verified: false,
  });
  pool.evidence.set(key("tenant-a", evidenceId), {
    tenant_id: "tenant-a", evidence_id: evidenceId, work_id: workId,
    kind: "candidate", digest: "c".repeat(64), required: false,
    independently_verified: false, verified_by_agent_id: null,
    verified_by_session_fingerprint: null, weight: 1, metadata: { exact: true },
  });
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:00:03.000Z"),
  });
  const alice = identity("alice", "member");
  const before = pool.snapshot();

  await store.recordTask(alice, {
    work_id: workId, task_id: taskId, title: "Persisted task", weight: 1,
    status: "planned", required: true,
  });
  await store.recordEvidence(alice, {
    work_id: workId, evidence_id: evidenceId, kind: "candidate",
    digest: "c".repeat(64), weight: 1, metadata: { exact: true },
  });
  await assert.rejects(store.recordTask(alice, {
    work_id: workId, task_id: "30303030-3030-4030-8030-303030303030",
    title: "New terminal task",
  }), /tenant_work_terminal/);
  await assert.rejects(store.recordEvidence(alice, {
    work_id: workId, evidence_id: "40404040-4040-4040-8040-404040404040",
    kind: "candidate", digest: "d".repeat(64),
  }), /tenant_work_terminal/);

  assert.deepEqual(pool.works, before.works);
  assert.deepEqual(pool.tasks, before.tasks);
  assert.deepEqual(pool.evidence, before.evidence);
  assert.deepEqual(pool.events, before.events);
});

test("unbridged V2 closure never reads or releases an identically named Core Work", async () => {
  const pool = new AtomicWorkPool();
  const workId = "51515151-5151-4151-8151-515151515151";
  const taskId = "52525252-5252-4252-8252-525252525252";
  const intentDigest = "2".repeat(64);
  const authority = await manualClosureAuthority({ workId, intentDigest });
  pool.works.set(key("tenant-a", workId), candidateWork(113, {
    work_id: workId, legacy_work_id: null, work_type: "research",
    owner_user_id: "owner", created_by_user_id: "owner",
    created_by_agent_id: "builder-agent",
    created_by_session_fingerprint: "1".repeat(64),
    acceptance_criteria: ["independently verified"], intent_digest: intentDigest,
    objective: "Close only the native V2 identity", team_id: null,
    created_at: "2026-08-08T10:00:00.000Z",
    started_at: "2026-08-08T10:00:00.000Z",
  }));
  pool.legacy.set(key("tenant-a", workId), {
    tenant_id: "tenant-a", work_id: workId, project_id: "nyra-core",
    status: "active", next_action: "must remain active",
    updated_at: "2026-08-08T10:00:00.000Z",
  });
  pool.tasks.set(key("tenant-a", taskId), {
    tenant_id: "tenant-a", task_id: taskId, work_id: workId, title: "Done",
    weight: 1, required: true, status: "completed", acceptance_verified: true,
  });
  pool.evidence.set(key("tenant-a", "unbridged-independent"), {
    tenant_id: "tenant-a", evidence_id: "unbridged-independent", work_id: workId,
    kind: "independent_verification", digest: "3".repeat(64), required: true,
    independently_verified: true, verified_by_agent_id: "verifier-agent",
    verified_by_session_fingerprint: "4".repeat(64), weight: 1,
    metadata: {}, created_at: "2026-08-08T10:00:01.000Z",
  });
  const joinUnsigned = {
    schema_version: "generic_work_core_join_v1", verdict_id: "unbridged-verdict",
    authority: "universal_core", decision: "GENERIC_WORK_CORE_JOIN_ELIGIBLE",
    tenant_id: "tenant-a", work_id: workId, adapter: "research",
    acceptance_criteria_digest: "a".repeat(64), task_state_digest: "b".repeat(64),
    evidence_digest: "c".repeat(64), independent_verifier_receipt_digest: "d".repeat(64),
    idempotency_digest: "e".repeat(64), execution_authorized: false,
    host_action_authorized: false, issued_at: "2026-08-08T10:00:02.000Z",
    key_id: authority.signer.key_id, signature_algorithm: "ed25519",
  };
  const joinDigest = stableDigest(joinUnsigned);
  pool.joins.set(key("tenant-a", workId), {
    tenant_id: "tenant-a", work_id: workId, core_join_digest: joinDigest,
    core_join_context: {
      ...joinUnsigned, verdict_digest: joinDigest,
      signature: await authority.signer.signDigest(joinDigest),
    },
  });
  const leaseId = "53535353-5353-4353-8353-535353535353";
  pool.leases.set(key("tenant-a", workId, leaseId), {
    tenant_id: "tenant-a", work_id: workId, lease_id: leaseId,
    status: "active", expires_at: "2026-08-08T11:00:00.000Z",
  });
  pool.participants.set(key("tenant-a", workId, "foreign-core-session"), {
    tenant_id: "tenant-a", work_id: workId, session_id: "foreign-core-session",
    status: "active", expires_at: "2026-08-08T11:00:00.000Z",
  });
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:00:03.000Z"),
    coreJoinVerifier: authority.verifier,
  });

  const gallery = await store.preflightGallery(identity("owner", "member"), {
    project_id: "nyra-core",
  });
  assert.equal(gallery.works[0].active_leases, 0);
  assert.equal(gallery.works[0].active_participants, 0);
  const dryRun = await store.reconcileStaleDryRun(identity(), { project_id: "nyra-core" });
  assert.equal(dryRun.classifications[0].legacy_reconciliation_eligible, false);

  const closed = await store.finalizeGenericClosure(identity(), {
    work_id: workId, adapter: "research",
  });
  assert.equal(closed.released_lease_count, 0);
  assert.equal(closed.closed_participant_count, 0);
  assert.equal(pool.legacy.get(key("tenant-a", workId)).status, "active");
  assert.equal(pool.leases.get(key("tenant-a", workId, leaseId)).status, "active");
  assert.equal(pool.participants.get(key(
    "tenant-a", workId, "foreign-core-session",
  )).status, "active");

  const persistedVerification = await store.verifyWorkClosure(identity(), {
    work_id: workId,
  });
  assert.deepEqual(persistedVerification.failure_codes, []);

  const replay = await store.finalizeGenericClosure(identity(), {
    work_id: workId, adapter: "research",
  });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.terminal_coordination_reconciliation.reconciled, false);
  assert.equal(replay.terminal_coordination_reconciliation.released_lease_count, 0);
  assert.equal(replay.terminal_coordination_reconciliation.closed_participant_count, 0);
  assert.equal(pool.legacy.get(key("tenant-a", workId)).status, "active");
  assert.equal([...pool.events.values()].filter((event) =>
    event.event_type === "terminal_coordination_reconciled").length, 0);
  assert.equal([...pool.coreEvents.values()].filter((event) =>
    event.event_type === "terminal_coordination_reconciled").length, 0);
});

test("linked generic closure shares readiness gates and atomically releases Work coordination", async () => {
  const pool = new AtomicWorkPool();
  const workId = "99999999-9999-4999-8999-999999999999";
  const taskId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  pool.works.set(key("tenant-a", workId), candidateWork(100, {
    work_id: workId,
    legacy_work_id: workId,
    work_type: "research",
    created_by_agent_id: "builder-agent",
    created_by_session_fingerprint: "1".repeat(64),
    acceptance_criteria: ["independently verified"],
  }));
  pool.legacy.set(key("tenant-a", workId), {
    tenant_id: "tenant-a", work_id: workId, project_id: "nyra-core",
    status: "active", next_action: "close", updated_at: "2026-08-08T10:00:00.000Z",
  });
  pool.tasks.set(key("tenant-a", taskId), {
    tenant_id: "tenant-a", task_id: taskId, work_id: workId, required: true,
    status: "planned", acceptance_verified: false,
  });
  pool.evidence.set(key("tenant-a", "evidence-independent"), {
    tenant_id: "tenant-a", evidence_id: "evidence-independent", work_id: workId,
    kind: "independent_verification", digest: "3".repeat(64), required: true,
    independently_verified: true, verified_by_agent_id: "verifier-agent",
    verified_by_session_fingerprint: "4".repeat(64), created_at: "2026-08-08T10:00:01.000Z",
  });
  pool.joins.set(key("tenant-a", workId), {
    tenant_id: "tenant-a", work_id: workId, core_join_digest: "5".repeat(64),
  });
  for (const index of [1, 2]) {
    const leaseId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    pool.leases.set(key("tenant-a", workId, leaseId), {
      tenant_id: "tenant-a", work_id: workId, lease_id: leaseId,
      status: "active", expires_at: "2026-08-08T11:00:00.000Z",
    });
    const sessionId = `closure-session-${index}`;
    pool.participants.set(key("tenant-a", workId, sessionId), {
      tenant_id: "tenant-a", work_id: workId, session_id: sessionId,
      status: "active", expires_at: "2026-08-08T11:00:00.000Z",
    });
  }
  pool.leases.set(key("tenant-a", "88888888-8888-4888-8888-888888888888", "other"), {
    tenant_id: "tenant-a", work_id: "88888888-8888-4888-8888-888888888888",
    lease_id: "other", status: "active", expires_at: "2026-08-08T11:00:00.000Z",
  });
  let failAfterCoordinationRelease = false;
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:00:03.000Z"),
    failureInjector: async (phase) => {
      if (failAfterCoordinationRelease && phase === "generic_closure_coordination_released") {
        throw new Error("forced_generic_closure_rollback");
      }
    },
  });

  const incomplete = await store.evaluateGenericClosure(identity(), {
    work_id: workId,
    adapter: "research",
  });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.required_tasks_complete, false);
  assert.deepEqual(incomplete.missing, ["required_tasks_incomplete"]);
  await assert.rejects(store.finalizeGenericClosure(identity(), {
    work_id: workId,
    adapter: "research",
  }), /work_closure_gate_unsatisfied/);

  Object.assign(pool.tasks.get(key("tenant-a", taskId)), {
    status: "completed",
    acceptance_verified: true,
  });
  const ready = await store.evaluateGenericClosure(identity(), {
    work_id: workId,
    adapter: "research",
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missing, []);
  failAfterCoordinationRelease = true;
  await assert.rejects(store.finalizeGenericClosure(identity(), {
    work_id: workId,
    adapter: "research",
  }), /forced_generic_closure_rollback/);
  assert.equal(pool.works.get(key("tenant-a", workId)).status, "ACTIVE");
  assert.equal([...pool.leases.values()].filter((row) =>
    row.work_id === workId && row.status === "active").length, 2);
  assert.equal([...pool.participants.values()].filter((row) =>
    row.work_id === workId && row.status === "active").length, 2);
  assert.equal(pool.closures.has(key("tenant-a", workId)), false);

  failAfterCoordinationRelease = false;
  const closed = await store.finalizeGenericClosure(identity(), {
    work_id: workId,
    adapter: "research",
  });

  assert.equal(closed.terminal_status, "COMPLETED");
  assert.equal(closed.archived, true);
  assert.equal(Object.hasOwn(closed, "archive_status"), false);
  assert.equal(closed.released_lease_count, 2);
  assert.equal(closed.closed_participant_count, 2);
  assert.equal(pool.works.get(key("tenant-a", workId)).status, "COMPLETED");
  assert.equal([...pool.leases.values()].filter((row) =>
    row.work_id === workId && row.status === "released").length, 2);
  assert.equal([...pool.participants.values()].filter((row) =>
    row.work_id === workId && row.status === "closed").length, 2);
  assert.equal(pool.leases.get(key(
    "tenant-a", "88888888-8888-4888-8888-888888888888", "other",
  )).status, "active");
  const closureEvent = [...pool.events.values()].find((event) =>
    event.work_id === workId && event.event_type === "generic_closure_finalized");
  assert.equal(closureEvent.payload.released_lease_count, 2);
  assert.equal(closureEvent.payload.closed_participant_count, 2);
});

test("generic finalize serializes a concurrent legacy Gallery join behind terminal status", async () => {
  const pool = new LockAwareIntegratedWorkPool();
  const workId = "98989898-9898-4989-8989-989898989898";
  const taskId = "97979797-9797-4979-8979-979797979797";
  pool.works.set(key("tenant-a", workId), candidateWork(101, {
    work_id: workId,
    legacy_work_id: workId,
    work_type: "research",
    created_by_agent_id: "builder-agent",
    created_by_session_fingerprint: "1".repeat(64),
    acceptance_criteria: ["independently verified"],
  }));
  pool.legacy.set(key("tenant-a", workId), {
    tenant_id: "tenant-a",
    work_id: workId,
    project_id: "nyra-core",
    status: "active",
    next_action: "close atomically",
    updated_at: "2026-08-08T10:00:00.000Z",
  });
  pool.tasks.set(key("tenant-a", taskId), {
    tenant_id: "tenant-a",
    task_id: taskId,
    work_id: workId,
    required: true,
    status: "completed",
    acceptance_verified: true,
  });
  pool.evidence.set(key("tenant-a", "race-independent-evidence"), {
    tenant_id: "tenant-a",
    evidence_id: "race-independent-evidence",
    work_id: workId,
    kind: "independent_verification",
    digest: "3".repeat(64),
    required: true,
    independently_verified: true,
    verified_by_agent_id: "verifier-agent",
    verified_by_session_fingerprint: "4".repeat(64),
    created_at: "2026-08-08T10:00:01.000Z",
  });
  pool.joins.set(key("tenant-a", workId), {
    tenant_id: "tenant-a",
    work_id: workId,
    core_join_digest: "5".repeat(64),
  });
  const store = createWorkContinuityV2Store({
    pool,
    now: () => new Date("2026-08-08T10:00:03.000Z"),
  });
  const runtime = createWorkContinuityRuntime({}, {
    pool,
    now: () => new Date("2026-08-08T10:00:03.000Z"),
  });
  const finalize = store.finalizeGenericClosure(identity(), {
    work_id: workId,
    adapter: "research",
  });
  await pool.firstCoreLockObserved;

  const sessionId = "race-gallery-session";
  const agentId = "race-gallery-agent";
  const galleryIdentity = {
    tenantId: "tenant-a",
    subject: "race-gallery-subject",
    agentPresence: {
      session_id: sessionId,
      agent_id: agentId,
      client_type: "codex",
      session_fingerprint: "6".repeat(24),
      host_transport_session_fingerprint: "7".repeat(24),
      signature: `ags_${"8".repeat(32)}`,
      transport_bound: true,
    },
  };
  const rejectedJoin = assert.rejects(runtime.join(galleryIdentity, {
    work_id: workId,
    session_id: sessionId,
    agent_id: agentId,
    client_type: "codex",
    ttl_seconds: 300,
    idempotency_key: "race-gallery-join-after-terminal",
  }), /continuity_work_terminal/);
  await pool.secondCoreLockWaiting;
  pool.releaseFirstCoreLockGate();

  const [closed] = await Promise.all([finalize, rejectedJoin.then(() => null)]);
  assert.equal(closed.terminal_status, "COMPLETED");
  assert.equal(pool.works.get(key("tenant-a", workId)).status, "COMPLETED");
  assert.equal(pool.legacy.get(key("tenant-a", workId)).status, "completed");
  assert.equal(pool.participants.size, 0);
  assert.equal(pool.leases.size, 0);
});

test("owner manual merge release evidence closes and projects the legacy Gallery through normal gates", async () => {
  const pool = new AtomicWorkPool();
  const workId = "14794fa6-2cdc-5f6a-8e68-211ff12c8cc6";
  const intentDigest = "2".repeat(64);
  const authority = await manualClosureAuthority({ workId, intentDigest });
  let failTerminalReconciliation = false;
  const store = createWorkContinuityV2Store({
    pool,
    legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:03.000Z"),
    coreJoinVerifier: authority.verifier,
    failureInjector: async (phase) => {
      if (failTerminalReconciliation && phase === "terminal_coordination_reconciled") {
        throw new Error("forced_terminal_coordination_rollback");
      }
    },
  });
  const work = candidateWork(99, {
    work_id: workId,
    legacy_work_id: workId,
    work_name: "Manual merge closure",
    work_type: "software_git",
    owner_user_id: "owner",
    created_by_user_id: "owner",
    created_by_agent_id: "builder-agent",
    created_by_session_fingerprint: "1".repeat(64),
    status: "ACTIVE",
    acceptance_criteria: ["release observed and healthy"],
    intent_digest: intentDigest,
    architecture: { repository: "owner/repo" },
    objective: "Close only after authoritative live readback",
    created_at: "2026-08-08T10:00:00.000Z",
    started_at: "2026-08-08T10:00:00.000Z",
    team_id: null,
    priority: "P1",
  });
  pool.works.set(key("tenant-a", workId), work);
  pool.legacy.set(key("tenant-a", workId), {
    tenant_id: "tenant-a", work_id: workId, status: "release_ready",
    next_action: "observe release", updated_at: "2026-08-08T10:00:00.000Z",
  });
  pool.tasks.set(key("tenant-a", "task-release"), {
    tenant_id: "tenant-a", task_id: "task-release", work_id: workId,
    title: "Verify release", weight: 1, status: "completed", required: true,
    acceptance_verified: true,
  });
  pool.evidence.set(key("tenant-a", "evidence-verifier"), {
    tenant_id: "tenant-a", evidence_id: "evidence-verifier", work_id: workId,
    kind: "native_verifier_terminal_report", digest: "3".repeat(64), required: true,
    independently_verified: true, verified_by_agent_id: "independent-verifier",
    verified_by_session_fingerprint: "4".repeat(64), weight: 1,
    metadata: {}, created_at: "2026-08-08T10:00:01.000Z",
  });
  const genericJoinUnsigned = {
    schema_version: "generic_work_core_join_v1",
    verdict_id: "generic-manual-closure-verdict",
    authority: "universal_core",
    decision: "GENERIC_WORK_CORE_JOIN_ELIGIBLE",
    tenant_id: "tenant-a",
    work_id: workId,
    adapter: "software_git",
    acceptance_criteria_digest: "a".repeat(64),
    task_state_digest: "b".repeat(64),
    evidence_digest: "c".repeat(64),
    independent_verifier_receipt_digest: "d".repeat(64),
    idempotency_digest: "e".repeat(64),
    execution_authorized: false,
    host_action_authorized: false,
    issued_at: "2026-08-08T10:00:02.000Z",
    key_id: authority.signer.key_id,
    signature_algorithm: "ed25519",
  };
  const genericJoinDigest = stableDigest(genericJoinUnsigned);
  const genericJoinContext = {
    ...genericJoinUnsigned,
    verdict_digest: genericJoinDigest,
    signature: await authority.signer.signDigest(genericJoinDigest),
  };
  pool.joins.set(key("tenant-a", workId), {
    tenant_id: "tenant-a", work_id: workId, core_join_digest: genericJoinDigest,
    core_join_context: genericJoinContext,
  });
  await assert.rejects(store.recordOwnerManualMergeReleaseEvidence(identity(), {
    server_owned: true,
    finalize_authorization: authority.authorization,
  }), /owner_manual_merge_release_authorization_invalid/);
  await assert.rejects(store.recordOwnerManualMergeReleaseEvidence(identity(), {
    finalize_authorization: {
      ...authority.authorization,
      target_commit: "f".repeat(40),
    },
    finalize_authorization_proof: authority.proof,
  }), /owner_manual_merge_release_authorization_invalid/);
  await assert.rejects(store.recordOwnerManualMergeReleaseEvidence(identity(), {
    finalize_authorization: {
      ...authority.authorization,
      signature: `hnf_${"f".repeat(64)}`,
    },
    finalize_authorization_proof: authority.proof,
  }), /owner_manual_merge_release_authorization_invalid/);
  await assert.rejects(store.recordOwnerManualMergeReleaseEvidence(identity(), {
    finalize_authorization: authority.authorization,
    finalize_authorization_proof: {
      ...authority.proof,
      signature: `${authority.proof.signature[0] === "A" ? "B" : "A"}${authority.proof.signature.slice(1)}`,
    },
  }), /owner_manual_merge_release_authorization_invalid/);
  const expiredStore = createWorkContinuityV2Store({
    pool,
    legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:06:00.000Z"),
    coreJoinVerifier: authority.verifier,
  });
  await assert.rejects(expiredStore.recordOwnerManualMergeReleaseEvidence(identity(), {
    finalize_authorization: authority.authorization,
    finalize_authorization_proof: authority.proof,
  }), /owner_manual_merge_release_authorization_invalid/);
  const wrongRepositoryAuthority = await manualClosureAuthority({
    workId,
    intentDigest,
    repository: "other/repo",
  });
  const wrongRepositoryStore = createWorkContinuityV2Store({
    pool,
    legacyRuntime: legacyRuntime(pool),
    now: () => new Date("2026-08-08T10:00:03.000Z"),
    coreJoinVerifier: wrongRepositoryAuthority.verifier,
  });
  await assert.rejects(wrongRepositoryStore.recordOwnerManualMergeReleaseEvidence(identity(), {
    finalize_authorization: wrongRepositoryAuthority.authorization,
    finalize_authorization_proof: wrongRepositoryAuthority.proof,
  }), /owner_manual_merge_release_work_binding_invalid/);
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    tenantGatewayKey: "tenant-gateway-key-for-composed-test-123456",
    tenantContextSigningSecret: "tenant-context-key-for-composed-test-123456",
  }, {
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      tenant_id: "tenant-a",
      finalize_authorization: authority.authorization,
      finalize_authorization_proof: authority.proof,
    }), { status: 200, headers: { "content-type": "application/json" } }),
    tenantWorkGallery: store,
  });
  const handlerIdentity = {
    ...identity(),
    kind: "oauth",
    subject: "owner",
    role: "tenant_owner",
    oauthOwnerElevated: true,
    ownerConfirmed: true,
    confirmationReference: "confirm exact manual merge Gallery closure",
  };
  const firstResult = await handlers.host_native_owner_manual_merge_finalize_gallery({
    ticket_id: authority.authorization.action_ticket_id,
  }, handlerIdentity);
  const freshAuthorizationUnsigned = {
    ...authority.authorization,
    issued_at: "2026-08-08T10:00:03.000Z",
    expires_at: "2026-08-08T10:05:03.000Z",
  };
  delete freshAuthorizationUnsigned.authorization_digest;
  delete freshAuthorizationUnsigned.signature;
  const freshAuthorization = {
    ...freshAuthorizationUnsigned,
    authorization_digest: stableDigest(freshAuthorizationUnsigned),
    signature: `hnf_${"6".repeat(64)}`,
  };
  const freshProof = await createHostNativeFinalizeAuthorizationProof({
    authorization: freshAuthorization,
    intentAnchorDigest: intentDigest,
    signer: authority.signer,
  });
  const evidenceReplay = await store.recordOwnerManualMergeReleaseEvidence(identity(), {
    finalize_authorization: freshAuthorization,
    finalize_authorization_proof: freshProof,
  });
  const firstPayload = JSON.parse(firstResult.content[0].text);
  assert.equal(firstPayload.work_gallery_projection.note, "owner_manual_merge");
  assert.equal(firstPayload.work_gallery_projection.legacy_bridged, true);
  assert.equal(evidenceReplay.idempotent_replay, true);
  assert.equal(evidenceReplay.evidence_digest,
    firstPayload.work_gallery_projection.evidence_digest);
  const substitutedUnsigned = {
    ...freshAuthorization,
    core_join_verdict_digest: "8".repeat(64),
  };
  delete substitutedUnsigned.authorization_digest;
  delete substitutedUnsigned.signature;
  const substitutedAuthorization = {
    ...substitutedUnsigned,
    authorization_digest: stableDigest(substitutedUnsigned),
    signature: `hnf_${"7".repeat(64)}`,
  };
  const substitutedProof = await createHostNativeFinalizeAuthorizationProof({
    authorization: substitutedAuthorization,
    intentAnchorDigest: intentDigest,
    signer: authority.signer,
  });
  await assert.rejects(store.recordOwnerManualMergeReleaseEvidence(identity(), {
    finalize_authorization: substitutedAuthorization,
    finalize_authorization_proof: substitutedProof,
  }), /owner_manual_merge_release_evidence_conflict/);
  assert.equal([...pool.evidence.values()].filter((item) =>
    item.kind === "owner_manual_merge_release").length, 1);
  assert.equal(pool.works.get(key("tenant-a", workId)).status, "COMPLETED");
  assert.equal(pool.legacy.get(key("tenant-a", workId)).status, "completed");
  const legacyClosure = [...pool.coreEvents.values()].find((event) =>
    event.event_type === "generic_closure_finalized");
  assert.equal(legacyClosure.payload.note, "owner_manual_merge");
  assert.ok([...pool.events.values()].some((event) =>
    event.event_type === "owner_manual_merge_release_verified" &&
    event.payload.note === "owner_manual_merge"));
  const persistedClosureVerification = deriveTenantWorkClosureVerification({
    tenant_id: "tenant-a",
    work: pool.works.get(key("tenant-a", workId)),
    tasks: [...pool.tasks.values()].filter((item) => item.work_id === workId),
    evidence: [...pool.evidence.values()].filter((item) => item.work_id === workId),
    core_join: pool.joins.get(key("tenant-a", workId)),
    closure_receipt: pool.closures.get(key("tenant-a", workId)),
    final_report: pool.finalReports.get(key("tenant-a", workId)),
    closure_event: [...pool.events.values()].find((event) =>
      event.work_id === workId && event.event_type === "generic_closure_finalized"),
  }, {
    verifyCoreJoin: (context) => authority.verifier.verify(context),
  });
  assert.deepEqual(persistedClosureVerification.failure_codes, []);

  const lateLeaseId = "77777777-7777-4777-8777-777777777771";
  const lateSessionId = "generic-terminal-late-session";
  pool.leases.set(key("tenant-a", workId, lateLeaseId), {
    tenant_id: "tenant-a", work_id: workId, lease_id: lateLeaseId,
    session_id: lateSessionId, status: "active",
    expires_at: "2026-08-08T11:00:00.000Z",
  });
  pool.participants.set(key("tenant-a", workId, lateSessionId), {
    tenant_id: "tenant-a", work_id: workId, session_id: lateSessionId,
    status: "active", expires_at: "2026-08-08T11:00:00.000Z",
  });
  failTerminalReconciliation = true;
  await assert.rejects(store.finalizeGenericClosure(identity(), {
    work_id: workId,
    adapter: "software_git",
  }), /forced_terminal_coordination_rollback/);
  assert.equal(pool.leases.get(key("tenant-a", workId, lateLeaseId)).status, "active");
  assert.equal(pool.participants.get(key("tenant-a", workId, lateSessionId)).status, "active");
  assert.equal([...pool.events.values()].filter((event) =>
    event.event_type === "terminal_coordination_reconciled").length, 0);
  assert.equal([...pool.coreEvents.values()].filter((event) =>
    event.event_type === "terminal_coordination_reconciled").length, 0);

  failTerminalReconciliation = false;
  const terminalReplay = await store.finalizeGenericClosure(identity(), {
    work_id: workId,
    adapter: "software_git",
  });
  assert.equal(terminalReplay.idempotent_replay, true);
  assert.equal(terminalReplay.released_lease_count, 0,
    "historical closure count must remain unchanged");
  assert.equal(terminalReplay.closed_participant_count, 0,
    "historical closure count must remain unchanged");
  assert.equal(terminalReplay.terminal_coordination_reconciliation.reconciled, true);
  assert.equal(
    terminalReplay.terminal_coordination_reconciliation.released_lease_count,
    1,
  );
  assert.equal(
    terminalReplay.terminal_coordination_reconciliation.closed_participant_count,
    1,
  );
  assert.equal(pool.leases.get(key("tenant-a", workId, lateLeaseId)).status, "released");
  assert.equal(pool.participants.get(key("tenant-a", workId, lateSessionId)).status, "closed");
  assert.equal(legacyClosure.payload.released_lease_count, 0);
  assert.equal(legacyClosure.payload.closed_participant_count, 0);
  assert.equal([...pool.events.values()].filter((event) =>
    event.event_type === "terminal_coordination_reconciled").length, 1);
  assert.equal([...pool.coreEvents.values()].filter((event) =>
    event.event_type === "terminal_coordination_reconciled").length, 1);

  const secondTerminalReplay = await store.finalizeGenericClosure(identity(), {
    work_id: workId,
    adapter: "software_git",
  });
  assert.equal(secondTerminalReplay.terminal_coordination_reconciliation.reconciled, false);
  assert.equal(
    secondTerminalReplay.terminal_coordination_reconciliation.released_lease_count,
    0,
  );
  assert.equal(
    secondTerminalReplay.terminal_coordination_reconciliation.closed_participant_count,
    0,
  );
  assert.equal([...pool.events.values()].filter((event) =>
    event.event_type === "terminal_coordination_reconciled").length, 1);
  assert.equal([...pool.coreEvents.values()].filter((event) =>
    event.event_type === "terminal_coordination_reconciled").length, 1);
});
