import {
  createNyraSignedReceipt,
  nyraDigest,
  verifyNyraSignedReceipt,
} from "../../shared/nyra-work-automation-receipts.js";

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;

function fail(code) { throw new Error(code); }
function text(value, code, maximum = 500) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum || normalized.includes("\u0000")) fail(code);
  return normalized;
}
function digest(value, code) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!DIGEST.test(normalized)) fail(code);
  return normalized;
}
function sha(value, code) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA.test(normalized)) fail(code);
  return normalized;
}
function strings(values, code, maximum = 5_000) {
  if (!Array.isArray(values) || values.length > maximum) fail(code);
  const normalized = values.map((value) => text(value, code, 500).replace(/^\.\//, ""));
  if (normalized.some((value) => value.startsWith("/") || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === ".."))) fail(code);
  const stable = [...new Set(normalized)].sort();
  if (stable.length !== normalized.length) fail(code);
  return stable;
}

export function createNyraWorkAutomationReceiptService({ secret, keyId, now } = {}) {
  const signingOptions = { secret, keyId, now };
  function sign(schema_version, input) {
    return createNyraSignedReceipt({ schema_version, ...input }, signingOptions);
  }
  return Object.freeze({
    digest: nyraDigest,
    verify(receipt, options = {}) {
      return verifyNyraSignedReceipt(receipt, { ...signingOptions, ...options });
    },
    intentAnchor(input) {
      const objective = text(input.intent_objective, "nyra_intent_objective_invalid", 4_000);
      return sign("nyra_immutable_intent_anchor_v1", {
        tenant_id: text(input.tenant_id, "nyra_intent_tenant_invalid"),
        work_id: text(input.work_id, "nyra_intent_work_invalid"),
        intent_objective: objective,
        intent_anchor_digest: nyraDigest({
          tenant_id: input.tenant_id,
          work_id: input.work_id,
          intent_objective: objective,
        }),
        immutable: true,
        source: "universal_core_intent_authority",
      });
    },
    builderPlan(input) {
      return sign("nyra_signed_builder_plan_v1", {
        tenant_id: text(input.tenant_id, "nyra_plan_tenant_invalid"),
        work_id: text(input.work_id, "nyra_plan_work_invalid"),
        intent_anchor_digest: digest(input.intent_anchor_digest, "nyra_plan_intent_invalid"),
        task_objective_digest: digest(input.task_objective_digest, "nyra_plan_objective_invalid"),
        builder_agent_id: text(input.builder_agent_id, "nyra_plan_builder_invalid", 160),
        session_fingerprint: text(input.session_fingerprint, "nyra_plan_session_invalid", 160),
        plan_digest: digest(input.plan_digest, "nyra_plan_digest_invalid"),
        delegation_id: text(input.delegation_id, "nyra_plan_delegation_invalid", 160),
        allowed_paths_digest: digest(input.allowed_paths_digest, "nyra_plan_paths_invalid"),
        provider_execution: false,
      });
    },
    internalCapability(input) {
      return sign("nyra_internal_capability_receipt_v1", {
        tenant_id: text(input.tenant_id, "nyra_capability_tenant_invalid"),
        work_id: text(input.work_id, "nyra_capability_work_invalid"),
        intent_anchor_digest: digest(input.intent_anchor_digest, "nyra_capability_intent_invalid"),
        task_objective_digest: digest(input.task_objective_digest, "nyra_capability_objective_invalid"),
        capability_id: text(input.capability_id, "nyra_capability_id_invalid", 160),
        agent_id: text(input.agent_id, "nyra_capability_agent_invalid", 160),
        session_fingerprint: text(input.session_fingerprint, "nyra_capability_session_invalid", 160),
        input_digest: digest(input.input_digest, "nyra_capability_input_invalid"),
        output_digest: digest(input.output_digest, "nyra_capability_output_invalid"),
        provider_execution: false,
      });
    },
    commitAttestation(input) {
      const changed_files = strings(input.changed_files, "nyra_commit_paths_invalid");
      return sign("nyra_commit_attestation_v2", {
        tenant_id: text(input.tenant_id, "nyra_commit_tenant_invalid"),
        work_id: text(input.work_id, "nyra_commit_work_invalid"),
        intent_anchor_digest: digest(input.intent_anchor_digest, "nyra_commit_intent_invalid"),
        task_objective_digest: digest(input.task_objective_digest, "nyra_commit_objective_invalid"),
        repository: text(input.repository, "nyra_commit_repository_invalid", 240),
        branch: text(input.branch, "nyra_commit_branch_invalid", 240),
        parent_commit: sha(input.parent_commit, "nyra_commit_parent_invalid"),
        commit: sha(input.commit, "nyra_commit_sha_invalid"),
        tree_sha: sha(input.tree_sha, "nyra_commit_tree_invalid"),
        changed_files,
        changed_files_digest: nyraDigest(changed_files),
        diff_digest: digest(input.diff_digest, "nyra_commit_diff_invalid"),
        builder_agent_id: text(input.builder_agent_id, "nyra_commit_builder_invalid", 160),
        host_session_fingerprint: text(input.host_session_fingerprint, "nyra_commit_session_invalid", 160),
        authoritative_readback_digest: digest(input.authoritative_readback_digest, "nyra_commit_readback_invalid"),
        provider_execution: false,
      });
    },
    ciAttestation(input) {
      const required_checks = strings(input.required_checks, "nyra_ci_checks_invalid", 100);
      return sign("nyra_ci_verification_attestation_v2", {
        tenant_id: text(input.tenant_id, "nyra_ci_tenant_invalid"),
        work_id: text(input.work_id, "nyra_ci_work_invalid"),
        intent_anchor_digest: digest(input.intent_anchor_digest, "nyra_ci_intent_invalid"),
        repository: text(input.repository, "nyra_ci_repository_invalid", 240),
        pull_request: Number(input.pull_request),
        head_commit: sha(input.head_commit, "nyra_ci_head_invalid"),
        base_commit: sha(input.base_commit, "nyra_ci_base_invalid"),
        required_checks,
        required_checks_policy_digest: digest(input.required_checks_policy_digest, "nyra_ci_policy_invalid"),
        required_checks_results_digest: digest(input.required_checks_results_digest, "nyra_ci_results_invalid"),
        verifier_agent_id: text(input.verifier_agent_id, "nyra_ci_verifier_invalid", 160),
        system_assigned: true,
        provider_execution: false,
      });
    },
    criterionPolicy(input) {
      if (!Array.isArray(input.criteria) || !input.criteria.length || input.criteria.some((criterion) =>
        !criterion || typeof criterion !== "object" ||
        !String(criterion.criterion_id || "").trim() ||
        !DIGEST.test(String(criterion.criterion_digest || "")) ||
        String(criterion.criterion_id).includes("*") ||
        JSON.stringify(criterion).includes("**"))) {
        fail("nyra_criterion_policy_invalid");
      }
      return sign("nyra_criterion_proof_policy_v1", {
        tenant_id: text(input.tenant_id, "nyra_criterion_tenant_invalid"),
        work_id: text(input.work_id, "nyra_criterion_work_invalid"),
        intent_anchor_digest: digest(input.intent_anchor_digest, "nyra_criterion_intent_invalid"),
        criteria: structuredClone(input.criteria),
        criteria_digest: nyraDigest(input.criteria),
        wildcard_allowed: false,
        server_owned: true,
        provider_execution: false,
      });
    },
    criterionProofs(input) {
      if (!Array.isArray(input.proofs) || input.proofs.length < 1 || input.proofs.some((proof) => !proof || proof.proven !== true || !String(proof.criterion_id || "").trim() || !DIGEST.test(String(proof.criterion_digest || "")))) fail("nyra_criterion_proofs_invalid");
      return sign("nyra_ci_criterion_proofs_v1", {
        tenant_id: text(input.tenant_id, "nyra_criterion_tenant_invalid"),
        work_id: text(input.work_id, "nyra_criterion_work_invalid"),
        intent_anchor_digest: digest(input.intent_anchor_digest, "nyra_criterion_intent_invalid"),
        policy_digest: digest(input.policy_digest, "nyra_criterion_policy_invalid"),
        head_commit: sha(input.head_commit, "nyra_criterion_head_invalid"),
        proofs: structuredClone(input.proofs),
        proofs_digest: nyraDigest(input.proofs),
        readiness_only: true,
        provider_execution: false,
      });
    },
    coreJoinCompatibility(input) {
      return sign("nyra_host_native_core_join_compatibility_v1", {
        tenant_id: text(input.tenant_id, "nyra_core_join_tenant_invalid"),
        work_id: text(input.work_id, "nyra_core_join_work_invalid"),
        intent_anchor_digest: digest(input.intent_anchor_digest, "nyra_core_join_intent_invalid"),
        repository: text(input.repository, "nyra_core_join_repository_invalid", 240),
        head_commit: sha(input.head_commit, "nyra_core_join_head_invalid"),
        builder_agent_id: text(input.builder_agent_id, "nyra_core_join_builder_invalid", 160),
        automation_builder_report_digest: digest(
          input.automation_builder_report_digest,
          "nyra_core_join_builder_receipt_invalid",
        ),
        automation_readiness_digest: digest(
          input.automation_readiness_digest,
          "nyra_core_join_readiness_receipt_invalid",
        ),
        native_builder_report_digest: digest(
          input.native_builder_report_digest,
          "nyra_core_join_native_builder_report_invalid",
        ),
        native_evaluation_digest: digest(
          input.native_evaluation_digest,
          "nyra_core_join_native_evaluation_invalid",
        ),
        provider_execution: false,
      });
    },
    finalCriterionProof(input) {
      if (input.proven !== true) fail("nyra_final_criterion_unproven");
      return sign("nyra_final_criterion_proof_v1", {
        tenant_id: text(input.tenant_id, "nyra_criterion_tenant_invalid"),
        work_id: text(input.work_id, "nyra_criterion_work_invalid"),
        intent_anchor_digest: digest(input.intent_anchor_digest, "nyra_criterion_intent_invalid"),
        policy_digest: digest(input.policy_digest, "nyra_criterion_policy_invalid"),
        criterion_id: text(input.criterion_id, "nyra_criterion_id_invalid", 240),
        criterion_digest: digest(input.criterion_digest, "nyra_criterion_digest_invalid"),
        live_commit: sha(input.live_commit, "nyra_criterion_head_invalid"),
        evidence_digest: digest(input.evidence_digest, "nyra_criterion_evidence_invalid"),
        proven: true,
        final: true,
        provider_execution: false,
      });
    },
    finalAcceptance(input) {
      if (!Array.isArray(input.criteria) || input.criteria.length < 1 || input.criteria.some((item) => item?.proven !== true)) {
        fail("nyra_final_acceptance_not_proven");
      }
      return sign("intent_final_acceptance_proof_v1", {
        tenant_id: text(input.tenant_id, "nyra_acceptance_tenant_invalid"),
        work_id: text(input.work_id, "nyra_acceptance_work_invalid"),
        intent_anchor_digest: digest(input.intent_anchor_digest, "nyra_acceptance_intent_invalid"),
        live_commit: sha(input.live_commit, "nyra_acceptance_commit_invalid"),
        services_digest: digest(input.services_digest, "nyra_acceptance_services_invalid"),
        criteria: structuredClone(input.criteria),
        criteria_digest: nyraDigest(input.criteria),
        final: true,
        provider_execution: false,
      });
    },
  });
}
