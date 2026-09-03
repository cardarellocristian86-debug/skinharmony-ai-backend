import assert from "node:assert/strict";
import test from "node:test";
import { ARCHIVE_STATUSES, CLOSURE_ADAPTERS, WORK_CONTINUITY_V2_SCHEMA_SQL, canActorAccessWork, classifyStaleWork, deriveActorAcl, derivePriority, deriveProgress, finalizeGenericClosure, resolveWorkRequest } from "../src/work-continuity-v2.js";

test("schema V2 is additive and preserves archive states", () => {
  assert.match(WORK_CONTINUITY_V2_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS tenant_work/);
  assert.match(WORK_CONTINUITY_V2_SCHEMA_SQL, /objective text/);
  assert.match(WORK_CONTINUITY_V2_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS tenant_work_code_sequence/);
  assert.match(WORK_CONTINUITY_V2_SCHEMA_SQL, /required boolean NOT NULL DEFAULT true/);
  assert.match(WORK_CONTINUITY_V2_SCHEMA_SQL, /weight integer NOT NULL DEFAULT 1/);
  assert(ARCHIVE_STATUSES.has("ARCHIVED"));
  assert(CLOSURE_ADAPTERS.includes("generic"));
  assert(CLOSURE_ADAPTERS.includes("software_git"));
});

test("progress is deterministic and never trusts agent-declared completion", () => {
  const result = deriveProgress([{ weight: 2, status: "completed", acceptance_verified: true }, { weight: 2, status: "completed", acceptance_verified: false }], [{ independently_verified: true }], { core_join_received: true });
  assert.equal(result.task_progress_bp, 5000);
  assert.equal(result.verification_progress_bp, 10000);
  assert.equal(result.overall_progress_bp, 7500);
});

test("priority is server-derived and stable", () => {
  assert.deepEqual(derivePriority({ severity: 100, urgency: 100, business_impact: 100, security_impact: 100 }), derivePriority({ severity: 100, urgency: 100, business_impact: 100, security_impact: 100 }));
  assert.equal(derivePriority({ severity: 100, urgency: 100, business_impact: 100, security_impact: 100 }).priority, "P0");
});

test("resolver hides invisible conflicts and requires a decision for ambiguity", () => {
  const works = [
    { tenant_id: "t", work_id: "visible", work_code: "NYRA-1", work_name: "Scenario evaluation", status: "ACTIVE", owner_user_id: "u", priority_score: 100 },
    { tenant_id: "t", work_id: "private", work_code: "NYRA-2", work_name: "Scenario evaluation", status: "ACTIVE", owner_user_id: "other", priority_score: 100 },
  ];
  const result = resolveWorkRequest("scenario evaluation", works, { tenant_id: "t", user_id: "u" });
  assert.equal(result.requires_owner_decision, true);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.hidden_conflict, true);
});

test("resolver denies cross-tenant candidates and permits authorized Team Manager visibility", () => {
  const works = [
    { tenant_id: "other", work_id: "other", work_code: "OTHER-1", work_name: "Scenario evaluation", status: "ACTIVE", visibility_scope: "tenant" },
    { tenant_id: "t", work_id: "team", work_code: "NYRA-3", work_name: "Scenario evaluation", status: "ACTIVE", visibility_scope: "team", team_id: "engineering", priority_score: 100 },
  ];
  const result = resolveWorkRequest("scenario evaluation", works, { tenant_id: "t", user_id: "manager", team_ids: ["engineering"] });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].work_id, "team");
});

test("expired presence classifies an operational work as stale without mutating it", () => {
  const result = classifyStaleWork({ status: "ACTIVE", updated_at: "2026-01-01T00:00:00.000Z", participants: [{ active: true, expires_at: "2026-01-01T01:00:00.000Z" }], leases: [] }, "2026-01-03T00:00:00.000Z");
  assert.equal(result.classification, "STALE");
});

test("ACL helpers are tenant-bound and deterministic", () => {
  const actor = deriveActorAcl({ tenant_id: "t", user_id: "u", team_ids: ["b", "a", "a"] });
  assert.deepEqual(actor.team_ids, ["a", "b"]);
  assert.equal(canActorAccessWork({ tenant_id: "t", owner_user_id: "u", visibility_scope: "private" }, actor), true);
  assert.equal(canActorAccessWork({ tenant_id: "other", visibility_scope: "tenant" }, actor), false);
});

test("stale classification identifies unfinished completion, abandonment, and unknown state", () => {
  assert.equal(classifyStaleWork({ status: "COMPLETED" }).classification, "COMPLETED_BUT_UNCLOSED");
  assert.equal(classifyStaleWork({ status: "ACTIVE", updated_at: "2026-01-01T00:00:00.000Z" }, "2026-02-02T00:00:00.000Z").classification, "ABANDONED");
  assert.equal(classifyStaleWork({ status: "ACTIVE" }).classification, "UNKNOWN");
});

test("generic closure requires independent verification and Core Join, then produces a report", () => {
  const work = { tenant_id: "t", work_id: "w", work_code: "NYRA-20260807-0001", work_name: "Research", work_type: "research", progress_bp: 10000 };
  assert.throws(() => finalizeGenericClosure(work, { adapter: "research", independent_verification: true, core_join_received: true }), /work_closure_verified_context_required/);
  const closed = finalizeGenericClosure(work, { adapter: "research", server_verified_closure_context: {
    schema_version: "work_closure_context_v1", server_verified: true,
    independent_verification: { passed: true }, core_join: { received: true, digest: "a".repeat(64) },
    final_evidence_digest: "b".repeat(64),
  } });
  assert.equal(closed.work.status, "COMPLETED");
  assert.equal(closed.terminal_status, "COMPLETED");
  assert.equal(closed.archived, true);
  assert.equal(Object.hasOwn(closed, "archive_status"), false);
  assert.equal(closed.work.archived_at, closed.work.closed_at);
  assert.equal(closed.final_report.final_status, "COMPLETED");
  const replay = finalizeGenericClosure(closed.work, { adapter: "research" });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.terminal_status, "COMPLETED");
  assert.equal(replay.archived, true);
  assert.equal(replay.receipt.receipt_digest, closed.receipt.receipt_digest);
});
