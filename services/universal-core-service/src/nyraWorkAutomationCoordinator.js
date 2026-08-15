import { nyraDigest } from "../../shared/nyra-work-automation-receipts.js";
import { assertNyraAutomationPaths } from "./nyraWorkAutomationRuntime.js";

const DIGEST = /^[a-f0-9]{64}$/;

function fail(code) { throw new Error(code); }
function requireMethod(value, method, code) { if (typeof value?.[method] !== "function") fail(code); }
function selfDigest(value, field) { return DIGEST.test(String(value?.[field] || "")) && value[field] === nyraDigest({ ...value, [field]: undefined }); }
function criterionChallenges({ phase, record, policy, commit }) {
  const unsigned = { schema_version: "nyra_criterion_evidence_challenges_v1", phase, tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest, policy_digest: policy.receipt_digest, commit, criteria: policy.criteria.map(({ criterion_id, criterion_digest }) => ({ criterion_id, criterion_digest })) };
  return { ...unsigned, challenge_digest: nyraDigest(unsigned) };
}

export function createNyraWorkAutomationAuthoritativeIssuers({ receipts, hostNativeGovernance, finalizedTicket, criterionEvidenceVerifier } = {}) {
  requireMethod(receipts, "builderPlan", "nyra_issuer_receipts_unavailable");
  if (!hostNativeGovernance || typeof finalizedTicket !== "function") fail("nyra_issuer_authority_unavailable");
  return Object.freeze({
    async builderBindingVerifier(input, record) {
      const delegation = await hostNativeGovernance.readDelegation({ tenant_id: record.tenant_id, delegation_id: input.delegation_id });
      if (!hostNativeGovernance.verifyDelegation(delegation) || delegation.effective_state !== "active" || delegation.grant.work_id !== record.work_id || delegation.grant.intent_anchor_digest !== record.intent_anchor_digest || delegation.grant.repository !== record.repository || !delegation.grant.audience.includes(input.builder_agent_id) || delegation.grant.budget.max_parallel !== 1 || record.allowed_paths.some((allowed) => !delegation.grant.allowed_path_prefixes.some((prefix) => allowed === prefix || allowed.startsWith(`${prefix.replace(/\/$/, "")}/`)))) fail("nyra_builder_delegation_invalid");
      const remaining = delegation.grant.budget.max_total_actions - delegation.usage.total_actions;
      if (remaining < 1 || Date.parse(delegation.grant.expires_at || "") <= Date.now()) fail("nyra_builder_delegation_exhausted");
      const signedPlan = receipts.builderPlan({ tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest, task_objective_digest: record.task_objective_digest, builder_agent_id: input.builder_agent_id, session_fingerprint: input.session_fingerprint, plan_digest: receipts.digest(input.plan), delegation_id: input.delegation_id, allowed_paths_digest: receipts.digest(record.allowed_paths) });
      const unsigned = { schema_version: "nyra_authoritative_builder_binding_v1", tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest, task_objective_digest: record.task_objective_digest, builder_agent_id: input.builder_agent_id, session_fingerprint: input.session_fingerprint, plan_digest: signedPlan.plan_digest, plan_receipt_digest: signedPlan.receipt_digest, delegation_id: delegation.delegation_id, allowed_paths_digest: signedPlan.allowed_paths_digest, max_parallel_builders: 1, remaining_action_budget: remaining, expires_at: delegation.grant.expires_at };
      return { ...unsigned, binding_digest: receipts.digest(unsigned) };
    },
    async builderReportIssuer({ input, record }) {
      const delegation = await hostNativeGovernance.readDelegation({ tenant_id: record.tenant_id, delegation_id: record.artifacts?.builder_binding?.delegation_id });
      const binding = record.artifacts?.builder_binding;
      const commit = record.artifacts?.commit_attestation?.commit;
      if (!binding || !commit || !hostNativeGovernance.verifyDelegation(delegation) || delegation.effective_state !== "active" || delegation.delegation_id !== binding.delegation_id || delegation.grant.work_id !== record.work_id || delegation.grant.intent_anchor_digest !== record.intent_anchor_digest || delegation.grant.repository !== record.repository || !delegation.grant.audience.includes(input.builder_agent_id) || binding.builder_agent_id !== input.builder_agent_id || binding.session_fingerprint !== input.session_fingerprint || delegation.grant.budget.max_total_actions - delegation.usage.total_actions < 1 || Date.parse(delegation.grant.expires_at || "") <= Date.now() || input.report?.commit !== commit) fail("nyra_builder_report_authority_invalid");
      return receipts.internalCapability({ tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest, task_objective_digest: record.task_objective_digest, capability_id: "builder.report", agent_id: input.builder_agent_id, session_fingerprint: input.session_fingerprint, input_digest: record.artifacts.commit_attestation.receipt_digest, output_digest: receipts.digest(input.report) });
    },
    async criterionReadinessIssuer({ record, policy, evidence }) {
      const ci = receipts.verify(record.artifacts?.ci_attestation, { expectedSchemaVersion: "nyra_ci_verification_attestation_v2", expected: { tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest, repository: record.repository, head_commit: record.artifacts?.commit_attestation?.commit } });
      if (ci.system_assigned !== true || !Array.isArray(policy.criteria) || !policy.criteria.length || typeof criterionEvidenceVerifier !== "function") fail("nyra_readiness_authoritative_evidence_invalid");
      const challenges = record.artifacts?.criterion_readiness_challenges;
      const expectedChallenges = criterionChallenges({ phase: "readiness", record, policy, commit: ci.head_commit });
      if (challenges?.challenge_digest !== expectedChallenges.challenge_digest || !selfDigest(challenges, "challenge_digest")) fail("nyra_criterion_challenges_invalid");
      const expectedSet = policy.criteria.map(({ criterion_id, criterion_digest }) => `${criterion_id}\u0000${criterion_digest}`).sort();
      const actualSet = (evidence || []).map(({ criterion_id, criterion_digest }) => `${criterion_id}\u0000${criterion_digest}`).sort();
      if (actualSet.length !== expectedSet.length || actualSet.some((value, index) => value !== expectedSet[index])) fail("nyra_criterion_evidence_set_mismatch");
      const proofs = [];
      for (const criterion of evidence) {
        const verified = await criterionEvidenceVerifier(criterion.evidence, { phase: "readiness", tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest, policy_digest: policy.receipt_digest, criterion_id: criterion.criterion_id, criterion_digest: criterion.criterion_digest, commit: ci.head_commit }, record);
        if (verified?.verified !== true || verified.verifier_id === record.active_builder || verified.evidence_digest !== receipts.digest({ schema_version: "nyra_criterion_evidence_binding_v1", phase: "readiness", tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest, policy_digest: policy.receipt_digest, criterion_id: criterion.criterion_id, criterion_digest: criterion.criterion_digest, commit: ci.head_commit, artifact_digest: criterion.evidence?.artifact_digest })) fail("nyra_criterion_evidence_invalid");
        proofs.push({ criterion_id: criterion.criterion_id, criterion_digest: criterion.criterion_digest, proven: true, evidence_digest: verified.evidence_digest, verifier_receipt_id: verified.receipt_id });
      }
      return receipts.criterionProofs({ tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest, policy_digest: policy.receipt_digest, head_commit: ci.head_commit, proofs });
    },
    async finalCriterionIssuer({ criterion, expected, record, observations }) {
      const readiness = receipts.verify(record.artifacts?.criterion_readiness, { expectedSchemaVersion: "nyra_ci_criterion_proofs_v1", expected: { tenant_id: expected.tenant_id, work_id: expected.work_id, intent_anchor_digest: expected.intent_anchor_digest, policy_digest: expected.policy_digest } });
      const readyMatches = readiness.proofs?.filter((proof) => proof.criterion_id === expected.criterion_id && proof.criterion_digest === expected.criterion_digest && proof.proven === true) || [];
      if (readyMatches.length !== 1) fail("nyra_final_criterion_not_ready");
      const challenges = observations.criterion_challenges;
      if (challenges?.phase !== "final" || challenges.policy_digest !== expected.policy_digest || challenges.commit !== expected.live_commit || !selfDigest(challenges, "challenge_digest") || !challenges.criteria?.some((item) => item.criterion_id === expected.criterion_id && item.criterion_digest === expected.criterion_digest)) fail("nyra_final_criterion_challenges_invalid");
      const { ticket, authorization } = await finalizedTicket({ tenant_id: expected.tenant_id, ticket_id: criterion?.evidence_ticket_id, host_session_fingerprint: criterion?.host_session_fingerprint });
      const observedServices = (authorization.live_services || []).map(({ service_id, environment, live_commit }) => ({ service_id, environment, live_commit })).sort((a, b) => `${a.service_id}:${a.environment}`.localeCompare(`${b.service_id}:${b.environment}`));
      const requiredServices = (observations.services || []).map(({ service_id, environment, live_commit }) => ({ service_id, environment, live_commit })).sort((a, b) => `${a.service_id}:${a.environment}`.localeCompare(`${b.service_id}:${b.environment}`));
      if (ticket.ticket.action.kind !== "render.observe" || ticket.ticket.work_id !== expected.work_id || ticket.ticket.repository !== record.repository || authorization.target_commit !== expected.live_commit || authorization.services_verified !== true || JSON.stringify(observedServices) !== JSON.stringify(requiredServices)) fail("nyra_final_criterion_authoritative_evidence_invalid");
      if (typeof criterionEvidenceVerifier !== "function") fail("nyra_final_criterion_evidence_verifier_unavailable");
      const verified = await criterionEvidenceVerifier(criterion.evidence, { phase: "final", ...expected, commit: expected.live_commit }, record);
      const bindingDigest = receipts.digest({ schema_version: "nyra_criterion_evidence_binding_v1", phase: "final", ...expected, commit: expected.live_commit, artifact_digest: criterion.evidence?.artifact_digest });
      if (verified?.verified !== true || verified.verifier_id === record.active_builder || verified.evidence_digest !== bindingDigest) fail("nyra_final_criterion_evidence_invalid");
      return receipts.finalCriterionProof({ ...expected, evidence_digest: bindingDigest, proven: true });
    },
  });
}

export function createNyraWorkAutomationCoordinator({
  runtime, receipts, readback,
  criterionPolicyResolver = null,
  coreJoinVerifier = null,
  mergeReadbackResolver = null,
  deploymentReadbackResolver = null,
  serviceObservationResolver = null,
  closureReceiptVerifier = null,
  actionReceiptVerifier = null,
  inducedServiceResolver = null,
  builderBindingVerifier = null,
  builderReportIssuer = null,
  criterionReadinessIssuer = null,
  finalCriterionIssuer = null,
} = {}) {
  requireMethod(runtime, "create", "nyra_coordinator_runtime_unavailable");
  requireMethod(receipts, "commitAttestation", "nyra_coordinator_receipts_unavailable");
  requireMethod(readback, "commit", "nyra_coordinator_readback_unavailable");
  async function current(input, privateState = true) {
    return runtime.read({ tenant_id: input.tenant_id, work_id: input.work_id, includePrivate: privateState });
  }
  function assertBuilder(record, input) {
    const binding = record.artifacts?.builder_binding;
    if (!binding || record.active_builder !== input.builder_agent_id || binding.builder_agent_id !== input.builder_agent_id || binding.session_fingerprint !== input.session_fingerprint || Date.parse(binding.expires_at || "") <= Date.now()) fail("nyra_coordinator_builder_mismatch");
  }
  return Object.freeze({
    async plan(input) {
      requireMethod(readback, "intent", "nyra_coordinator_intent_readback_unavailable");
      const anchor = await readback.intent(input);
      if (input.intent_anchor_digest && input.intent_anchor_digest !== anchor.intent_anchor_digest) fail("nyra_coordinator_intent_claim_mismatch");
      if (input.intent_objective && input.intent_objective !== anchor.intent_objective) fail("nyra_coordinator_intent_claim_mismatch");
      return runtime.create({ ...input, intent_anchor_digest: anchor.intent_anchor_digest, intent_objective: anchor.intent_objective, task_objective_digest: nyraDigest(anchor.intent_objective), intent_readback: anchor });
    },
    async bindBuilder(input) {
      if (typeof builderBindingVerifier !== "function") fail("nyra_coordinator_builder_binding_verifier_unavailable");
      const record = await current(input);
      const binding = await builderBindingVerifier(input, record);
      if (binding?.schema_version !== "nyra_authoritative_builder_binding_v1" || binding.builder_agent_id !== input.builder_agent_id || binding.tenant_id !== record.tenant_id || binding.work_id !== record.work_id || binding.intent_anchor_digest !== record.intent_anchor_digest || binding.task_objective_digest !== record.task_objective_digest || binding.session_fingerprint !== input.session_fingerprint || binding.plan_digest !== nyraDigest(input.plan) || binding.allowed_paths_digest !== nyraDigest(record.allowed_paths) || binding.max_parallel_builders !== 1 || !Number.isSafeInteger(binding.remaining_action_budget) || binding.remaining_action_budget < 1 || Date.parse(binding.expires_at) <= Date.now() || !DIGEST.test(String(binding.binding_digest || ""))) fail("nyra_coordinator_builder_binding_invalid");
      return runtime.transition({ ...input, expected_state: "PLAN_PENDING", next_state: "BUILDER_PENDING", actor_id: input.builder_agent_id, artifact_name: "builder_binding", artifact: binding, evidence_digest: binding.binding_digest });
    },
    async beginBuild(input) {
      const record = await current(input);
      const binding = record.artifacts?.builder_binding;
      if (!binding || binding.builder_agent_id !== input.builder_agent_id || binding.session_fingerprint !== input.session_fingerprint) fail("nyra_coordinator_builder_mismatch");
      return runtime.transition({ ...input, expected_state: "BUILDER_PENDING", next_state: "BUILDING", actor_id: input.builder_agent_id });
    },
    async attestCommit(input) {
      const record = await current(input);
      assertBuilder(record, input);
      const authoritative = await readback.commit(input);
      assertNyraAutomationPaths({ allowed_paths: record.allowed_paths, changed_files: authoritative.changed_files });
      const attestation = receipts.commitAttestation({
        ...input,
        repository: record.repository,
        branch: input.branch || record.delivery_branch,
        intent_anchor_digest: record.intent_anchor_digest,
        task_objective_digest: record.task_objective_digest,
        authoritative_readback_digest: authoritative.readback_digest,
        changed_files: authoritative.changed_files,
        diff_digest: authoritative.diff_digest,
      });
      await runtime.transition({ ...input, expected_state: "BUILDING", next_state: "COMMIT_READBACK_PENDING", actor_id: input.builder_agent_id, changed_files: authoritative.changed_files, evidence_digest: authoritative.readback_digest, artifact_name: "commit_readback", artifact: authoritative });
      return runtime.transition({ ...input, expected_state: "COMMIT_READBACK_PENDING", next_state: "BUILDER_REPORT_PENDING", actor_id: input.builder_agent_id, changed_files: authoritative.changed_files, receipt_id: attestation.receipt_digest, evidence_digest: attestation.receipt_digest, artifact_name: "commit_attestation", artifact: attestation });
    },
    async builderReport(input) {
      const record = await current(input);
      assertBuilder(record, input);
      if (input.report?.live_verified === true || input.report?.verdict || input.report?.acceptance_evidence) fail("nyra_coordinator_builder_authority_exceeded");
      const commit = record.artifacts?.commit_attestation?.commit;
      if (input.report?.commit !== commit) fail("nyra_coordinator_builder_report_commit_mismatch");
      if (typeof builderReportIssuer !== "function") fail("nyra_coordinator_builder_report_issuer_unavailable");
      const issued = await builderReportIssuer({ input, record });
      const signed = receipts.verify(issued, { expectedSchemaVersion: "nyra_internal_capability_receipt_v1", expected: { tenant_id: input.tenant_id, work_id: input.work_id, intent_anchor_digest: record.intent_anchor_digest, task_objective_digest: record.task_objective_digest, capability_id: "builder.report", agent_id: input.builder_agent_id, session_fingerprint: input.session_fingerprint, input_digest: record.artifacts?.commit_attestation?.receipt_digest, output_digest: nyraDigest(input.report) } });
      return runtime.transition({ ...input, expected_state: "BUILDER_REPORT_PENDING", next_state: "PUSH_PENDING", actor_id: input.builder_agent_id, receipt_id: signed.receipt_digest, evidence_digest: signed.receipt_digest, artifact_name: "builder_report", artifact: signed });
    },
    async recordPush(input) {
      if (typeof actionReceiptVerifier !== "function") fail("nyra_coordinator_action_receipt_verifier_unavailable");
      const record = await current(input);
      const commit = record.artifacts?.commit_attestation?.commit;
      const verified = await actionReceiptVerifier(input.action_receipt, { tenant_id: input.tenant_id, work_id: input.work_id, action_kind: "git.push.branch", repository: record.repository, branch: record.delivery_branch, commit, session_fingerprint: input.session_fingerprint });
      if (verified?.schema_version !== "host_native_action_completion_receipt_v1" || verified.action_kind !== "git.push.branch" || verified.repository !== record.repository || verified.branch !== record.delivery_branch || verified.commit !== commit || verified.session_fingerprint !== input.session_fingerprint || !DIGEST.test(String(verified.receipt_digest || ""))) fail("nyra_coordinator_action_receipt_invalid");
      return runtime.transition({ ...input, expected_state: "PUSH_PENDING", next_state: "DRAFT_PR_PENDING", receipt_id: verified.receipt_digest, evidence_digest: verified.receipt_digest, artifact_name: "push_receipt", artifact: verified });
    },
    async markPullRequestReady(input) {
      requireMethod(readback, "pullRequest", "nyra_coordinator_pull_request_readback_unavailable");
      const authoritative = await readback.pullRequest(input);
      return runtime.transition({ ...input, expected_state: input.expected_state || "DRAFT_PR_PENDING", next_state: "CI_WAIT", evidence_digest: authoritative.readback_digest, artifact_name: "pull_request", artifact: authoritative });
    },
    async verifyCi(input) {
      const record = await current(input);
      if (input.verifier_agent_id === record.active_builder || input.system_assigned !== true) fail("nyra_coordinator_independent_verifier_required");
      const checks = await readback.requiredChecks(input);
      const attestation = receipts.ciAttestation({ ...input, intent_anchor_digest: record.intent_anchor_digest, required_checks: checks.required_checks, required_checks_policy_digest: checks.required_checks_policy_digest, required_checks_results_digest: nyraDigest(checks.checks) });
      await runtime.transition({ ...input, expected_state: "CI_WAIT", next_state: "VERIFIER_PENDING", actor_id: input.verifier_agent_id, receipt_id: attestation.receipt_digest, evidence_digest: attestation.receipt_digest, artifact_name: "ci_attestation", artifact: attestation });
      if (typeof criterionPolicyResolver !== "function") fail("nyra_coordinator_criterion_policy_unavailable");
      const policy = receipts.verify(await criterionPolicyResolver({ tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest }), { expectedSchemaVersion: "nyra_criterion_proof_policy_v1", expected: { tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest } });
      const challenges = criterionChallenges({ phase: "readiness", record, policy, commit: attestation.head_commit });
      return runtime.transition({ ...input, expected_state: "VERIFIER_PENDING", next_state: "READINESS_PENDING", actor_id: input.verifier_agent_id, evidence_digest: challenges.challenge_digest, artifact_name: "criterion_readiness_challenges", artifact: challenges });
    },
    async recordReadiness(input) {
      if (typeof criterionPolicyResolver !== "function") fail("nyra_coordinator_criterion_policy_unavailable");
      if (typeof criterionReadinessIssuer !== "function") fail("nyra_coordinator_criterion_readiness_issuer_unavailable");
      const record = await current(input);
      const policy = await criterionPolicyResolver({ tenant_id: input.tenant_id, work_id: input.work_id, intent_anchor_digest: record.intent_anchor_digest });
      const signedPolicy = receipts.verify(policy, { expectedSchemaVersion: "nyra_criterion_proof_policy_v1", expected: { tenant_id: input.tenant_id, work_id: input.work_id, intent_anchor_digest: record.intent_anchor_digest } });
      if (signedPolicy.server_owned !== true || signedPolicy.wildcard_allowed !== false || JSON.stringify(signedPolicy.criteria).includes("*")) fail("nyra_coordinator_criterion_policy_invalid");
      const issued = await criterionReadinessIssuer({ record, policy: signedPolicy, evidence: input.criterion_evidence });
      const proofs = receipts.verify(issued, { expectedSchemaVersion: "nyra_ci_criterion_proofs_v1", expected: { tenant_id: input.tenant_id, work_id: input.work_id, intent_anchor_digest: record.intent_anchor_digest, policy_digest: signedPolicy.receipt_digest, head_commit: record.artifacts?.commit_attestation?.commit } });
      if (proofs.final === true || proofs.readiness_only !== true) fail("nyra_coordinator_readiness_not_final");
      const expectedCriteria = signedPolicy.criteria.map(({ criterion_id, criterion_digest }) => `${criterion_id}\u0000${criterion_digest}`).sort();
      const actualCriteria = (proofs.proofs || []).map(({ criterion_id, criterion_digest }) => `${criterion_id}\u0000${criterion_digest}`).sort();
      if (!expectedCriteria.length || actualCriteria.length !== expectedCriteria.length || actualCriteria.some((value, index) => value !== expectedCriteria[index]) || proofs.proofs.some((proof) => proof.proven !== true)) fail("nyra_coordinator_criterion_proofs_mismatch");
      return runtime.transition({ ...input, expected_state: "READINESS_PENDING", next_state: "CORE_JOIN_PENDING", receipt_id: proofs.receipt_digest, evidence_digest: proofs.receipt_digest, artifact_name: "criterion_readiness", artifact: proofs });
    },
    async recordCoreJoin(input) {
      if (typeof coreJoinVerifier !== "function") fail("nyra_coordinator_core_join_verifier_unavailable");
      const record = await current(input);
      const commit = record.artifacts?.commit_attestation;
      const readiness = record.artifacts?.criterion_readiness;
      const report = record.artifacts?.builder_report;
      const expected = { tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest, repository: record.repository, head_commit: commit?.commit, builder_report_digest: report?.receipt_digest, readiness_digest: readiness?.receipt_digest };
      const verified = await coreJoinVerifier(input.core_join, expected);
      if (verified?.schema_version !== "host_native_core_join_verdict_v1" || verified.allowed !== true || verified.trusted !== true || Object.entries(expected).some(([key, value]) => verified[key] !== value) || !DIGEST.test(String(verified.verdict_digest || ""))) fail("nyra_coordinator_core_join_required");
      return runtime.transition({ ...input, expected_state: "CORE_JOIN_PENDING", next_state: "MERGE_PENDING", evidence_digest: verified.verdict_digest, artifact_name: "core_join", artifact: verified });
    },
    async recordMerge(input) {
      if (typeof mergeReadbackResolver !== "function") fail("nyra_coordinator_merge_readback_unavailable");
      const authoritative = await mergeReadbackResolver(input);
      const record = await current(input);
      const head = record.artifacts?.commit_attestation?.commit;
      if (authoritative?.schema_version !== "nyra_authoritative_merge_readback_v1" || authoritative.repository !== record.repository || authoritative.head_commit !== head || !/^[a-f0-9]{40}$/.test(String(authoritative.merge_commit || "")) || authoritative.ticket_finalized !== true || !DIGEST.test(String(authoritative.authorization_digest || "")) || !selfDigest(authoritative, "readback_digest")) fail("nyra_coordinator_merge_readback_invalid");
      return runtime.transition({ ...input, expected_state: "MERGE_PENDING", next_state: "DEPLOYMENT_READBACK_PENDING", evidence_digest: authoritative.readback_digest, artifact_name: "merge_readback", artifact: authoritative });
    },
    async recordDeployment(input) {
      if (typeof deploymentReadbackResolver !== "function" || typeof inducedServiceResolver !== "function") fail("nyra_coordinator_deployment_readback_unavailable");
      const deployment = await deploymentReadbackResolver(input);
      const record = await current(input);
      if (deployment?.schema_version !== "nyra_authoritative_deployment_readback_v1" || deployment.live_commit !== record.artifacts?.merge_readback?.merge_commit || !selfDigest(deployment, "readback_digest") || !/^[a-f0-9]{40}$/.test(String(deployment.live_commit || "")) || !Array.isArray(deployment.services) || !deployment.services.length) fail("nyra_coordinator_deployment_readback_invalid");
      const identities = deployment.services.map((service) => `${service.service_id}\u0000${service.environment}`).sort();
      if (new Set(identities).size !== identities.length) fail("nyra_coordinator_deployment_service_set_invalid");
      const expectedServices = await inducedServiceResolver({ tenant_id: input.tenant_id, work_id: input.work_id, repository: input.repository });
      const expectedIdentities = (expectedServices || []).map((service) => `${service.service_id}\u0000${service.environment}`).sort();
      if (!expectedIdentities.length || identities.length !== expectedIdentities.length || identities.some((value, index) => value !== expectedIdentities[index])) fail("nyra_coordinator_deployment_service_set_invalid");
      return runtime.transition({ ...input, expected_state: "DEPLOYMENT_READBACK_PENDING", next_state: "OBSERVE_PENDING", evidence_digest: deployment.readback_digest, artifact_name: "deployment_readback", artifact: deployment });
    },
    async observeServices(input) {
      if (typeof serviceObservationResolver !== "function") fail("nyra_coordinator_service_observer_unavailable");
      const record = await current(input);
      const deployment = record.artifacts?.deployment_readback;
      if (deployment?.schema_version !== "nyra_authoritative_deployment_readback_v1") fail("nyra_coordinator_deployment_readback_required");
      const services = [];
      for (const expected of deployment?.services || []) services.push(await serviceObservationResolver({ ...input, service: expected }));
      const expectedSet = (deployment.services || []).map((service) => `${service.service_id}\u0000${service.environment}`).sort();
      const observedSet = services.map((service) => `${service?.service_id}\u0000${service?.environment}`).sort();
      if (!services.length || observedSet.length !== expectedSet.length || observedSet.some((value, index) => value !== expectedSet[index]) || services.some((service) => service?.schema_version !== "nyra_authoritative_service_observation_v1" || service?.health_status !== "healthy" || service?.live_commit !== deployment.live_commit || !selfDigest(service, "readback_digest"))) fail("nyra_coordinator_live_services_not_verified");
      if (typeof criterionPolicyResolver !== "function") fail("nyra_coordinator_criterion_policy_unavailable");
      const policy = receipts.verify(await criterionPolicyResolver({ tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest }), { expectedSchemaVersion: "nyra_criterion_proof_policy_v1", expected: { tenant_id: record.tenant_id, work_id: record.work_id, intent_anchor_digest: record.intent_anchor_digest } });
      const challenges = criterionChallenges({ phase: "final", record, policy, commit: deployment.live_commit });
      const unsignedObservations = { schema_version: "nyra_service_observations_v1", live_commit: deployment.live_commit, deployment_readback_digest: deployment.readback_digest, services, criterion_challenges: challenges };
      const observations = { ...unsignedObservations, readback_digest: nyraDigest(unsignedObservations) };
      return runtime.transition({ ...input, expected_state: "OBSERVE_PENDING", next_state: "FINAL_ACCEPTANCE_PENDING", evidence_digest: observations.readback_digest, artifact_name: "service_observations", artifact: observations });
    },
    async finalizeAcceptance(input) {
      const record = await current(input);
      const observations = record.artifacts?.service_observations;
      if (observations?.schema_version !== "nyra_service_observations_v1" || !/^[a-f0-9]{40}$/.test(String(observations.live_commit || ""))) fail("nyra_coordinator_service_observations_required");
      if (input.live_commit && input.live_commit !== observations.live_commit) fail("nyra_coordinator_final_acceptance_commit_mismatch");
      if (typeof criterionPolicyResolver !== "function") fail("nyra_coordinator_criterion_policy_unavailable");
      const policy = receipts.verify(await criterionPolicyResolver({ tenant_id: input.tenant_id, work_id: input.work_id, intent_anchor_digest: record.intent_anchor_digest }), { expectedSchemaVersion: "nyra_criterion_proof_policy_v1", expected: { tenant_id: input.tenant_id, work_id: input.work_id, intent_anchor_digest: record.intent_anchor_digest } });
      const expectedCriteria = policy.criteria.map(({ criterion_id, criterion_digest }) => `${criterion_id}\u0000${criterion_digest}`).sort();
      const actualCriteria = (input.criteria || []).map(({ criterion_id, criterion_digest }) => `${criterion_id}\u0000${criterion_digest}`).sort();
      if (!expectedCriteria.length || actualCriteria.length !== expectedCriteria.length || actualCriteria.some((value, index) => value !== expectedCriteria[index]) || typeof finalCriterionIssuer !== "function") fail("nyra_coordinator_final_acceptance_policy_mismatch");
      const verifiedCriteria = [];
      for (const criterion of input.criteria) {
        const expected = { tenant_id: input.tenant_id, work_id: input.work_id, intent_anchor_digest: record.intent_anchor_digest, policy_digest: policy.receipt_digest, criterion_id: criterion.criterion_id, criterion_digest: criterion.criterion_digest, live_commit: observations.live_commit };
        const issued = await finalCriterionIssuer({ criterion, expected, record, observations });
        const verified = receipts.verify(issued, { expectedSchemaVersion: "nyra_final_criterion_proof_v1", expected });
        if (verified?.schema_version !== "nyra_final_criterion_proof_v1" || verified.proven !== true || verified.final !== true || !DIGEST.test(String(verified.evidence_digest || ""))) fail("nyra_coordinator_final_criterion_unproven");
        verifiedCriteria.push({ criterion_id: criterion.criterion_id, criterion_digest: criterion.criterion_digest, proven: true, evidence_digest: verified.evidence_digest, proof_receipt_digest: verified.receipt_digest });
      }
      const proof = receipts.finalAcceptance({ ...input, criteria: verifiedCriteria, live_commit: observations.live_commit, intent_anchor_digest: record.intent_anchor_digest, services_digest: nyraDigest(observations) });
      return runtime.transition({ ...input, expected_state: "FINAL_ACCEPTANCE_PENDING", next_state: "CLOSURE_PENDING", receipt_id: proof.receipt_digest, evidence_digest: proof.receipt_digest, artifact_name: "final_acceptance", artifact: proof });
    },
    async close(input) {
      if (typeof closureReceiptVerifier !== "function") fail("nyra_coordinator_closure_verifier_unavailable");
      const record = await current(input);
      const expected = { tenant_id: input.tenant_id, work_id: input.work_id, live_commit: record.artifacts?.service_observations?.live_commit, final_acceptance_digest: record.artifacts?.final_acceptance?.receipt_digest };
      const verified = await closureReceiptVerifier(input.closure_receipt, expected);
      if (verified?.schema_version !== "nyra_authoritative_closure_receipt_v1" || verified.closed !== true || Object.entries(expected).some(([key, value]) => verified[key] !== value) || !selfDigest(verified, "closure_digest")) fail("nyra_coordinator_trusted_closure_required");
      return runtime.transition({ ...input, expected_state: "CLOSURE_PENDING", next_state: "COMPLETED", evidence_digest: verified.closure_digest, artifact_name: "closure", artifact: verified });
    },
    read(input) { return current(input, false); },
  });
}
