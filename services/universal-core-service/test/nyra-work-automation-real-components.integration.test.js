import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { nyraDigest } from "../../shared/nyra-work-automation-receipts.js";
import {
  createHostNativeGovernance,
  createInMemoryHostNativeGovernanceStore,
  hostNativeDigest,
} from "../src/hostNativeGovernance.js";
import { createNyraWorkAutomationAuthoritativeIssuers, createNyraWorkAutomationCoordinator, createNyraWorkAutomationCoreJoinVerifier } from "../src/nyraWorkAutomationCoordinator.js";
import { createNyraWorkAutomationReceiptService } from "../src/nyraWorkAutomationReceipt.js";
import { createNyraWorkAutomationRuntime } from "../src/nyraWorkAutomationRuntime.js";
import { createDynamicCapabilityHandlers, dynamicCapabilityCatalogSnapshot } from "../../skinharmony-core-mcp/src/dynamic-capability-router.js";
import { createNyraWorkAutomationInternal } from "../../skinharmony-core-mcp/src/nyra-work-automation-internal.js";
import { NYRA_WORK_AUTOMATION_TOOLS } from "../../skinharmony-core-mcp/src/nyra-work-automation-tools.js";

function builderBinding(input, record) {
  const unsigned = { schema_version: "nyra_authoritative_builder_binding_v1", tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest, task_objective_digest: record.task_objective_digest, builder_agent_id: input.builder_agent_id, session_fingerprint: input.session_fingerprint, plan_digest: nyraDigest(input.plan), allowed_paths_digest: nyraDigest(record.allowed_paths), max_parallel_builders: 1, remaining_action_budget: 4, expires_at: new Date(Date.now() + 60_000).toISOString() };
  return { ...unsigned, binding_digest: nyraDigest(unsigned) };
}
function withDigest(value, field = "readback_digest") { return { ...value, [field]: nyraDigest(value) }; }
function criterionEvidence(artifact = "f".repeat(64)) { return { artifact_digest: artifact, tree_id: "tree", node_id: "criterion-node", rationale: "Independent verifier confirmed exact criterion evidence", verifier_id: "independent-verifier", assignment_id: "assignment", identity_receipt: "signed-identity-receipt-".repeat(3) }; }
function verifiedCriterionEvidence(receipts) { return async (evidence, expected) => ({ verified: true, verifier_id: evidence.verifier_id, assignment_id: evidence.assignment_id, receipt_id: "verified-receipt", evidence_digest: receipts.digest({ schema_version: "nyra_criterion_evidence_binding_v1", ...expected, artifact_digest: evidence.artifact_digest }) }); }
function challenges(receipts, phase, record, policy, commit) { const value = { schema_version: "nyra_criterion_evidence_challenges_v1", phase, tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest, policy_digest: policy.receipt_digest, criterion_policy: structuredClone(policy), commit, criteria: policy.criteria.map(({ criterion_id, criterion_digest }) => ({ criterion_id, criterion_digest })) }; return { ...value, challenge_digest: receipts.digest(value) }; }

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function signedClosureAttestation(input, secret, { duplicateBuilder = false } = {}) {
  const builderBinding = {
    task_id: "builder-task",
    task_kind: "builder",
    agent_id: input.builder_report.agent_id,
    report_digest: input.builder_report.report_digest,
    native_session_fingerprint: "1".repeat(32),
    native_presence_signature: `ags_${"1".repeat(32)}`,
  };
  const unsigned = {
    schema_version: "host_native_closure_attestation_v1",
    tenant_id: input.tenant_id,
    work_id: input.work_id,
    repository: input.repository,
    core_plan_id: input.core_plan_id,
    core_plan_digest: input.core_plan_digest,
    local_plan_id: input.local_plan_id,
    local_plan_digest: input.local_plan_digest,
    evaluation_digest: input.evaluation_digest,
    target_commit: input.checks.commit,
    checks_digest: input.checks.checks_digest,
    acceptance_criteria: input.acceptance_criteria,
    report_bindings: [
      builderBinding,
      ...(duplicateBuilder ? [{ ...builderBinding, task_id: "builder-task-duplicate" }] : []),
      {
        task_id: "verifier-task",
        task_kind: "verifier",
        agent_id: input.verifier_reports[0].agent_id,
        report_digest: input.verifier_reports[0].report_digest,
        native_session_fingerprint: "2".repeat(32),
        native_presence_signature: `ags_${"2".repeat(32)}`,
      },
    ],
    provider_execution: false,
  };
  return {
    ...unsigned,
    signature: `hnca_${crypto.createHmac("sha256", secret)
      .update(`host-native-closure-attestation-v1\u0000${JSON.stringify(stable(unsigned))}`)
      .digest("hex")}`,
  };
}

test("production Core Join compatibility verifies a real HNJ and rejects a stale mutated claim", async () => {
  const receipts = createNyraWorkAutomationReceiptService({ secret: "s".repeat(64) });
  const expected = {
    tenant_id: "tenant", work_id: "work", intent_anchor_digest: "a".repeat(64),
    repository: "owner/repo", head_commit: "b".repeat(40), builder_agent_id: "builder",
    automation_builder_report_digest: "c".repeat(64),
    automation_readiness_digest: "d".repeat(64),
  };
  const nativeBuilderDigest = "e".repeat(64);
  const nativeEvaluationDigest = "f".repeat(64);
  const closureSecret = "host-native-real-components-closure-secret";
  const governanceStore = createInMemoryHostNativeGovernanceStore();
  const governance = createHostNativeGovernance({
    store: governanceStore,
    signingSecret: "host-native-real-components-signing-secret",
    closureAttestationSigningSecret: closureSecret,
    now: () => Date.parse("2026-08-22T12:00:00.000Z"),
  });
  const coreJoinInput = {
    tenant_id: expected.tenant_id,
    work_id: expected.work_id,
    intent_anchor_digest: expected.intent_anchor_digest,
    repository: expected.repository,
    core_plan_id: `hnp_${"1".repeat(40)}`,
    core_plan_digest: "1".repeat(64),
    local_plan_id: "local-plan",
    local_plan_digest: "2".repeat(64),
    evaluation_digest: nativeEvaluationDigest,
    acceptance_criteria: [{ criterion_id: "tests", evidence_digest: "3".repeat(64), proven: true }],
    builder_report: { agent_id: expected.builder_agent_id, report_digest: nativeBuilderDigest, target_commit: expected.head_commit },
    verifier_reports: [{ agent_id: "verifier", report_digest: "4".repeat(64), reviewed_commit: expected.head_commit, approved: true }],
    checks: { commit: expected.head_commit, required_checks: ["core"], checks_digest: "5".repeat(64), evidence_digest: "6".repeat(64) },
    release_intent: {
      tenant_id: expected.tenant_id,
      work_id: expected.work_id,
      intent_anchor_digest: expected.intent_anchor_digest,
      repository: expected.repository,
      base_branch: "main",
      release_intent_digest: "7".repeat(64),
    },
    provider_execution: false,
    idempotency_key: "real-components-core-join",
  };
  coreJoinInput.closure_attestation = signedClosureAttestation(coreJoinInput, closureSecret);
  const record = await governance.issueCoreJoinVerdict(coreJoinInput);
  assert.equal(governance.verifyCoreJoinVerdict(record), true);
  const verifier = createNyraWorkAutomationCoreJoinVerifier({
    receipts,
    hostNativeGovernance: governance,
    hostNativeDigest,
    resolveCoreJoin: async (tenantId, workId, verdictId, callback) => {
      const authoritative = await governance.readCoreJoinVerdict({ tenant_id: tenantId, verdict_id: verdictId });
      if (authoritative.claim.work_id !== workId) throw new Error("core_join_work_mismatch");
      return callback(authoritative);
    },
  });
  const result = await verifier({ verdict_id: record.verdict_id }, expected);
  const compatibility = receipts.verify(result.compatibility_receipt, {
    expectedSchemaVersion: "nyra_host_native_core_join_compatibility_v1",
    expected,
  });
  assert.equal(compatibility.native_builder_report_digest, nativeBuilderDigest);
  assert.equal(compatibility.native_evaluation_digest, nativeEvaluationDigest);
  assert.notEqual(compatibility.native_builder_report_digest, expected.automation_builder_report_digest);
  assert.notEqual(compatibility.native_evaluation_digest, expected.automation_readiness_digest);
  const swapped = receipts.coreJoinCompatibility({
    ...expected,
    automation_builder_report_digest: nativeBuilderDigest,
    automation_readiness_digest: nativeEvaluationDigest,
    native_builder_report_digest: expected.automation_builder_report_digest,
    native_evaluation_digest: expected.automation_readiness_digest,
  });
  assert.throws(
    () => receipts.verify(swapped, { expected: {
      automation_builder_report_digest: expected.automation_builder_report_digest,
      automation_readiness_digest: expected.automation_readiness_digest,
    } }),
    /binding_mismatch/,
  );
  assert.throws(
    () => receipts.verify({ ...result.compatibility_receipt, native_evaluation_digest: "0".repeat(64) }),
    /integrity/,
  );
  assert.throws(
    () => receipts.verify(result.compatibility_receipt, { expected: { work_id: "other-work" } }),
    /binding_mismatch/,
  );
  await assert.rejects(
    verifier({ verdict_id: record.verdict_id }, { ...expected, builder_agent_id: "other" }),
    /binding_mismatch/,
  );

  // The native signature verifier authenticates the unchanged signed verdict,
  // but cannot by itself notice a stale/mutated detached claim. The production
  // Automation verifier must reject this even when software cognition is OFF.
  governanceStore.mutate((state) => {
    const persisted = state.core_join_verdicts[record.verdict_id];
    // Persisted JSON does not retain the issuer's transient object aliases.
    persisted.claim = structuredClone(persisted.claim);
    persisted.claim.acceptance_criteria[0].evidence_digest = "0".repeat(64);
    return null;
  });
  const staleRecord = await governance.readCoreJoinVerdict({
    tenant_id: expected.tenant_id,
    verdict_id: record.verdict_id,
  });
  assert.equal(governance.verifyCoreJoinVerdict(staleRecord), true);
  await assert.rejects(
    verifier({ verdict_id: record.verdict_id }, expected),
    /binding_mismatch/,
  );

  const duplicateBuilderInput = structuredClone(coreJoinInput);
  duplicateBuilderInput.local_plan_id = "local-plan-duplicate-builder";
  duplicateBuilderInput.local_plan_digest = "8".repeat(64);
  duplicateBuilderInput.idempotency_key = "real-components-core-join-duplicate-builder";
  duplicateBuilderInput.closure_attestation = signedClosureAttestation(
    duplicateBuilderInput,
    closureSecret,
    { duplicateBuilder: true },
  );
  const duplicateBuilderRecord = await governance.issueCoreJoinVerdict(duplicateBuilderInput);
  assert.equal(governance.verifyCoreJoinVerdict(duplicateBuilderRecord), true);
  await assert.rejects(
    verifier({ verdict_id: duplicateBuilderRecord.verdict_id }, expected),
    /binding_mismatch/,
  );
});

test("production issuer factory mints receipts only after authoritative evidence", async () => {
  const receipts = createNyraWorkAutomationReceiptService({ secret: "s".repeat(64) });
  const intent = "a".repeat(64); const evidence = "e".repeat(64); const head = "c".repeat(40);
  const services = [{ service_id: "skinharmony-universal-core", environment: "production", live_commit: head }];
  const delegation = { delegation_id: "delegation", effective_state: "active", grant: { work_id: "work", intent_anchor_digest: intent, repository: "owner/repo", audience: ["builder"], budget: { max_parallel: 1, max_total_actions: 3 }, allowed_path_prefixes: ["services/"], expires_at: new Date(Date.now() + 60_000).toISOString() }, usage: { total_actions: 0 } };
  let delegationAvailable = false; let ticketAvailable = false;
  const issuers = createNyraWorkAutomationAuthoritativeIssuers({
    receipts,
    hostNativeGovernance: { readDelegation: async () => delegationAvailable ? delegation : null, verifyDelegation: (value) => value === delegation },
    finalizedTicket: async ({ ticket_id }) => {
      if (!ticketAvailable || ticket_id !== "observation-ticket") throw new Error("authoritative_ticket_not_found");
      return { ticket: { ticket: { action: { kind: "render.observe" }, work_id: "work", repository: "owner/repo" } }, authorization: { target_commit: head, services_verified: true, live_services: services, authorization_digest: evidence } };
    },
    criterionEvidenceVerifier: verifiedCriterionEvidence(receipts),
  });
  const record = { tenant_id: "tenant", work_id: "work", intent_anchor_digest: intent, task_objective_digest: evidence, repository: "owner/repo", allowed_paths: ["services/a.js"], active_builder: "builder", artifacts: { commit_attestation: { commit: head, receipt_digest: evidence } } };
  const bindInput = { builder_agent_id: "builder", session_fingerprint: "session", delegation_id: "delegation", plan: { exact: true } };
  await assert.rejects(issuers.builderBindingVerifier(bindInput, record), /builder_delegation_invalid/);
  delegationAvailable = true;
  const binding = await issuers.builderBindingVerifier(bindInput, record);
  record.artifacts.builder_binding = binding;
  assert.match(binding.plan_receipt_digest, /^[a-f0-9]{64}$/);
  const builderReport = await issuers.builderReportIssuer({ input: { builder_agent_id: "builder", session_fingerprint: "session", report: { commit: head } }, record });
  assert.equal(builderReport.schema_version, "nyra_internal_capability_receipt_v1");
  delegation.usage.total_actions = 3;
  await assert.rejects(issuers.builderReportIssuer({ input: { builder_agent_id: "builder", session_fingerprint: "session", report: { commit: head } }, record }), /builder_report_authority_invalid/);
  delegation.usage.total_actions = 0;
  const policy = receipts.criterionPolicy({ tenant_id: "tenant", work_id: "work", intent_anchor_digest: intent, criteria: [{ criterion_id: "criterion", criterion_digest: evidence }] });
  await assert.rejects(issuers.criterionReadinessIssuer({ record, policy }), /nyra_receipt_invalid/);
  record.artifacts.ci_attestation = receipts.ciAttestation({ tenant_id: "tenant", work_id: "work", intent_anchor_digest: intent, repository: "owner/repo", pull_request: 1, head_commit: head, base_commit: "b".repeat(40), required_checks: ["ci"], required_checks_policy_digest: evidence, required_checks_results_digest: evidence, verifier_agent_id: "system", system_assigned: true });
  record.artifacts.criterion_readiness_challenges = challenges(receipts, "readiness", record, policy, head);
  await assert.rejects(issuers.criterionReadinessIssuer({ record, policy, evidence: [] }), /criterion_evidence_set_mismatch/);
  const exactEvidence = { criterion_id: "criterion", criterion_digest: evidence, evidence: criterionEvidence() };
  const readiness = await issuers.criterionReadinessIssuer({ record, policy, evidence: [exactEvidence] });
  record.artifacts.criterion_readiness = readiness;
  assert.equal(readiness.schema_version, "nyra_ci_criterion_proofs_v1");
  const expected = { tenant_id: "tenant", work_id: "work", intent_anchor_digest: intent, policy_digest: policy.receipt_digest, criterion_id: "criterion", criterion_digest: evidence, live_commit: head };
  const finalObservations = { services, criterion_challenges: challenges(receipts, "final", record, policy, head) };
  await assert.rejects(issuers.finalCriterionIssuer({ criterion: { evidence_ticket_id: "forged", host_session_fingerprint: "session" }, expected, record, observations: finalObservations }), /authoritative_ticket_not_found/);
  ticketAvailable = true;
  await assert.rejects(issuers.finalCriterionIssuer({ criterion: { evidence_ticket_id: "observation-ticket", host_session_fingerprint: "session", evidence: criterionEvidence() }, expected: { ...expected, criterion_id: "arbitrary" }, record, observations: finalObservations }), /final_criterion_not_ready/);
  const finalProof = await issuers.finalCriterionIssuer({ criterion: { evidence_ticket_id: "observation-ticket", host_session_fingerprint: "session", evidence: criterionEvidence() }, expected, record, observations: finalObservations });
  assert.equal(receipts.verify(finalProof, { expectedSchemaVersion: "nyra_final_criterion_proof_v1", expected }).proven, true);
});

test("real runtime, coordinator and signer preserve exact commit bindings", async () => {
  const objective = "Build exact governed artifact"; const digest = "a".repeat(64);
  const runtime = createNyraWorkAutomationRuntime();
  const coordinator = createNyraWorkAutomationCoordinator({ runtime, receipts: createNyraWorkAutomationReceiptService({ secret: "s".repeat(64) }), builderBindingVerifier: async (input, record) => builderBinding(input, record), readback: { intent: async (input) => ({ schema_version: "nyra_immutable_intent_anchor_v1", tenant_id: input.tenant_id, work_id: input.work_id, intent_anchor_digest: digest, intent_objective: objective, immutable: true, source: "universal_core_intent_authority" }), commit: async (input) => ({ schema_version: "nyra_authoritative_commit_readback_v1", commit: input.commit, changed_files: ["services/a.js"], diff_digest: digest, readback_digest: digest }) } });
  const scope = { tenant_id: "tenant", work_id: "work", intent_anchor_digest: digest, intent_objective: objective, task_objective_digest: nyraDigest(objective), repository: "owner/repo", base_branch: "main", delivery_branch: "agent/work", base_commit: "b".repeat(40), allowed_paths: ["services/a.js"] };
  await coordinator.plan(scope);
  await coordinator.bindBuilder({ ...scope, builder_agent_id: "builder", session_fingerprint: "session", plan: { exact: true } });
  await assert.rejects(coordinator.beginBuild({ ...scope, builder_agent_id: "attacker", session_fingerprint: "session" }), /builder_mismatch/);
  await assert.rejects(coordinator.beginBuild({ ...scope, builder_agent_id: "builder", session_fingerprint: "other" }), /builder_mismatch/);
  await coordinator.beginBuild({ ...scope, builder_agent_id: "builder", session_fingerprint: "session" });
  const record = await coordinator.attestCommit({ ...scope, builder_agent_id: "builder", session_fingerprint: "session", commit: "c".repeat(40), parent_commit: "b".repeat(40), tree_sha: "d".repeat(40), changed_files: ["services/a.js"], diff_digest: digest, host_session_fingerprint: "session" });
  assert.equal(record.artifacts.commit_attestation.commit, "c".repeat(40));
  assert.equal(record.state, "BUILDER_REPORT_PENDING");
});

test("real coordinator completes only the full authoritative v3 chain", async () => {
  const intent = "a".repeat(64); const evidence = "e".repeat(64); const base = "b".repeat(40); const head = "c".repeat(40);
  const objective = "Deliver and verify every induced production service";
  const services = ["skinharmony-universal-core", "skinharmony-core-mcp", "skinharmony-nyra-core"].map((service_id) => ({ service_id, environment: "production" }));
  let receiptClock = Date.now();
  const receipts = createNyraWorkAutomationReceiptService({ secret: "s".repeat(64), now: () => receiptClock++ });
  let criterionPolicyResolutionCount = 0;
  const runtime = createNyraWorkAutomationRuntime();
  const delegation = { delegation_id: "delegation", effective_state: "active", grant: { work_id: "flow", intent_anchor_digest: intent, repository: "owner/repo", audience: ["builder"], budget: { max_parallel: 1, max_total_actions: 30 }, allowed_path_prefixes: ["services/"], expires_at: new Date(Date.now() + 60_000).toISOString() }, usage: { total_actions: 0 } };
  const issuerDependencies = createNyraWorkAutomationAuthoritativeIssuers({
    receipts,
    hostNativeGovernance: { readDelegation: async () => delegation, verifyDelegation: (value) => value === delegation },
    finalizedTicket: async ({ ticket_id }) => {
      if (ticket_id !== "observe-ticket") throw new Error("authoritative_ticket_not_found");
      return { ticket: { ticket: { action: { kind: "render.observe" }, work_id: "flow", repository: "owner/repo" } }, authorization: { target_commit: head, services_verified: true, live_services: services.map((service) => ({ ...service, live_commit: head })), authorization_digest: evidence } };
    },
    criterionEvidenceVerifier: verifiedCriterionEvidence(receipts),
  });
  const coordinator = createNyraWorkAutomationCoordinator({
    runtime, receipts,
    ...issuerDependencies,
    readback: {
      intent: async (input) => ({ schema_version: "nyra_immutable_intent_anchor_v1", tenant_id: input.tenant_id, work_id: input.work_id, intent_anchor_digest: intent, intent_objective: objective, immutable: true, source: "universal_core_intent_authority" }),
      commit: async (input) => ({ schema_version: "nyra_authoritative_commit_readback_v1", commit: input.commit, changed_files: ["services/a.js"], diff_digest: evidence, readback_digest: evidence }),
      pullRequest: async () => ({ schema_version: "nyra_authoritative_pull_request_readback_v1", pull_request: 7, readback_digest: evidence }),
      requiredChecks: async () => ({ required_checks: ["core-mcp", "deployment-parity", "universal-core"], required_checks_policy_digest: evidence, checks: [{ name: "core-mcp", conclusion: "success" }] }),
    },
    criterionPolicyResolver: async () => {
      criterionPolicyResolutionCount += 1;
      return receipts.criterionPolicy({ tenant_id: "tenant", work_id: "flow", intent_anchor_digest: intent, criteria: [{ criterion_id: "exact-live-commit", criterion_digest: evidence }] });
    },
    actionReceiptVerifier: async (_receipt, expected) => ({ schema_version: "host_native_action_completion_receipt_v1", ...expected, receipt_digest: evidence }),
    coreJoinVerifier: async (_claim, expected) => ({
      schema_version: "host_native_core_join_verdict_v1",
      allowed: true,
      trusted: true,
      verdict_digest: evidence,
      compatibility_receipt: receipts.coreJoinCompatibility({
        ...expected,
        // These are authoritative native-domain hashes. They deliberately do
        // not equal either Automation receipt digest.
        native_builder_report_digest: "1".repeat(64),
        native_evaluation_digest: "2".repeat(64),
      }),
    }),
    mergeReadbackResolver: async () => withDigest({ schema_version: "nyra_authoritative_merge_readback_v1", repository: "owner/repo", head_commit: head, merge_commit: head, ticket_finalized: true, authorization_digest: evidence }),
    deploymentReadbackResolver: async () => withDigest({ schema_version: "nyra_authoritative_deployment_readback_v1", live_commit: head, services }),
    inducedServiceResolver: async () => services,
    serviceObservationResolver: async ({ service }) => withDigest({ schema_version: "nyra_authoritative_service_observation_v1", ...service, live_commit: head, health_status: "healthy" }),
    closureReceiptVerifier: async (_receipt, expected) => withDigest({ schema_version: "nyra_authoritative_closure_receipt_v1", ...expected, closed: true }, "closure_digest"),
  });
  const scope = { tenant_id: "tenant", work_id: "flow", intent_anchor_digest: intent, intent_objective: objective, task_objective_digest: nyraDigest(objective), repository: "owner/repo", base_branch: "main", delivery_branch: "agent/flow", base_commit: base, allowed_paths: ["services/a.js"] };
  const routeMethods = new Map([
    ["/v1/nyra/work-automation/plan", "plan"], ["/builder/bind", "bindBuilder"], ["/builder/begin", "beginBuild"], ["/commit/attest", "attestCommit"], ["/builder-report", "builderReport"], ["/push/record", "recordPush"], ["/pull-request/ready", "markPullRequestReady"], ["/ci/verify", "verifyCi"], ["/readiness/record", "recordReadiness"], ["/core-join/record", "recordCoreJoin"], ["/merge/record", "recordMerge"], ["/deployment/readback", "recordDeployment"], ["/services/observe", "observeServices"], ["/acceptance/finalize", "finalizeAcceptance"], ["/closure/finalize", "close"],
  ]);
  const coreRequest = async (requestPath, tenantId, options) => {
    const entry = [...routeMethods].find(([suffix]) => requestPath === suffix || requestPath.endsWith(suffix));
    if (!entry || options.method !== "POST" || options.useTenantGateway !== true || tenantId !== "tenant") throw new Error("strict_core_gateway_route_denied");
    const record = await coordinator[entry[1]]({ ...(options.body || {}), tenant_id: tenantId, work_id: options.body?.work_id || "flow" });
    return { ok: true, record, dedicated_core_gate: { authorized: true, authority: "universal_core", provider_execution: false } };
  };
  const intentResolver = async () => ({ schema_version: "standing_release_intent_binding_v1", tenant_id: "tenant", work_id: "flow", intent_anchor_immutable: true, source: "mcp_work_continuity_postgres" });
  intentResolver.trusted = true;
  const handlers = createNyraWorkAutomationInternal({ coreRequest, resolveIntentBinding: intentResolver, resolveSystemVerifier: async () => ({ agent_id: "core_server_verifier" }) });
  const router = createDynamicCapabilityHandlers({ tools: NYRA_WORK_AUTOMATION_TOOLS, handlers, semanticSelect: async () => ({}), gateAction: async () => ({ structuredContent: { authorization: { allowed: true } } }) });
  const revision = dynamicCapabilityCatalogSnapshot(NYRA_WORK_AUTOMATION_TOOLS, handlers).catalog_revision;
  const identity = { tenantId: "tenant", scopes: ["core:read", "core:govern"], ownerConfirmed: true, agentPresence: { agent_id: "builder", session_id: "session", client_type: "codex" } };
  let sequence = 0;
  const invoke = (capability_id, args) => router.core_capability_invoke({ capability_id, catalog_revision: revision, idempotency_key: `flow-${++sequence}`, arguments: args }, identity);
  await invoke("nyra_work_automation_plan", { work_id: "flow", repository: scope.repository, base_branch: scope.base_branch, delivery_branch: scope.delivery_branch, base_commit: base, allowed_paths: scope.allowed_paths });
  await assert.rejects(invoke("nyra_work_automation_builder_bind", { work_id: "flow", builder_agent_id: "builder", session_fingerprint: "session", delegation_id: "delegation", plan: { stages: 17 }, plan_receipt: { forged: true } }), /dynamic_capability_arguments_invalid/);
  await invoke("nyra_work_automation_builder_bind", { work_id: "flow", builder_agent_id: "builder", session_fingerprint: "session", delegation_id: "delegation", plan: { stages: 17 } });
  await invoke("nyra_work_automation_builder_begin", { work_id: "flow", builder_agent_id: "builder", session_fingerprint: "session" });
  await invoke("nyra_work_automation_commit_attest", { work_id: "flow", builder_agent_id: "builder", session_fingerprint: "session", repository: scope.repository, branch: scope.delivery_branch, commit: head, parent_commit: base, tree_sha: "d".repeat(40), changed_files: ["services/a.js"], diff_digest: evidence, host_session_fingerprint: "session" });
  const report = { tests: "green", commit: head };
  await assert.rejects(invoke("nyra_work_automation_builder_report", { work_id: "flow", builder_agent_id: "builder", session_fingerprint: "session", report, report_receipt: { forged: true } }), /dynamic_capability_arguments_invalid/);
  await invoke("nyra_work_automation_builder_report", { work_id: "flow", builder_agent_id: "builder", session_fingerprint: "session", report });
  await invoke("nyra_work_automation_push_record", { work_id: "flow", session_fingerprint: "session", action_receipt: { opaque: true } });
  await invoke("nyra_work_automation_pull_request_ready", { work_id: "flow", repository: scope.repository, pull_request: 7, head_branch: scope.delivery_branch, base_branch: "main", head_commit: head, base_commit: base });
  await invoke("nyra_work_automation_ci_verify", { work_id: "flow", repository: scope.repository, pull_request: 7, head_commit: head, base_commit: base, base_branch: "main", required_checks: ["core-mcp", "deployment-parity", "universal-core"] });
  const exactCriterionEvidence = { criterion_id: "exact-live-commit", criterion_digest: evidence, evidence: criterionEvidence() };
  await assert.rejects(invoke("nyra_work_automation_readiness_record", { work_id: "flow", criterion_evidence: [{ ...exactCriterionEvidence, criterion_digest: "f".repeat(64) }] }), /criterion_evidence_set_mismatch/);
  await invoke("nyra_work_automation_readiness_record", { work_id: "flow", criterion_evidence: [exactCriterionEvidence] });
  await invoke("nyra_work_automation_core_join_record", { work_id: "flow", core_join: { opaque: true } });
  await assert.rejects(
    invoke("nyra_work_automation_core_join_record", { work_id: "flow", core_join: { opaque: true } }),
    /state_conflict/,
  );
  await invoke("nyra_work_automation_merge_record", { work_id: "flow", ticket_id: "merge-ticket", host_session_fingerprint: "host-session" });
  await invoke("nyra_work_automation_deployment_readback", { work_id: "flow", repository: scope.repository, ticket_id: "deploy-ticket", host_session_fingerprint: "host-session" });
  assert.equal((await runtime.read({ tenant_id: "tenant", work_id: "flow", includePrivate: true })).state, "OBSERVE_PENDING");
  await invoke("nyra_work_automation_services_observe", { work_id: "flow", host_session_fingerprint: "host-session", observation_ticket_ids: Object.fromEntries(services.map((service) => [`${service.service_id}:${service.environment}`, "observe-ticket"])) });
  await assert.rejects(invoke("nyra_work_automation_acceptance_finalize", { work_id: "flow", live_commit: head, criteria: [{ criterion_id: "exact-live-commit", criterion_digest: evidence, evidence_ticket_id: "forged", host_session_fingerprint: "host-session", evidence: criterionEvidence() }] }), /authoritative_ticket_not_found/);
  await invoke("nyra_work_automation_acceptance_finalize", { work_id: "flow", live_commit: head, criteria: [{ criterion_id: "exact-live-commit", criterion_digest: evidence, evidence_ticket_id: "observe-ticket", host_session_fingerprint: "host-session", evidence: criterionEvidence() }] });
  const closed = await invoke("nyra_work_automation_closure_finalize", { work_id: "flow", closure_receipt: { ticket_id: "closure-ticket", host_session_fingerprint: "host-session" } });
  const completed = closed.structuredContent.record;
  assert.equal(completed.state, "COMPLETED");
  assert.equal(criterionPolicyResolutionCount, 1);
  assert.deepEqual(completed.artifacts.service_observations.services.map((service) => service.service_id).sort(), services.map((service) => service.service_id).sort());
});
