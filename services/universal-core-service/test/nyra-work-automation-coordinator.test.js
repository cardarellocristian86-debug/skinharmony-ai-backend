import assert from "node:assert/strict";
import test from "node:test";

import { nyraDigest } from "../../shared/nyra-work-automation-receipts.js";
import { createNyraWorkAutomationCoordinator } from "../src/nyraWorkAutomationCoordinator.js";
import { createNyraWorkAutomationReceiptService } from "../src/nyraWorkAutomationReceipt.js";
import { createNyraWorkAutomationRuntime } from "../src/nyraWorkAutomationRuntime.js";
function withDigest(value, field = "readback_digest") { return { ...value, [field]: nyraDigest(value) }; }

test("coordinator derives the task objective from the immutable intent", async () => {
  const objective = "Governed objective"; const digest = "a".repeat(64); const sha = "b".repeat(40);
  const runtime = createNyraWorkAutomationRuntime();
  const coordinator = createNyraWorkAutomationCoordinator({ runtime, receipts: createNyraWorkAutomationReceiptService({ secret: "s".repeat(64) }), readback: { intent: async (input) => ({ schema_version: "nyra_immutable_intent_anchor_v1", tenant_id: input.tenant_id, work_id: input.work_id, intent_anchor_digest: digest, intent_objective: objective, immutable: true, source: "universal_core_intent_authority" }), commit: async () => ({ readback_digest: digest }) } });
  await coordinator.plan({ tenant_id: "tenant", work_id: "work", intent_anchor_digest: digest, intent_objective: objective, task_objective_digest: nyraDigest(objective), repository: "owner/repo", base_branch: "main", delivery_branch: "agent/work", base_commit: sha, allowed_paths: ["a.js"] });
  await assert.rejects(coordinator.plan({ tenant_id: "tenant", work_id: "other", intent_anchor_digest: digest, intent_objective: "caller override", repository: "owner/repo", base_branch: "main", delivery_branch: "agent/work", base_commit: sha, allowed_paths: ["a.js"] }), /intent_claim_mismatch/);
});

test("caller booleans cannot authorize Core Join, deployment or closure", async () => {
  const runtime = { create: async () => ({}), read: async () => ({ active_builder: "builder" }), transition: async () => assert.fail("transition must not be reached") };
  const receipts = createNyraWorkAutomationReceiptService({ secret: "s".repeat(64) });
  const coordinator = createNyraWorkAutomationCoordinator({ runtime, receipts, readback: { commit: async () => ({}) } });
  await assert.rejects(coordinator.recordCoreJoin({ tenant_id: "t", work_id: "w", core_join: { trusted: true, allowed: true } }), /verifier_unavailable/);
  await assert.rejects(coordinator.recordDeployment({ tenant_id: "t", work_id: "w", services: [{ health_status: "healthy" }] }), /readback_unavailable/);
  await assert.rejects(coordinator.close({ tenant_id: "t", work_id: "w", closure_receipt: { trusted: true, closed: true } }), /closure_verifier_unavailable/);
});

test("deployment and observe require the exact induced service set and live commit", async () => {
  const live = "a".repeat(40); const digest = "b".repeat(64);
  const expected = ["skinharmony-universal-core", "skinharmony-core-mcp", "skinharmony-nyra-core"].map((service_id) => ({ service_id, environment: "production" }));
  const runtime = { create: async () => ({}), read: async () => ({ artifacts: { merge_readback: { merge_commit: live }, deployment_readback: { schema_version: "nyra_authoritative_deployment_readback_v1", live_commit: live, readback_digest: digest, services: expected } } }), transition: async (value) => value };
  const base = { runtime, receipts: createNyraWorkAutomationReceiptService({ secret: "s".repeat(64) }), readback: { commit: async () => ({}) }, inducedServiceResolver: async () => expected };
  const incomplete = createNyraWorkAutomationCoordinator({ ...base, deploymentReadbackResolver: async () => withDigest({ schema_version: "nyra_authoritative_deployment_readback_v1", live_commit: live, services: expected.slice(0, 2) }) });
  await assert.rejects(incomplete.recordDeployment({ tenant_id: "t", work_id: "w", repository: "owner/repo" }), /service_set_invalid/);
  const wrongCommit = createNyraWorkAutomationCoordinator({ ...base, serviceObservationResolver: async ({ service }) => withDigest({ schema_version: "nyra_authoritative_service_observation_v1", ...service, live_commit: "c".repeat(40), health_status: "healthy" }) });
  await assert.rejects(wrongCommit.observeServices({ tenant_id: "t", work_id: "w" }), /live_services_not_verified/);
  const extra = createNyraWorkAutomationCoordinator({ ...base, deploymentReadbackResolver: async () => withDigest({ schema_version: "nyra_authoritative_deployment_readback_v1", live_commit: live, services: [...expected, { service_id: "extra", environment: "production" }] }) });
  await assert.rejects(extra.recordDeployment({ tenant_id: "t", work_id: "w", repository: "owner/repo" }), /service_set_invalid/);
});

test("authoritative commit files enforce Smart Desk deny even when caller claims a safe diff", async () => {
  const runtime = { create: async () => ({}), read: async () => ({ repository: "owner/repo", delivery_branch: "agent/work", intent_anchor_digest: "a".repeat(64), task_objective_digest: "b".repeat(64), allowed_paths: ["services/**"], active_builder: "builder", artifacts: { builder_binding: { builder_agent_id: "builder", session_fingerprint: "session", expires_at: "2099-01-01T00:00:00.000Z" } } }), transition: async () => assert.fail("transition must not be reached") };
  const coordinator = createNyraWorkAutomationCoordinator({ runtime, receipts: createNyraWorkAutomationReceiptService({ secret: "s".repeat(64) }), readback: { commit: async () => ({ schema_version: "nyra_authoritative_commit_readback_v1", changed_files: ["smartdesk-live/a.js"], diff_digest: "d".repeat(64), readback_digest: "e".repeat(64) }) } });
  await assert.rejects(coordinator.attestCommit({ tenant_id: "t", work_id: "w", builder_agent_id: "builder", session_fingerprint: "session", changed_files: ["services/a.js"] }), /smart_desk_denied/);
});

test("readiness and final acceptance require the exact non-empty server criterion policy", async () => {
  const digest = "a".repeat(64); const head = "b".repeat(40);
  const receipts = createNyraWorkAutomationReceiptService({ secret: "s".repeat(64) });
  const policy = receipts.criterionPolicy({ tenant_id: "t", work_id: "w", intent_anchor_digest: digest, criteria: [{ criterion_id: "required", criterion_digest: digest }, { criterion_id: "also-required", criterion_digest: "c".repeat(64) }] });
  const record = { tenant_id: "t", work_id: "w", intent_anchor_digest: digest, repository: "owner/repo", artifacts: { commit_attestation: { commit: head }, ci_attestation: { receipt_digest: digest }, service_observations: { schema_version: "nyra_service_observations_v1", live_commit: head } } };
  const runtime = { create: async () => ({}), read: async () => record, transition: async () => assert.fail("transition must not be reached") };
  const coordinator = createNyraWorkAutomationCoordinator({ runtime, receipts, readback: { commit: async () => ({}) }, criterionPolicyResolver: async () => policy });
  await assert.rejects(coordinator.recordReadiness({ tenant_id: "t", work_id: "w" }), /criterion_readiness_issuer_unavailable/);
  const forgedReadiness = createNyraWorkAutomationCoordinator({ runtime, receipts, readback: { commit: async () => ({}) }, criterionPolicyResolver: async () => policy, criterionReadinessIssuer: async () => ({ schema_version: "nyra_ci_criterion_proofs_v1", tenant_id: "t", work_id: "w", proofs: policy.criteria.map((criterion) => ({ ...criterion, proven: true })) }) });
  await assert.rejects(forgedReadiness.recordReadiness({ tenant_id: "t", work_id: "w" }), /receipt_integrity_invalid/);
  await assert.rejects(coordinator.finalizeAcceptance({ tenant_id: "t", work_id: "w", live_commit: head, criteria: [] }), /final_acceptance_policy_mismatch/);
  const strict = createNyraWorkAutomationCoordinator({ runtime, receipts, readback: { commit: async () => ({}) }, criterionPolicyResolver: async () => policy, finalCriterionIssuer: async () => ({ schema_version: "nyra_final_criterion_proof_v1", proven: true, final: true, evidence_digest: digest }) });
  await assert.rejects(strict.finalizeAcceptance({ tenant_id: "t", work_id: "w", live_commit: head, criteria: policy.criteria.map((criterion) => ({ ...criterion, evidence_ticket_id: "forged", host_session_fingerprint: "session" })) }), /receipt_integrity_invalid/);
});

test("push, Core Join and merge reject near-miss authoritative bindings", async () => {
  const digest = "a".repeat(64); const head = "b".repeat(40);
  const record = { tenant_id: "t", work_id: "w", intent_anchor_digest: digest, repository: "owner/repo", delivery_branch: "agent/work", artifacts: { commit_attestation: { commit: head }, criterion_readiness: { receipt_digest: digest }, builder_report: { receipt_digest: digest } } };
  const runtime = { create: async () => ({}), read: async () => record, transition: async () => assert.fail("transition must not be reached") };
  const common = { runtime, receipts: createNyraWorkAutomationReceiptService({ secret: "s".repeat(64) }), readback: { commit: async () => ({}) } };
  const push = createNyraWorkAutomationCoordinator({ ...common, actionReceiptVerifier: async (_receipt, expected) => ({ schema_version: "host_native_action_completion_receipt_v1", ...expected, branch: "agent/other", receipt_digest: digest }) });
  await assert.rejects(push.recordPush({ tenant_id: "t", work_id: "w", session_fingerprint: "session", action_receipt: {} }), /action_receipt_invalid/);
  const join = createNyraWorkAutomationCoordinator({ ...common, coreJoinVerifier: async (_receipt, expected) => ({ schema_version: "host_native_core_join_verdict_v1", ...expected, head_commit: "c".repeat(40), trusted: true, allowed: true, verdict_digest: digest }) });
  await assert.rejects(join.recordCoreJoin({ tenant_id: "t", work_id: "w", core_join: {} }), /core_join_required/);
  const merge = createNyraWorkAutomationCoordinator({ ...common, mergeReadbackResolver: async () => withDigest({ schema_version: "nyra_authoritative_merge_readback_v1", repository: "owner/repo", head_commit: "c".repeat(40), merge_commit: head, ticket_finalized: true, authorization_digest: digest }) });
  await assert.rejects(merge.recordMerge({ tenant_id: "t", work_id: "w" }), /merge_readback_invalid/);
});
