import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  ADDITIVE_SCHEMA_SQL,
  actorFromIdentity,
  buildNyraAutopilotVerificationReplay,
  canAdminister,
  canClose,
  canContributeEvidence,
  canRead,
  canRecordTask,
  createGenericWorkCoreJoinVerifier,
  createWorkContinuityV2Store,
  deriveLegacyFinalReportDigest,
  deriveAuthenticatedTenantWorkAcl,
  deriveGenericClosureReadiness,
  deriveTenantWorkClosureVerification,
  normalizeNyraAutopilotVerificationResult,
  verifyGenericCoreJoinVerdict,
} from "../src/work-continuity-v2-store.js";
import { buildGenericClosureArtifacts } from "../src/work-continuity-v2.js";

const acl = ({ user_id = "user-a", tenant_id = "tenant-a", ...rest } = {}) => ({
  server_derived: true, user_id, tenant_id, team_ids: [], managed_team_ids: [],
  is_tenant_owner: false, is_super_admin: false, ...rest,
});

test("generic evaluator and finalizer readiness includes every required gate", () => {
  const state = {
    work: {
      created_by_agent_id: "builder",
      created_by_session_fingerprint: "builder-session",
    },
    tasks: [{ required: true, status: "planned", acceptance_verified: false }],
    evidence: [{
      required: true,
      independently_verified: true,
      verified_by_agent_id: "verifier",
      verified_by_session_fingerprint: "verifier-session",
    }],
    join: { core_join_digest: "a".repeat(64) },
  };
  const incomplete = deriveGenericClosureReadiness(state);
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.required_tasks_complete, false);
  assert.equal(incomplete.independent_verification_persisted, true);
  assert.equal(incomplete.core_join_persisted, true);
  assert.deepEqual(incomplete.missing, ["required_tasks_incomplete"]);

  state.tasks[0] = { required: true, status: "completed", acceptance_verified: true };
  const ready = deriveGenericClosureReadiness(state);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missing, []);

  state.evidence[0].verified_by_session_fingerprint = "builder-session";
  const selfVerified = deriveGenericClosureReadiness(state);
  assert.equal(selfVerified.ready, false);
  assert.deepEqual(selfVerified.missing, ["independent_verification_missing"]);
});

test("V2 evidence identity uses only a server-bound native transport fingerprint", () => {
  const baseIdentity = {
    tenantId: "tenant-a",
    subject: "user-a",
    tenant_work_acl: acl(),
  };
  const native = actorFromIdentity({
    ...baseIdentity,
    agentPresence: {
      agent_id: "native-verifier",
      session_fingerprint: "regular-session",
      host_transport_session_fingerprint: "transport-session",
      transport_bound: true,
    },
  });
  assert.equal(native.session_fingerprint, "transport-session");

  const unbound = actorFromIdentity({
    ...baseIdentity,
    agentPresence: {
      agent_id: "declared-agent",
      session_fingerprint: "regular-session",
      host_transport_session_fingerprint: "untrusted-transport-session",
      transport_bound: false,
    },
  });
  assert.equal(unbound.session_fingerprint, "regular-session");
});

test("Nyra verification projects only an independently claimed verifier over every required Work task", () => {
  const workId = "11111111-1111-4111-8111-111111111111";
  const taskId = "22222222-2222-4222-8222-222222222222";
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const verification = normalizeNyraAutopilotVerificationResult({
    schema_version: "nyra_independent_verification_v1",
    verdict: "approved",
    summary: "Independent regression and scope checks passed.",
    verified_work_task_ids: [taskId],
    verified_assignment_ids: [sourceId],
    evidence_refs: ["test:targeted-pass"],
  }, {
    workId,
    requiredTaskIds: [taskId],
    // The projector receives the durable Autopilot row, whose authoritative
    // identity columns are named `claimed_*`, not the runtime-facing aliases.
    verifier: { claimed_agent_id: "verifier-agent", claimed_session_fingerprint: "verifier-session" },
    sourceAssignments: [{
      assignment_id: sourceId,
      role: "executor_specialist",
      status: "submitted",
      claimed_agent_id: "builder-agent",
      claimed_session_fingerprint: "builder-session",
    }],
  });
  assert.deepEqual(verification.verified_work_task_ids, [taskId]);
  assert.throws(() => normalizeNyraAutopilotVerificationResult({
    schema_version: "nyra_independent_verification_v1",
    verdict: "approved",
    summary: "Invalid self review.",
    verified_work_task_ids: [taskId],
    verified_assignment_ids: [sourceId],
    evidence_refs: ["test:targeted-pass"],
  }, {
    workId,
    requiredTaskIds: [taskId],
    verifier: { agent_id: "builder-agent", session_fingerprint: "verifier-session" },
    sourceAssignments: [{
      assignment_id: sourceId,
      role: "executor_specialist",
      status: "submitted",
      claimed_agent_id: "builder-agent",
      claimed_session_fingerprint: "builder-session",
    }],
  }), /nyra_autopilot_verification_independence_required/);
});

test("an approved Nyra verification covers every material submitted assignment", () => {
  const workId = "11111111-1111-4111-8111-111111111111";
  const taskId = "22222222-2222-4222-8222-222222222222";
  const sourceA = "33333333-3333-4333-8333-333333333333";
  const sourceB = "44444444-4444-4444-8444-444444444444";
  const input = {
    schema_version: "nyra_independent_verification_v1",
    verdict: "approved",
    summary: "One source was omitted.",
    verified_work_task_ids: [taskId],
    verified_assignment_ids: [sourceA],
    evidence_refs: ["test:targeted-pass"],
  };
  const context = {
    workId,
    requiredTaskIds: [taskId],
    verifier: { claimed_agent_id: "verifier-agent", claimed_session_fingerprint: "verifier-session" },
    sourceAssignments: [
      { assignment_id: sourceA, role: "executor_specialist", status: "submitted", claimed_agent_id: "builder-a", claimed_session_fingerprint: "builder-session-a" },
      { assignment_id: sourceB, role: "researcher", status: "submitted", claimed_agent_id: "researcher-b", claimed_session_fingerprint: "researcher-session-b" },
    ],
  };
  assert.throws(() => normalizeNyraAutopilotVerificationResult(input, context),
    /nyra_autopilot_verification_source_coverage_required/);
});

test("a rejected Nyra verification records bounded failure scope without completing Work tasks", () => {
  const workId = "11111111-1111-4111-8111-111111111111";
  const taskA = "22222222-2222-4222-8222-222222222222";
  const taskB = "33333333-3333-4333-8333-333333333333";
  const source = "44444444-4444-4444-8444-444444444444";
  const result = normalizeNyraAutopilotVerificationResult({
    schema_version: "nyra_independent_verification_v1",
    verdict: "rejected",
    summary: "Regression found in the bounded target.",
    verified_work_task_ids: [taskB],
    verified_assignment_ids: [source],
    evidence_refs: ["test:regression"],
  }, {
    workId,
    requiredTaskIds: [taskA, taskB],
    verifier: { claimed_agent_id: "verifier-agent", claimed_session_fingerprint: "verifier-session" },
    sourceAssignments: [{
      assignment_id: source,
      role: "executor_specialist",
      status: "submitted",
      claimed_agent_id: "builder-agent",
      claimed_session_fingerprint: "builder-session",
    }],
  });
  assert.equal(result.verdict, "rejected");
  assert.deepEqual(result.verified_work_task_ids, [taskB]);
});

test("idempotent Nyra verification projection preserves remediation evidence", () => {
  const replay = buildNyraAutopilotVerificationReplay({
    work_id: "11111111-1111-4111-8111-111111111111",
    verification: { verdict: "rejected" },
  }, "a".repeat(64));
  assert.equal(replay.evidence_digest, "a".repeat(64));
  assert.equal(replay.task_projection, "not_applied");
  assert.equal(replay.idempotent_replay, true);
});

function canonicalDigest(value) {
  const stable = (item) => {
    if (Array.isArray(item)) return item.map(stable);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])]));
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function verifiedClosureFixture() {
  const tenantId = "tenant-a";
  const workId = "11111111-1111-4111-8111-111111111111";
  const receiptId = "22222222-2222-4222-8222-222222222222";
  const evidenceDigest = "a".repeat(64);
  const finalEvidenceDigest = canonicalDigest([evidenceDigest]);
  const coreJoinDigest = "b".repeat(64);
  const unsignedReceipt = {
    receipt_id: receiptId,
    work_id: workId,
    adapter: "research",
    core_join_digest: coreJoinDigest,
    final_evidence_digest: finalEvidenceDigest,
    issued_at: "2026-08-25T12:00:00.000Z",
  };
  const reportReceipt = { ...unsignedReceipt, receipt_digest: canonicalDigest(unsignedReceipt) };
  const report = {
    schema_version: "tenant_work_final_report_v1",
    work_id: workId,
    work_code: "ENTITY-20260825-0001",
    work_name: "Entity 360",
    work_type: "research",
    tenant_id: tenantId,
    project_id: "nyra_core",
    owner_user_id: "owner-a",
    team_id: null,
    intent_digest: "d".repeat(64),
    created_at: "2026-08-25T10:00:00.000Z",
    started_at: "2026-08-25T10:05:00.000Z",
    closed_at: "2026-08-25T12:00:00.000Z",
    final_status: "COMPLETED",
    progress_bp: 10000,
    priority: "P1",
    objective: "Qualify bounded Entity 360 context.",
    acceptance_criteria: ["Closure is independently verified."],
    evidence_summary: [{ kind: "test_report", digest: evidenceDigest }],
    core_join_digest: coreJoinDigest,
    closure_receipt: reportReceipt,
    final_evidence_digest: finalEvidenceDigest,
  };
  const reportDigest = canonicalDigest(report);
  const payload = {
    adapter: "research",
    archived: true,
    closure_receipt_digest: reportReceipt.receipt_digest,
    core_join_digest: coreJoinDigest,
    final_evidence_digest: finalEvidenceDigest,
    report_digest: reportDigest,
  };
  const eventEnvelope = {
    tenant_id: tenantId,
    work_id: workId,
    sequence_number: 4,
    event_type: "generic_closure_finalized",
    payload,
    previous_event_hash: "c".repeat(64),
  };
  const coreJoinContext = {
    tenant_id: tenantId,
    work_id: workId,
    adapter: "research",
    verdict_digest: coreJoinDigest,
    authority: "universal_core",
    decision: "GENERIC_WORK_CORE_JOIN_ELIGIBLE",
  };
  return {
    input: {
      tenant_id: tenantId,
      work: {
        tenant_id: tenantId,
        work_id: workId,
        work_code: report.work_code,
        work_name: report.work_name,
        work_type: report.work_type,
        project_id: report.project_id,
        owner_user_id: report.owner_user_id,
        team_id: report.team_id,
        intent_digest: report.intent_digest,
        created_at: report.created_at,
        started_at: report.started_at,
        closed_at: report.closed_at,
        status: "COMPLETED",
        progress_bp: report.progress_bp,
        priority: report.priority,
        objective: report.objective,
        acceptance_criteria: report.acceptance_criteria,
        final_evidence_digest: finalEvidenceDigest,
      },
      tasks: [{ tenant_id: tenantId, work_id: workId, required: true, status: "completed", acceptance_verified: true }],
      evidence: [{ tenant_id: tenantId, work_id: workId, required: true, kind: "test_report", digest: evidenceDigest, independently_verified: true }],
      core_join: { tenant_id: tenantId, work_id: workId, core_join_digest: coreJoinDigest, core_join_context: coreJoinContext },
      closure_receipt: { tenant_id: tenantId, ...reportReceipt },
      final_report: { tenant_id: tenantId, work_id: workId, report, report_digest: reportDigest },
      closure_event: { ...eventEnvelope, event_hash: canonicalDigest(eventEnvelope) },
    },
    coreJoinContext,
  };
}

test("v2 store schema is additive and preserves legacy tables", () => {
  assert.match(ADDITIVE_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS tenant_work/);
  assert.match(ADDITIVE_SCHEMA_SQL, /ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS legacy_work_id/);
  assert.match(ADDITIVE_SCHEMA_SQL, /tenant_work_code_sequence/);
  assert.match(ADDITIVE_SCHEMA_SQL, /tenant_work_core_join/);
  assert.doesNotMatch(ADDITIVE_SCHEMA_SQL, /DROP\s+TABLE|DELETE\s+FROM/i);
});

test("closure verification correlates Work, tasks, evidence, Core Join, receipt, report and terminal event", () => {
  const fixture = verifiedClosureFixture();
  const projection = deriveTenantWorkClosureVerification(fixture.input, {
    verifyCoreJoin: (context) => context === fixture.coreJoinContext,
  });
  assert.equal(projection.verified, true);
  assert.deepEqual(projection.failure_codes, []);
  assert.equal(projection.tenant_id, "tenant-a");
  assert.equal(projection.work_id, fixture.input.work.work_id);
  assert.match(projection.verification_digest, /^[a-f0-9]{64}$/);
});

test("closure verification fails closed on syntactic, tampered or unverified artifacts", () => {
  const cases = [
    (fixture) => { fixture.input.final_report.report_digest = "f".repeat(64); },
    (fixture) => { fixture.input.closure_receipt.receipt_digest = "e".repeat(64); },
    (fixture) => { fixture.input.closure_event.payload.report_digest = "d".repeat(64); },
    (fixture) => { fixture.input.evidence[0].independently_verified = false; },
    (fixture) => {
      fixture.input.final_report.report.objective = "Tampered objective";
      const reportDigest = canonicalDigest(fixture.input.final_report.report);
      fixture.input.final_report.report_digest = reportDigest;
      fixture.input.closure_event.payload.report_digest = reportDigest;
      const { event_hash: ignoredEventHash, ...eventEnvelope } = fixture.input.closure_event;
      fixture.input.closure_event.event_hash = canonicalDigest(eventEnvelope);
    },
  ];
  for (const mutate of cases) {
    const fixture = verifiedClosureFixture();
    mutate(fixture);
    const projection = deriveTenantWorkClosureVerification(fixture.input, {
      verifyCoreJoin: (context) => context === fixture.coreJoinContext,
    });
    assert.equal(projection.verified, false);
    assert(projection.failure_codes.length > 0);
    assert.equal(projection.receipt_digest, null);
  }
  const fixture = verifiedClosureFixture();
  const unverifiedJoin = deriveTenantWorkClosureVerification(fixture.input, {
    verifyCoreJoin: () => false,
  });
  assert.equal(unverifiedJoin.verified, false);
  assert(unverifiedJoin.failure_codes.includes("closure_core_join_unverified"));
});

test("legacy final-report digest binds the complete pre-canonical report shape", () => {
  const fixture = verifiedClosureFixture();
  const original = deriveLegacyFinalReportDigest(fixture.input.final_report.report);
  assert.match(original, /^[a-f0-9]{64}$/);
  fixture.input.final_report.report.evidence_summary[0].kind = "tampered";
  assert.notEqual(deriveLegacyFinalReportDigest(fixture.input.final_report.report), original);
});

test("legacy digest recognition exactly reproduces the pre-canonical finalizer", () => {
  const fixture = verifiedClosureFixture();
  const work = fixture.input.work;
  const finalized = buildGenericClosureArtifacts(work, {
    adapter: work.work_type,
    server_verified_closure_context: {
      schema_version: "work_closure_context_v1",
      server_verified: true,
      independent_verification: { passed: true },
      core_join: { received: true, digest: fixture.input.core_join.core_join_digest },
      final_evidence_digest: work.final_evidence_digest,
      evidence_summary: fixture.input.evidence.map(({ kind, digest }) => ({ kind, digest })),
    },
  });
  const preCanonicalDigest = crypto.createHash("sha256")
    .update(JSON.stringify(finalized.final_report)).digest("hex");
  assert.equal(deriveLegacyFinalReportDigest(finalized.final_report), preCanonicalDigest);
});

test("DTT task upsert gives PostgreSQL an explicit type for its reused status parameter", () => {
  const source = fs.readFileSync(new URL("../src/work-continuity-v2-store.js", import.meta.url), "utf8");
  assert.match(
    source,
    /CASE WHEN \$6::varchar='completed' THEN now\(\) ELSE NULL END/,
  );
});

test("generic finalization persists the canonical report digest and hash-bound V2 closure event", () => {
  const source = fs.readFileSync(new URL("../src/work-continuity-v2-store.js", import.meta.url), "utf8");
  assert.match(source, /const reportDigest = objectDigest\(finalized\.final_report\)/);
  assert.match(source, /appendV2Event\(client, actor, workId, "generic_closure_finalized"/);
  assert.match(source, /report_digest: reportDigest/);
  assert.match(source, /verifyAndBackfillExistingClosure\(client, actor, state, adapter\)/);
  assert.match(source, /reportRow\.report_digest !== legacyReportDigest/);
  assert.match(source, /work_closure_projection_backfill_invalid/);
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
  assert.equal(calls[0], ADDITIVE_SCHEMA_SQL.trim());
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
