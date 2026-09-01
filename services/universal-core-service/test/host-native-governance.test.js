import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HOST_NATIVE_ABSOLUTE_DENY_ACTIONS,
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  HOST_NATIVE_HEALTH_CONTRACT_VERSION,
  buildHostNativeWorkPlan,
  buildHostReleaseIntentV1,
  buildHostReleaseManifestV2,
  createFileHostNativeGovernanceStore,
  createHostNativeGovernance,
  createHostNativeDomainSigner,
  createHostNativeDomainVerifier,
  createInMemoryHostNativeGovernanceStore,
  deriveHostReleaseIntentV1,
  hostNativeDigest,
  hostNativeGithubDiffDigest,
  validateHostReleaseManifestV2,
} from "../src/hostNativeGovernance.js";
import { createSemanticScopeGuard } from "../src/semanticScopeGuard.js";
import {
  createHostNativeFinalizeAuthorizationProof,
  createLocalGenericWorkCoreJoinSigner,
  verifyGenericWorkCoreJoinDigestSignature,
} from "../src/genericWorkCoreJoin.js";

test("host-native governance advertises Work Automation v3 without provider execution", () => {
  const governance = createHostNativeGovernance({
    store: createInMemoryHostNativeGovernanceStore(),
    signingSecret: "s".repeat(64),
    closureAttestationSigningSecret: "c".repeat(64),
    requiredChecksPolicyResolver: async () => ({
      schema_version: "host_native_required_checks_policy_v1", tenant_id: "tenant", repository: "owner/repo", base_branch: "main",
      required_checks: ["core"], check_app: { id: 1, slug: "github-actions", owner: "github" },
      workflow: { id: 1, name: "CI", path: ".github/workflows/ci.yml", sha256: "a".repeat(64), candidate_sha256: null }, allowed_events: ["pull_request"],
    }),
  });
  assert.equal(governance.nyra_work_automation_v3_supported, true);
  assert.equal(governance.nyra_work_automation_provider_execution, false);
});
import { createHostNativeExternalReadbackVerifier } from "../src/hostNativeExternalReadback.js";

test("host-native domain signer binds causal envelopes to their exact purpose and payload", async () => {
  const signer = createHostNativeDomainSigner({
    signingSecret: "host-native-causal-domain-test-secret-0123456789",
  });
  const envelope = { schema_version: "causal_context_envelope_v1", work_id: "work-a" };
  const signature = await signer.sign(envelope, { purpose: "causal_context_envelope_v1" });
  assert.equal(await signer.verify(envelope, signature, { purpose: "causal_context_envelope_v1" }), true);
  assert.equal(await signer.verify({ ...envelope, work_id: "work-b" }, signature, { purpose: "causal_context_envelope_v1" }), false);
  assert.equal(await signer.verify(envelope, signature, { purpose: "other-purpose" }), false);
});

test("host-native verification keyring preserves historical proofs across rotation", () => {
  const oldSecret = "host-native-old-domain-test-secret-01234567890123456789";
  const newSecret = "host-native-new-domain-test-secret-01234567890123456789";
  const oldSigner = createHostNativeDomainSigner({ signingSecret: oldSecret, keyId: "host-key-old" });
  const newSigner = createHostNativeDomainSigner({ signingSecret: newSecret, keyId: "host-key-active" });
  const verifier = createHostNativeDomainVerifier({ verificationKeys: {
    [oldSigner.key_id]: oldSecret,
    [newSigner.key_id]: newSecret,
  } });
  const payload = { schema_version: "rotation_test_v1", digest: "a".repeat(64) };
  const purpose = "rotation-test-v1";
  const oldProof = oldSigner.sign(payload, { purpose });
  const newProof = newSigner.sign(payload, { purpose });
  assert.equal(verifier.verify(payload, oldProof, { purpose, key_id: oldSigner.key_id }), true);
  assert.equal(verifier.verify(payload, newProof, { purpose, key_id: newSigner.key_id }), true);
  assert.equal(verifier.verify(payload, oldProof, { purpose, key_id: newSigner.key_id }), false);
  assert.equal(verifier.verify(payload, oldProof, { purpose, key_id: "host-key-unknown" }), false);
  assert.equal(verifier.verify(payload, oldProof, { purpose: "other-purpose", key_id: oldSigner.key_id }), false);
  assert.equal(Object.hasOwn(verifier, "sign"), false);
});

const H = (value) => String(value).repeat(64);
const G = (value) => String(value).repeat(40);
const OWNER = `osf_${H("a")}`;
const CLOSURE_ATTESTATION_SECRET =
  "host-native-governance-closure-attestation-secret-0123456789";
const HOST_NATIVE_TEST_SIGNING_SECRET =
  "host-native-governance-test-signing-secret-at-least-32-bytes";

function canonicalForSignature(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalForSignature).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalForSignature(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function signedTestDomain(prefix, payload) {
  return `${prefix}_${crypto.createHmac("sha256", HOST_NATIVE_TEST_SIGNING_SECRET)
    .update(payload).digest("hex")}`;
}
const IDEMPOTENT_METHODS = new Set([
  "issueCoreJoinVerdict",
  "recordOwnerManualMergeReadback",
  "issueDelegation",
  "revokeDelegation",
  "issueActionTicket",
  "reserveActionTicket",
  "completeActionTicket",
  "reconcileActionTicket",
]);
let testIdempotencySequence = 0;

function withTestIdempotency(governance) {
  return new Proxy(governance, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (!IDEMPOTENT_METHODS.has(property) || typeof value !== "function") return value;
      return (input = {}, ...args) => value.call(target, {
        ...input,
        idempotency_key: input.idempotency_key ||
          `test-${String(property).toLowerCase()}-${++testIdempotencySequence}`,
      }, ...args);
    },
  });
}

function trustedExternalReadback(
  ticket,
  targetCommit,
  verifiedAt,
  verificationScope = ticket?.action?.kind === "github.merge"
    ? "github_merge_and_checks_only"
    : "full_release",
) {
  const binding = ticket.release_manifest_binding;
  const action = ticket.action;
  const requiredChecks = [...binding.verification.required_checks];
  const observedChecks = requiredChecks.map((name) => ({
    name,
    head_commit: binding.verification.checks_commit,
    status: "completed",
    conclusion: "success",
  }));
  const mergeAction = action.kind === "github.merge";
  const observeAction = action.kind === "render.observe";
  const sourceAction = observeAction ? ticket.predecessor.source_action : action;
  const ownerManualMerge = observeAction && ticket.predecessor.predecessor_type ===
    "owner_manual_github_merge_readback";
  const sourceMerge = sourceAction.kind === "github.merge";
  const githubUnsigned = {
    api_origin: "https://api.github.com",
    repository: ticket.repository,
    action_kind: action.kind,
    head_branch: sourceMerge ? sourceAction.head_branch : action.branch || null,
    base_branch: sourceMerge ? sourceAction.base_branch : null,
    pull_request: mergeAction || sourceMerge ? sourceAction.pull_request : null,
    merged: mergeAction || sourceMerge ? true : null,
    head_commit: sourceAction.head_commit || binding.verification.checks_commit,
    expected_base_commit: sourceAction.expected_base_commit ||
      sourceAction.expected_remote_commit || binding.base_commit,
    merge_commit: mergeAction || sourceMerge ? targetCommit : null,
    target_commit: targetCommit,
    branch: action.branch || action.base_branch || null,
    branch_commit: mergeAction ? null : targetCommit,
    checks_commit: binding.verification.checks_commit,
    checks_passed: true,
    required_checks: requiredChecks,
    observed_checks: observedChecks,
    rollback_commit: binding.rollback.target_commit,
    rollback_commit_available: true,
    ...(action.kind === "render.deploy" && action.environment === "production" ? {
      required_checks_policy_digest:
        ticket.release_join_resolution.required_checks_policy_digest,
    } : {}),
    ...(observeAction ? {
      source_action_kind: sourceAction.kind,
      source_action_digest: ticket.predecessor.source_action_digest,
      ...(ownerManualMerge ? {
        manual_merge_readback_id: ticket.predecessor.manual_merge_readback_id,
        manual_merge_readback_digest:
          ticket.predecessor.manual_merge_readback_digest,
        source_readback_digest: ticket.predecessor.source_readback_digest,
      } : {
        predecessor_ticket_id: ticket.predecessor.ticket_id,
        predecessor_ticket_digest: ticket.predecessor.ticket_digest,
      }),
    } : {}),
  };
  const services = (verificationScope === "github_merge_and_checks_only"
    ? []
    : binding.services).map((expected) => {
    const unsigned = {
      service_id: expected.service_id,
      environment: expected.environment,
      origin: expected.origin,
      health_path: "/healthz",
      deployment_id: `dep-${expected.service_id}`,
      live_commit: expected.target_commit || targetCommit,
      version: "test-1.0.0",
      health_status: "healthy",
      health_contract_digest: expected.health_contract_digest,
      previous_live_commit: expected.expected_previous_commit,
      rollback_commit: binding.rollback.target_commit,
      rollback_status: "previous_live_attested",
    };
    return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
  });
  return {
    schema_version: "host_native_external_readback_v1",
    trusted: true,
    verifier_id: "core_server_external_readback_v1",
    verification_scope: verificationScope,
    verified_at: verifiedAt,
    github: { ...githubUnsigned, readback_digest: hostNativeDigest(githubUnsigned) },
    services,
    external_side_effect: false,
    provider_execution: false,
  };
}

function redigestTrustedReadback(readback) {
  const githubUnsigned = { ...readback.github };
  delete githubUnsigned.readback_digest;
  const services = readback.services.map((service) => {
    const unsigned = { ...service };
    delete unsigned.readback_digest;
    return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
  });
  return {
    ...readback,
    github: { ...githubUnsigned, readback_digest: hostNativeDigest(githubUnsigned) },
    services,
  };
}

function trustedJoinResolution(request, clock) {
  const sourceUnsigned = {
    schema_version: "host_native_source_attestation_v1",
    repository: request.repository,
    evidence_kind: request.action.kind === "github.merge"
      ? "github_pull_request_files"
      : "github_compare_files",
    pull_request: request.action.kind === "github.merge"
      ? request.action.pull_request
      : null,
    ...request.source_evidence,
  };
  const sourceAttestation = {
    ...sourceUnsigned,
    attestation_digest: hostNativeDigest(sourceUnsigned),
  };
  const previousLiveAttestations = request.delivery_services.map((service) => {
    const unsigned = {
      service_id: service.service_id,
      environment: service.environment,
      origin: service.origin,
      health_path: "/healthz",
      deployment_id: `previous-${service.service_id}`,
      live_commit: service.expected_previous_commit,
      health_status: "healthy",
      health_contract_digest: service.health_contract_digest,
    };
    return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
  });
  return {
    schema_version: "host_native_release_join_resolution_v1",
    trusted: true,
    authority: "universal_core",
    allowed: true,
    verdict_id: request.verdict_id,
    tenant_id: request.tenant_id,
    work_id: request.work_id,
    intent_anchor_digest: request.intent_anchor_digest,
    repository: request.repository,
    checks_commit: request.checks_commit,
    evidence_digest: request.evidence_digest,
    issued_at: new Date(clock).toISOString(),
    resolved_at: new Date(clock).toISOString(),
    source_attestation: sourceAttestation,
    previous_live_attestations: previousLiveAttestations,
    pre_action_readback_digest: hostNativeDigest({
      source_attestation: sourceAttestation,
      previous_live_attestations: previousLiveAttestations,
    }),
    ...(request.action.kind === "render.deploy" && request.action.environment === "production" ? {
      required_checks_policy_digest: request.required_checks_policy_digest || H("7"),
    } : {}),
    provider_execution: false,
  };
}

function harness({
  budget = {},
  allowedActions,
  clockStart = "2026-07-29T10:00:00.000Z",
  coreJoinTtlMs,
  ticketTtlMs,
  reservationLeaseMs,
  store = createInMemoryHostNativeGovernanceStore(),
  signingSecret = "host-native-governance-test-signing-secret-at-least-32-bytes",
  externalReadbackVerifier,
  ownerManualMergeReadbackVerifier,
  unreservedEffectVerifier,
  releaseJoinVerdictResolver,
  renderServiceOriginResolver,
  bootstrapReleaseExceptionStore,
  bootstrapDeadlockVerdictResolver,
  requiredChecksPolicyResolver,
  semanticScopeGuard,
  semanticScopeMode,
  semanticScopeContextResolver,
} = {}) {
  let clock = Date.parse(clockStart);
  let sequence = 0;
  const governance = withTestIdempotency(createHostNativeGovernance({
    store,
    signingSecret,
    closureAttestationSigningSecret: CLOSURE_ATTESTATION_SECRET,
    now: () => clock,
    idFactory: () => `id-${++sequence}`,
    externalReadbackVerifier: externalReadbackVerifier === undefined
      ? (async ({ ticket, target_commit, verification_scope }) =>
        trustedExternalReadback(
          ticket,
          target_commit,
          new Date(clock).toISOString(),
          verification_scope,
        ))
      : externalReadbackVerifier,
    ownerManualMergeReadbackVerifier: ownerManualMergeReadbackVerifier || null,
    unreservedEffectVerifier: unreservedEffectVerifier || null,
    bootstrapReleaseExceptionStore: bootstrapReleaseExceptionStore || null,
    bootstrapDeadlockVerdictResolver: bootstrapDeadlockVerdictResolver || null,
    releaseJoinVerdictResolver: releaseJoinVerdictResolver === undefined
      ? (async (request) => trustedJoinResolution(request, clock))
      : releaseJoinVerdictResolver,
    requiredChecksPolicyResolver: requiredChecksPolicyResolver || null,
    renderServiceOriginResolver: renderServiceOriginResolver || null,
    ...(ticketTtlMs === undefined ? {} : { ticketTtlMs }),
    ...(coreJoinTtlMs === undefined ? {} : { coreJoinTtlMs }),
    ...(reservationLeaseMs === undefined ? {} : { reservationLeaseMs }),
    ...(semanticScopeGuard === undefined ? {} : { semanticScopeGuard }),
    ...(semanticScopeMode === undefined ? {} : { semanticScopeMode }),
    ...(semanticScopeContextResolver === undefined ? {} : { semanticScopeContextResolver }),
  }));
  const delegationInput = {
    tenant_id: "codexai",
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "owner-consent-nonce-issue-0001",
      confirmation_reference: "owner confirmed bounded host-native work",
    },
    audience: ["chatgpt_native", "codex_native"],
    allowed_branches: ["agent/*", "main"],
    protected_branches: ["main"],
    allowed_path_prefixes: ["services/universal-core-service", "render-universal-core.yaml"],
    allowed_actions: allowedActions || [
      "native_agent.spawn",
      "git.commit",
      "git.push.branch",
      "git.push.protected",
      "github.draft_pr",
      "github.ready",
      "github.merge",
      "render.deploy",
      "render.observe",
      "render.rollback",
    ],
    budget: {
      max_agents: 3,
      max_parallel: 2,
      max_commits: 3,
      max_pushes: 2,
      max_deploys: 2,
      max_total_actions: 8,
      ...budget,
    },
    release_policy: {
      manifest_required_for_protected_push: true,
      manifest_required_for_induced_deploy: true,
      manifest_required_for_deploy: true,
      independent_verifier_required: true,
      rollback_required: true,
      required_checks: ["unit-tests"],
    },
    expires_at: new Date(clock + 60 * 60 * 1_000).toISOString(),
  };
  return {
    governance,
    delegationInput,
    advance(ms) { clock += ms; },
    now() { return clock; },
  };
}

function commitAction(overrides = {}) {
  return {
    kind: "git.commit",
    repository: "owner/repo",
    branch: "agent/native-work",
    parent_commit: G("1"),
    tree_sha: G("2"),
    diff_digest: H("2"),
    changed_files: ["services/universal-core-service/src/hostNativeGovernance.js"],
    message_digest: H("3"),
    builder_agent_id: "builder-1",
    provider_execution: false,
    ...overrides,
  };
}

function protectedPushAction(overrides = {}) {
  return {
    kind: "git.push.protected",
    repository: "owner/repo",
    branch: "main",
    source_commit: G("4"),
    expected_remote_commit: G("1"),
    force: false,
    delete_ref: false,
    tags: false,
    induced_effects: [{
      service_id: "srv-core",
      environment: "production",
      target_commit: G("4"),
      trigger: "github_auto_deploy",
    }],
    provider_execution: false,
    ...overrides,
  };
}

function githubMergeAction(overrides = {}) {
  return {
    kind: "github.merge",
    repository: "owner/repo",
    head_branch: "agent/native-work",
    base_branch: "main",
    pull_request: 42,
    head_commit: G("3"),
    expected_base_commit: G("1"),
    merge_method: "merge",
    checks_verified: true,
    checks_commit: G("3"),
    force: false,
    delete_ref: false,
    tags: false,
    induced_effects: [{
      service_id: "srv-core",
      environment: "production",
      trigger: "github_auto_deploy",
    }],
    provider_execution: false,
    ...overrides,
  };
}

function mergeReleaseManifestInput(overrides = {}) {
  return releaseManifestInput({
    head_commit: G("3"),
    tree_sha: G("6"),
    verification: {
      ...releaseManifestInput().verification,
      checks_commit: G("3"),
    },
    delivery: {
      method: "github_protected_push_auto_deploy",
      services: [{
        service_id: "srv-core",
        environment: "production",
        expected_previous_commit: G("1"),
        target_commit: null,
        target_resolution: "post_merge_readback",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      }],
    },
    ...overrides,
  });
}

function releaseManifestInput(overrides = {}) {
  const input = {
    schema_version: "host_release_manifest_v2",
    manifest_id: "manifest-1",
    tenant_id: "codexai",
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    base_branch: "main",
    delivery_branch: "main",
    base_commit: G("1"),
    head_commit: G("4"),
    tree_sha: G("5"),
    changed_files: ["services/universal-core-service/src/hostNativeGovernance.js"],
    verification: {
      builder_agent_id: "builder-1",
      verifier_agent_ids: ["verifier-1"],
      required_checks: ["unit-tests"],
      checks_commit: G("4"),
      checks_digest: H("5"),
      evidence_digest: H("6"),
      core_join_verdict_id: "join-1",
    },
    delivery: {
      method: "github_protected_push_auto_deploy",
      services: [{
        service_id: "srv-core",
        environment: "production",
        expected_previous_commit: G("1"),
        target_commit: G("4"),
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      }],
    },
    rollback: {
      mode: "forward_revert",
      target_commit: G("1"),
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      ready: true,
    },
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "diff_digest")) {
    input.diff_digest = hostNativeGithubDiffDigest({
      repository: input.repository,
      base_commit: input.base_commit,
      head_commit: input.head_commit,
      tree_sha: input.tree_sha,
      changed_files: input.changed_files,
    });
  }
  return input;
}

function coreJoinInput(manifest, overrides = {}) {
  const input = {
    tenant_id: manifest.tenant_id,
    work_id: manifest.work_id,
    intent_anchor_digest: manifest.intent_anchor_digest,
    repository: manifest.repository,
    core_plan_id: `hnp_${H("a").slice(0, 40)}`,
    core_plan_digest: H("a"),
    local_plan_id: "local-plan-1",
    local_plan_digest: H("b"),
    evaluation_digest: manifest.verification.evidence_digest,
    acceptance_criteria: [{
      criterion_id: "tests-green",
      evidence_digest: H("c"),
      proven: true,
    }],
    builder_report: {
      agent_id: manifest.verification.builder_agent_id,
      report_digest: H("d"),
      target_commit: manifest.verification.checks_commit,
    },
    verifier_reports: manifest.verification.verifier_agent_ids.map((agentId) => ({
      agent_id: agentId,
      report_digest: H("e"),
      reviewed_commit: manifest.verification.checks_commit,
      approved: true,
    })),
    checks: {
      commit: manifest.verification.checks_commit,
      required_checks: [...manifest.verification.required_checks],
      checks_digest: manifest.verification.checks_digest,
      evidence_digest: H("f"),
    },
    release_intent: deriveHostReleaseIntentV1(manifest),
    provider_execution: false,
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "closure_attestation")) {
    const stable = (value) => {
      if (Array.isArray(value)) return value.map(stable);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(
        Object.keys(value).sort().flatMap((key) =>
          value[key] === undefined ? [] : [[key, stable(value[key])]]),
      );
    };
    const reportBindings = [
      {
        task_id: "build",
        agent_id: input.builder_report.agent_id,
        task_kind: "builder",
        report_digest: input.builder_report.report_digest,
        native_session_fingerprint: "1".repeat(32),
        native_presence_signature: `ags_${"1".repeat(32)}`,
      },
      ...input.verifier_reports.map((report, index) => ({
        task_id: `verify-${index + 1}`,
        agent_id: report.agent_id,
        task_kind: "verifier",
        report_digest: report.report_digest,
        native_session_fingerprint: String(index + 2).repeat(32),
        native_presence_signature: `ags_${String(index + 2).repeat(32)}`,
      })),
    ];
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
      report_bindings: reportBindings,
      provider_execution: false,
      ...(input.core_join_renewal
        ? { core_join_renewal: input.core_join_renewal }
        : {}),
    };
    input.closure_attestation = {
      ...unsigned,
      signature: `hnca_${crypto.createHmac(
        "sha256",
        CLOSURE_ATTESTATION_SECRET,
      )
        .update(
          `host-native-closure-attestation-v1\u0000${JSON.stringify(stable(unsigned))}`,
        )
        .digest("hex")}`,
    };
  }
  return input;
}

async function bindCoreJoinVerdict(governance, manifest) {
  const record = await governance.issueCoreJoinVerdict(coreJoinInput(manifest));
  return manifestWithCoreJoin(manifest, record.verdict.verdict_id);
}

function manifestWithCoreJoin(manifest, verdictId) {
  const { manifest_digest: _manifestDigest, ...unsigned } = manifest;
  return buildHostReleaseManifestV2({
    ...unsigned,
    verification: {
      ...unsigned.verification,
      core_join_verdict_id: verdictId,
    },
  });
}

function rewriteStoredManualMergeAsLegacy(
  store,
  joinId,
  receiptId,
  legacyDiffDigest,
  { recordedAt } = {},
) {
  return store.mutate((state) => {
    const record = structuredClone(state.core_join_verdicts[joinId]);
    const receipt = structuredClone(state.owner_manual_merge_readbacks[receiptId]);
    delete state.core_join_verdicts[joinId];
    delete state.owner_manual_merge_readbacks[receiptId];
    delete record.manual_merge_readback_receipt_id;
    delete record.manual_merge_readback_receipt_digest;

    const { release_intent_digest: _oldIntentDigest, ...intentUnsigned } =
      record.release_intent;
    record.release_intent = {
      ...intentUnsigned,
      diff_digest: legacyDiffDigest,
    };
    record.release_intent.release_intent_digest = hostNativeDigest(
      record.release_intent,
    );
    record.claim.release_intent_digest =
      record.release_intent.release_intent_digest;
    record.claim_digest = hostNativeDigest(record.claim);
    record.verdict_id = `hnj_${record.claim_digest.slice(0, 40)}`;
    const { signature: _oldVerdictSignature, ...verdictUnsigned } = record.verdict;
    record.verdict = {
      ...verdictUnsigned,
      verdict_id: record.verdict_id,
      claim_digest: record.claim_digest,
      release_intent_digest: record.release_intent.release_intent_digest,
    };
    record.verdict.signature = signedTestDomain(
      "hnj",
      canonicalForSignature(record.verdict),
    );
    const recordDigestBeforeReceipt = hostNativeDigest(record);

    receipt.core_join_verdict_id = record.verdict_id;
    receipt.core_join_record_digest = recordDigestBeforeReceipt;
    if (recordedAt) receipt.recorded_at = recordedAt;
    receipt.predecessor.core_join_verdict_id = record.verdict_id;
    receipt.predecessor.core_join_record_digest = recordDigestBeforeReceipt;
    const { predecessor_digest: _oldPredecessorDigest, ...predecessorUnsigned } =
      receipt.predecessor;
    receipt.predecessor.predecessor_digest = hostNativeDigest(predecessorUnsigned);
    receipt.receipt_id = `hnmmr_${hostNativeDigest({
      tenant_id: receipt.tenant_id,
      work_id: receipt.work_id,
      core_join_verdict_id: record.verdict_id,
      pull_request: receipt.pull_request,
      readback_digest: receipt.github_readback.readback_digest,
    }).slice(0, 40)}`;
    const {
      signature: _oldReceiptSignature,
      receipt_digest: _oldReceiptDigest,
      ...receiptUnsigned
    } = receipt;
    receipt.receipt_digest = hostNativeDigest(receiptUnsigned);
    receipt.signature = signedTestDomain(
      "hnmmr",
      canonicalForSignature({ ...receiptUnsigned, receipt_digest: receipt.receipt_digest }),
    );
    record.manual_merge_readback_receipt_id = receipt.receipt_id;
    record.manual_merge_readback_receipt_digest = receipt.receipt_digest;
    state.core_join_verdicts[record.verdict_id] = record;
    state.owner_manual_merge_readbacks[receipt.receipt_id] = receipt;
    return { record: structuredClone(record), receipt: structuredClone(receipt) };
  });
}

function rewriteStoredManualMergeRecordedAt(store, receiptId, recordedAt) {
  return store.mutate((state) => {
    const receipt = structuredClone(
      state.owner_manual_merge_readbacks[receiptId],
    );
    receipt.recorded_at = recordedAt;
    const {
      signature: _oldSignature,
      receipt_digest: _oldDigest,
      ...receiptUnsigned
    } = receipt;
    receipt.receipt_digest = hostNativeDigest(receiptUnsigned);
    receipt.signature = signedTestDomain(
      "hnmmr",
      canonicalForSignature({
        ...receiptUnsigned,
        receipt_digest: receipt.receipt_digest,
      }),
    );
    state.owner_manual_merge_readbacks[receiptId] = receipt;
    state.core_join_verdicts[receipt.core_join_verdict_id]
      .manual_merge_readback_receipt_digest = receipt.receipt_digest;
    return structuredClone(receipt);
  });
}

async function issueCommitTicket(governance, delegationId, overrides = {}) {
  return governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegationId,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "session-fingerprint-codex-1",
    action: commitAction(),
    evidence_digest: H("9"),
    ...overrides,
  });
}

test("semantic scope guard is correlated at ticket issue and AEC reservation in shadow mode", async () => {
  const guard = createSemanticScopeGuard({ mode: "SHADOW" });
  const subject = harness({
    allowedActions: ["git.commit"],
    semanticScopeGuard: guard,
    semanticScopeMode: "SHADOW",
    semanticScopeContextResolver: () => ({
      entity360_snapshot_ref: `e360_${"a".repeat(48)}`,
      as_of_valid_time: "2026-07-29T10:00:00.000Z",
      as_of_knowledge_time: "2026-07-29T10:00:00.000Z",
      policy_revision: "entity360-policy-v1",
      evidence_refs: ["entity360:evidence:commit"],
    }),
  });
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const issued = await issueCommitTicket(subject.governance, delegation.delegation_id);
  assert.equal(issued.ticket.semantic_scope_at_issue.action, "ALLOW");
  assert.equal(issued.ticket.semantic_scope_at_issue.execution_authorized, false);
  assert.equal(issued.ticket.semantic_scope_at_issue.binding.entity360_snapshot_ref,
    `e360_${"a".repeat(48)}`);
  assert.equal(issued.ticket.semantic_scope_at_issue.binding.as_of_knowledge_time,
    "2026-07-29T10:00:00.000Z");

  const reserved = await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  assert.equal(reserved.semantic_scope_at_reservation.action, "ALLOW");
  assert.equal(reserved.semantic_scope_at_reservation.authority, "universal_core");
  assert.ok(reserved.lifecycle_digest);
  assert.equal(guard.metrics().check_total, 2);
  assert.equal(subject.governance.semantic_scope_guard_mode, "SHADOW");
  assert.equal(subject.governance.semanticScopeMetrics().semantic_scope_check_latency >= 0, true);
});

test("unavailable semantic scope context remains observable in shadow and fails closed in enforce", async () => {
  const unavailableGuard = { check() { throw new Error("semantic_scope_dependency_unavailable"); } };
  const shadow = harness({ allowedActions: ["git.commit"], semanticScopeGuard: unavailableGuard,
    semanticScopeMode: "SHADOW" });
  const shadowDelegation = await shadow.governance.issueDelegation(shadow.delegationInput);
  const shadowTicket = await issueCommitTicket(shadow.governance, shadowDelegation.delegation_id);
  assert.equal(shadowTicket.ticket.semantic_scope_at_issue.action, "HOLD");
  assert.match(shadowTicket.ticket.semantic_scope_at_issue.reason_codes.join(","),
    /SEMANTIC_SCOPE_CONTEXT_UNAVAILABLE/);

  const enforce = harness({ allowedActions: ["git.commit"], semanticScopeGuard: unavailableGuard,
    semanticScopeMode: "ENFORCE" });
  const enforceDelegation = await enforce.governance.issueDelegation(enforce.delegationInput);
  await assert.rejects(() => issueCommitTicket(enforce.governance, enforceDelegation.delegation_id),
    /semantic_scope_hold/);
});

test("missing semantic context fails closed for a medium-risk effect in enforce mode", async () => {
  const guard = createSemanticScopeGuard({ mode: "ENFORCE" });
  const subject = harness({ allowedActions: ["git.commit"], semanticScopeGuard: guard,
    semanticScopeMode: "ENFORCE", semanticScopeContextResolver: null });
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  await assert.rejects(() => issueCommitTicket(subject.governance, delegation.delegation_id),
    /semantic_scope_hold/);
});

async function issueMergeTicket(governance, delegationId, overrides = {}) {
  const manifest = await bindCoreJoinVerdict(
    governance,
    buildHostReleaseManifestV2(mergeReleaseManifestInput()),
  );
  return governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegationId,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "session-fingerprint-codex-merge",
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: manifest,
    ...overrides,
  });
}

async function prepareFinalizableMerge(subject) {
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const issued = await issueMergeTicket(subject.governance, delegation.delegation_id);
  const reserved = await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  const completed = await subject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("a"),
    result_commit: G("4"),
    readback_digest: H("b"),
  });
  return { delegation, issued, reserved, completed };
}

function bootstrapReleaseExceptionStore({ expiresAt = "2026-07-29T11:00:00.000Z", verifyError = null, consumeError = null, candidateExceptionId = null } = {}) {
  const calls = { verify: [], consume: [] };
  return {
    calls,
    async verifyAndRecord({ receipt, expected }) {
      calls.verify.push({ receipt, expected });
      if (verifyError) throw new Error(verifyError);
      return { candidate: {
        exception_id: candidateExceptionId || expected.bootstrap_deadlock_verdict.exception_id,
        receipt_digest: H("b"),
        tenant_id: expected.tenant_id,
        work_id: expected.work_id,
        repository: expected.repository,
        pr_number: expected.pr_number,
        head_sha: expected.head_sha,
        allowed_action: expected.action,
        expires_at: expiresAt,
      } };
    },
    async consume(input) {
      calls.consume.push(input);
      if (consumeError) throw new Error(consumeError);
      return { consumed: true };
    },
  };
}

function bootstrapDeadlockVerdictResolver({ expiresAt = "2026-07-29T11:00:00.000Z", classification = "BOOTSTRAP_DEADLOCK_VERIFIED", active = true, digestOverride = null, exceptionIdOverride = null, error = null } = {}) {
  const calls = [];
  return Object.assign(async (input) => {
    calls.push(input);
    if (error) throw new Error(error);
    return {
      classification,
      active,
      expires_at: expiresAt,
      exception_id: exceptionIdOverride || input.exception_id,
      core_policy_verdict_digest: digestOverride || input.core_policy_verdict_digest,
    };
  }, { calls });
}

test("bootstrap receipt is server-verified, ticket-bound, and consumed only at merge reservation", async () => {
  const bootstrapStore = bootstrapReleaseExceptionStore();
  const deadlockResolver = bootstrapDeadlockVerdictResolver();
  const subject = harness({ bootstrapReleaseExceptionStore: bootstrapStore, bootstrapDeadlockVerdictResolver: deadlockResolver, releaseJoinVerdictResolver: null });
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const manifest = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  const issued = await subject.governance.issueActionTicket({
    tenant_id: "codexai", delegation_id: delegation.delegation_id, work_id: "work-1", intent_anchor_digest: H("1"), repository: "owner/repo",
    host_kind: "codex_native", host_session_fingerprint: "bootstrap-merge-session", action: githubMergeAction(), evidence_digest: H("6"), release_manifest: manifest,
    bootstrap_release_exception_receipt: { opaque: "external-signed-receipt", exception_id: "bootstrap-exception-1", core_policy_verdict_digest: H("c") },
  });
  assert.equal(bootstrapStore.calls.verify.length, 1);
  assert.equal(deadlockResolver.calls.length, 1);
  assert.equal(bootstrapStore.calls.verify[0].expected.bootstrap_deadlock_verdict.classification, "BOOTSTRAP_DEADLOCK_VERIFIED");
  assert.equal(issued.ticket.bootstrap_release_exception_candidate.exception_id, "bootstrap-exception-1");
  assert.equal(issued.ticket.core_join_verdict_id, undefined);
  const reserved = await subject.governance.reserveActionTicket({ tenant_id: "codexai", ticket_id: issued.ticket.ticket_id, host_session_fingerprint: issued.ticket.host_session_fingerprint });
  assert.equal(reserved.state, "reserved");
  assert.equal(bootstrapStore.calls.consume.length, 1);
  assert.equal(bootstrapStore.calls.consume[0].action_ticket_id, issued.ticket.ticket_id);
  await assert.rejects(subject.governance.reserveActionTicket({ tenant_id: "codexai", ticket_id: issued.ticket.ticket_id, host_session_fingerprint: issued.ticket.host_session_fingerprint }), /replayed/);
});

test("bootstrap receipt fails closed for missing store, deny, expiry, replay, and non-merge actions", async () => {
  const resolver = bootstrapDeadlockVerdictResolver();
  const receipt = { exception_id: "bootstrap-exception-1", core_policy_verdict_digest: H("c") };
  const missing = harness({ bootstrapDeadlockVerdictResolver: resolver }); const missingDelegation = await missing.governance.issueDelegation(missing.delegationInput);
  await assert.rejects(issueMergeTicket(missing.governance, missingDelegation.delegation_id, { bootstrap_release_exception_receipt: receipt }), /bootstrap_release_exception_store_unavailable/);
  const deniedStore = bootstrapReleaseExceptionStore({ verifyError: "bootstrap_release_exception_denied" });
  const denied = harness({ bootstrapReleaseExceptionStore: deniedStore, bootstrapDeadlockVerdictResolver: resolver }); const deniedDelegation = await denied.governance.issueDelegation(denied.delegationInput);
  await assert.rejects(issueMergeTicket(denied.governance, deniedDelegation.delegation_id, { bootstrap_release_exception_receipt: receipt }), /bootstrap_release_exception_denied/);
  const expiredStore = bootstrapReleaseExceptionStore({ expiresAt: "2026-07-29T09:00:00.000Z" });
  const expired = harness({ bootstrapReleaseExceptionStore: expiredStore, bootstrapDeadlockVerdictResolver: resolver }); const expiredDelegation = await expired.governance.issueDelegation(expired.delegationInput);
  await assert.rejects(issueMergeTicket(expired.governance, expiredDelegation.delegation_id, { bootstrap_release_exception_receipt: receipt }), /bootstrap_release_exception_denied/);
  const replayStore = bootstrapReleaseExceptionStore({ consumeError: "bootstrap_release_exception_replayed" });
  const replay = harness({ bootstrapReleaseExceptionStore: replayStore, bootstrapDeadlockVerdictResolver: resolver, releaseJoinVerdictResolver: null }); const replayDelegation = await replay.governance.issueDelegation(replay.delegationInput);
  const replayTicket = await replay.governance.issueActionTicket({ tenant_id: "codexai", delegation_id: replayDelegation.delegation_id, work_id: "work-1", intent_anchor_digest: H("1"), repository: "owner/repo", host_kind: "codex_native", host_session_fingerprint: "bootstrap-replay-session", action: githubMergeAction(), evidence_digest: H("6"), release_manifest: buildHostReleaseManifestV2(mergeReleaseManifestInput()), bootstrap_release_exception_receipt: receipt });
  await assert.rejects(replay.governance.reserveActionTicket({ tenant_id: "codexai", ticket_id: replayTicket.ticket.ticket_id, host_session_fingerprint: replayTicket.ticket.host_session_fingerprint }), /bootstrap_release_exception_replayed/);
  const nonMerge = harness({ bootstrapReleaseExceptionStore: bootstrapReleaseExceptionStore(), bootstrapDeadlockVerdictResolver: resolver }); const nonMergeDelegation = await nonMerge.governance.issueDelegation(nonMerge.delegationInput);
  await assert.rejects(issueCommitTicket(nonMerge.governance, nonMergeDelegation.delegation_id, { bootstrap_release_exception_receipt: receipt }), /bootstrap_release_exception_action_not_allowed/);
});

test("bootstrap receipt requires a live, scope-bound server-resolved deadlock verdict", async () => {
  const receipt = { exception_id: "bootstrap-exception-1", core_policy_verdict_digest: H("d") };
  const request = async (subject) => {
    const delegation = await subject.governance.issueDelegation(subject.delegationInput);
    return issueMergeTicket(subject.governance, delegation.delegation_id, { bootstrap_release_exception_receipt: receipt });
  };
  await assert.rejects(request(harness({ bootstrapReleaseExceptionStore: bootstrapReleaseExceptionStore() })), /bootstrap_deadlock_verdict_unavailable/);
  for (const resolver of [
    bootstrapDeadlockVerdictResolver({ classification: "NORMAL_RELEASE" }),
    bootstrapDeadlockVerdictResolver({ active: false }),
    bootstrapDeadlockVerdictResolver({ expiresAt: "2026-07-29T09:00:00.000Z" }),
    bootstrapDeadlockVerdictResolver({ digestOverride: H("e") }),
    bootstrapDeadlockVerdictResolver({ exceptionIdOverride: "bootstrap-exception-other" }),
    bootstrapDeadlockVerdictResolver({ error: "bootstrap_deadlock_verdict_denied" }),
  ]) {
    await assert.rejects(request(harness({ bootstrapReleaseExceptionStore: bootstrapReleaseExceptionStore(), bootstrapDeadlockVerdictResolver: resolver })), /bootstrap_deadlock_verdict_denied/);
  }
  await assert.rejects(
    request(harness({
      bootstrapReleaseExceptionStore: bootstrapReleaseExceptionStore({ candidateExceptionId: "bootstrap-exception-other" }),
      bootstrapDeadlockVerdictResolver: bootstrapDeadlockVerdictResolver(),
    })),
    /bootstrap_release_exception_denied/,
  );
});

test("host-native work plan has zero provider execution and requires host materialization", () => {
  const plan = buildHostNativeWorkPlan({
    tenant_id: "codexai",
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    objective: "Implement and verify the bounded host-native runtime.",
    required_checks: ["unit-tests"],
    max_parallel: 2,
    agents: [
      { agent_id: "builder", role: "builder", task: "Implement.", depends_on: [], capabilities: ["workspace_write"] },
      { agent_id: "verifier", role: "verifier", task: "Verify.", depends_on: ["builder"], capabilities: ["workspace_read"] },
    ],
  });
  assert.equal(plan.execution_adapter, "host_native");
  assert.equal(plan.provider_execution, false);
  assert.equal(plan.provider_api_key_required, false);
  assert.equal(plan.server_model_calls, 0);
  assert.equal(plan.host_materialization_required, true);
  assert.equal(plan.materialization_status, "planned_not_spawned");
  assert.equal(plan.host_policy_override, false);
  assert.equal(plan.host_policy_must_allow, true);
  assert.throws(() => buildHostNativeWorkPlan({
    tenant_id: "codexai",
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    objective: "cycle",
    required_checks: ["unit-tests"],
    agents: [
      { agent_id: "one", role: "worker", task: "one", depends_on: ["two"], capabilities: [] },
      { agent_id: "two", role: "worker", task: "two", depends_on: ["one"], capabilities: [] },
    ],
  }), /dependency_cycle/);
  assert.throws(() => buildHostNativeWorkPlan({
    tenant_id: "codexai",
    work_id: "work-too-wide",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    objective: "too many specialists",
    required_checks: ["unit-tests"],
    agents: ["one", "two", "three", "four"].map((agent_id) => ({
      agent_id, role: "worker", task: agent_id, depends_on: [], capabilities: [],
    })),
  }), /agents_invalid/);
  assert.throws(() => buildHostNativeWorkPlan({
    tenant_id: "codexai",
    work_id: "work-too-parallel",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    objective: "too much parallelism",
    required_checks: ["unit-tests"],
    max_parallel: 3,
    agents: ["one", "two", "three"].map((agent_id) => ({
      agent_id, role: "worker", task: agent_id, depends_on: [], capabilities: [],
    })),
  }), /max_parallel_invalid/);
});

test("bounded delegation fixes deny actions, host boundary, expiry, and owner replay", async () => {
  const subject = harness();
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  assert.equal(delegation.state, "active");
  assert.equal(delegation.grant.host_policy_override, false);
  assert.equal(delegation.grant.host_policy_must_allow, true);
  assert.equal(delegation.grant.provider_execution, false);
  assert.deepEqual(delegation.grant.absolute_deny_actions, [...HOST_NATIVE_ABSOLUTE_DENY_ACTIONS]);
  assert.equal(subject.governance.verifyDelegation(delegation), true);

  await assert.rejects(
    subject.governance.issueDelegation({ ...subject.delegationInput, work_id: "work-2" }),
    /owner_confirmation_replayed/,
  );
  await assert.rejects(subject.governance.issueDelegation({
    ...subject.delegationInput,
    owner_confirmation: {
      ...subject.delegationInput.owner_confirmation,
      consent_nonce: "owner-consent-nonce-forbidden-action",
    },
    allowed_actions: ["secrets.read"],
  }), /absolute_deny_action/);
  await assert.rejects(subject.governance.issueDelegation({
    ...subject.delegationInput,
    owner_confirmation: {
      ...subject.delegationInput.owner_confirmation,
      consent_nonce: "owner-consent-nonce-expiry-too-long",
    },
    expires_at: new Date(subject.now() + 13 * 60 * 60 * 1_000).toISOString(),
  }), /delegation_expiry_invalid/);
});

test("release manifest v2 uses canonical digest and rejects signed booleans, mutation, and self-review", () => {
  const manifest = buildHostReleaseManifestV2(releaseManifestInput());
  const verified = validateHostReleaseManifestV2(manifest, {
    tenant_id: "codexai",
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
  });
  assert.equal(verified.manifest_digest, manifest.manifest_digest);
  assert.throws(
    () => buildHostReleaseManifestV2({ ...releaseManifestInput(), signed: true }),
    /unknown_field:signed/,
  );
  assert.throws(
    () => validateHostReleaseManifestV2({ ...manifest, manifest_digest: H("f") }),
    /digest_mismatch/,
  );
  assert.throws(() => buildHostReleaseManifestV2(releaseManifestInput({
    verification: {
      ...releaseManifestInput().verification,
      verifier_agent_ids: ["builder-1"],
    },
  })), /self_verification_denied/);
  assert.throws(() => buildHostReleaseManifestV2(releaseManifestInput({
    verification: {
      ...releaseManifestInput().verification,
      checks_commit: G("3"),
    },
  })), /checks_commit_mismatch/);
  assert.throws(
    () => buildHostReleaseManifestV2({ ...releaseManifestInput(), core_join_allowed: true }),
    /unknown_field:core_join_allowed/,
  );
  assert.throws(() => buildHostReleaseManifestV2(releaseManifestInput({
    rollback: {
      ...releaseManifestInput().rollback,
      target_commit: G("2"),
    },
  })), /rollback_previous_commit_mismatch/);
  assert.throws(() => buildHostReleaseManifestV2(releaseManifestInput({
    rollback: {
      ...releaseManifestInput().rollback,
      health_contract_digest: H("a"),
    },
  })), /rollback_health_contract_unsupported/);
});

test("rollback modes bind the target to the real prior live commit without base substitution", () => {
  const baseCommit = "d0a8ee6ddb1f22f4164c995abd1f4e9f3e508f1e";
  const previousLiveCommit = "3a0370875a0adc090a3e8c71e363dd36725e1808";
  const targetCommit = "7d722fc258756ca8f4bb52105a3abe9ca8493828";
  const services = ["srv-core", "srv-core-mcp"].map((service_id) => ({
    service_id,
    environment: "production",
    expected_previous_commit: previousLiveCommit,
    target_commit: targetCommit,
    target_resolution: "exact_commit",
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  }));
  const realRollback = releaseManifestInput({
    base_commit: baseCommit,
    head_commit: targetCommit,
    tree_sha: "8fdff25c0e14f50b73b1b01ef0d232b54923d1a9",
    verification: {
      ...releaseManifestInput().verification,
      checks_commit: targetCommit,
    },
    delivery: { method: "manual_render_deploy", services },
    rollback: {
      mode: "redeploy_previous_commit",
      target_commit: previousLiveCommit,
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      ready: true,
    },
  });
  const normalized = buildHostReleaseManifestV2(realRollback);
  assert.equal(normalized.base_commit, baseCommit);
  assert.equal(normalized.rollback.target_commit, previousLiveCommit);

  assert.throws(() => buildHostReleaseManifestV2(releaseManifestInput({
    rollback: {
      ...releaseManifestInput().rollback,
      mode: "caller_selected_commit",
    },
  })), /rollback_mode_unsupported/);

  assert.throws(() => buildHostReleaseManifestV2(releaseManifestInput({
    ...realRollback,
    rollback: { ...realRollback.rollback, target_commit: baseCommit },
  })), /rollback_previous_commit_mismatch/);

  assert.throws(() => buildHostReleaseManifestV2(releaseManifestInput({
    ...realRollback,
    delivery: {
      ...realRollback.delivery,
      services: [
        services[0],
        { ...services[1], expected_previous_commit: G("2") },
      ],
    },
  })), /rollback_previous_commit_mismatch/);

  assert.throws(() => buildHostReleaseManifestV2(releaseManifestInput({
    ...realRollback,
    rollback: { ...realRollback.rollback, target_commit: G("f") },
  })), /rollback_previous_commit_mismatch/);
});

test("release intent is canonical, excludes verdict identity, and binds the complete release", () => {
  const manifest = buildHostReleaseManifestV2(releaseManifestInput());
  const intent = deriveHostReleaseIntentV1(manifest);
  assert.equal(intent.schema_version, "host_release_intent_v1");
  assert.equal(intent.manifest_id, undefined);
  assert.equal(intent.verification.core_join_verdict_id, undefined);
  assert.match(intent.release_intent_digest, /^[a-f0-9]{64}$/);
  const changed = buildHostReleaseManifestV2(releaseManifestInput({
    changed_files: [
      "services/universal-core-service/src/app.js",
      "services/universal-core-service/src/hostNativeGovernance.js",
    ],
  }));
  assert.notEqual(
    deriveHostReleaseIntentV1(changed).release_intent_digest,
    intent.release_intent_digest,
  );
});

test("Core join is signed, exact-release-bound, deterministic, and rejects invalid closure evidence", async () => {
  const subject = harness();
  const pending = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  const input = coreJoinInput(pending, { idempotency_key: "core-join-deterministic-1" });
  const first = await subject.governance.issueCoreJoinVerdict(input);
  const replay = await subject.governance.issueCoreJoinVerdict(input);
  const alternateKey = await subject.governance.issueCoreJoinVerdict({
    ...input,
    idempotency_key: "core-join-deterministic-2",
  });
  assert.deepEqual(replay, first);
  assert.deepEqual(alternateKey, first);
  assert.equal(subject.governance.verifyCoreJoinVerdict(first), true);
  assert.equal(first.verdict.claim_digest, first.claim_digest);
  assert.equal(
    first.verdict.verdict_id,
    `hnj_${first.claim_digest.slice(0, 40)}`,
  );
  const softwareBound = await subject.governance.issueCoreJoinVerdict(coreJoinInput(pending, {
    idempotency_key: "core-join-software-bound-v2",
    software_closure_digest: H("9"),
    software_closure_fresh_until: "2099-08-15T12:00:00.000Z",
  }));
  assert.equal(softwareBound.claim.schema_version, "host_native_core_join_claim_v2");
  assert.equal(softwareBound.claim.software_closure_digest, H("9"));
  assert.equal(softwareBound.claim.software_closure_fresh_until, "2099-08-15T12:00:00.000Z");
  assert.equal(softwareBound.verdict.schema_version, "host_native_core_join_v2");
  assert.equal(softwareBound.verdict.software_closure_digest, H("9"));
  assert.equal(subject.governance.verifyCoreJoinVerdict(softwareBound), true);

  const concurrent = await Promise.all([
    subject.governance.issueCoreJoinVerdict({
      ...input,
      idempotency_key: "core-join-deterministic-3",
    }),
    subject.governance.issueCoreJoinVerdict({
      ...input,
      idempotency_key: "core-join-deterministic-4",
    }),
  ]);
  assert.equal(concurrent[0].verdict.verdict_id, first.verdict.verdict_id);
  assert.equal(concurrent[1].verdict.verdict_id, first.verdict.verdict_id);

  await assert.rejects(subject.governance.issueCoreJoinVerdict(coreJoinInput(pending, {
    verifier_reports: [{
      agent_id: pending.verification.builder_agent_id,
      report_digest: H("e"),
      reviewed_commit: pending.verification.checks_commit,
      approved: true,
    }],
  })), /self_verification_denied/);
  await assert.rejects(subject.governance.issueCoreJoinVerdict(coreJoinInput(pending, {
    acceptance_criteria: [{
      criterion_id: "tests-green",
      evidence_digest: H("c"),
      proven: false,
    }],
  })), /criterion_unproven/);
  await assert.rejects(subject.governance.issueCoreJoinVerdict(coreJoinInput(pending, {
    builder_report: {
      agent_id: pending.verification.builder_agent_id,
      report_digest: H("d"),
      target_commit: G("2"),
    },
  })), /reviewed_commit_mismatch/);
  await assert.rejects(subject.governance.issueCoreJoinVerdict(coreJoinInput(pending, {
    core_plan_id: `hnp_${H("b").slice(0, 40)}`,
  })), /core_plan_binding_mismatch/);

  const changedRelease = buildHostReleaseManifestV2(mergeReleaseManifestInput({
    changed_files: [
      "services/universal-core-service/src/app.js",
      "services/universal-core-service/src/hostNativeGovernance.js",
    ],
  }));
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const manifestWithWrongIntent = manifestWithCoreJoin(
    changedRelease,
    first.verdict.verdict_id,
  );
  await assert.rejects(subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "wrong-release-intent",
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: manifestWithWrongIntent,
  }), /core_join_verdict_binding_mismatch/);
});

test("expired unused Core join renews with one signed successor and an identical release intent", async () => {
  const subject = harness({ coreJoinTtlMs: 1_000, ticketTtlMs: 2_000 });
  const initialManifest = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  const initial = await subject.governance.issueCoreJoinVerdict(coreJoinInput(
    initialManifest,
    { idempotency_key: "core-join-renewal-initial" },
  ));
  assert.equal(subject.governance.verifyCoreJoinVerdict(initial), true);

  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const initialTicket = await subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "core-join-renewal-session",
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: manifestWithCoreJoin(initialManifest, initial.verdict.verdict_id),
  });

  subject.advance(1_001);
  assert.equal(subject.governance.verifyCoreJoinVerdict(initial), false);

  const renewal = {
    schema_version: "continuity_core_join_renewal_v1",
    predecessor_verdict_id: initial.verdict_id,
    predecessor_claim_digest: initial.claim_digest,
    predecessor_release_intent_digest: initial.claim.release_intent_digest,
    predecessor_record_digest: hostNativeDigest(initial),
    generation: 1,
  };
  const renewalInput = coreJoinInput(initialManifest, {
    idempotency_key: "core-join-renewal-generation-1",
    core_join_renewal: renewal,
  });
  await assert.rejects(
    subject.governance.issueCoreJoinVerdict(renewalInput),
    /core_join_renewal_predecessor_unavailable/,
  );
  subject.advance(1_000);
  const [renewed, concurrentRenewed] = await Promise.all([
    subject.governance.issueCoreJoinVerdict(renewalInput),
    subject.governance.issueCoreJoinVerdict({
      ...renewalInput,
      idempotency_key: "core-join-renewal-generation-1-concurrent",
    }),
  ]);
  const replay = await subject.governance.issueCoreJoinVerdict(renewalInput);

  assert.notEqual(renewed.verdict_id, initial.verdict_id);
  assert.notEqual(renewed.claim_digest, initial.claim_digest);
  assert.equal(
    renewed.claim.release_intent_digest,
    initial.claim.release_intent_digest,
  );
  assert.deepEqual(renewed.claim.core_join_renewal, renewal);
  assert.equal(subject.governance.verifyCoreJoinVerdict(renewed), true);
  assert.deepEqual(concurrentRenewed, renewed);
  assert.deepEqual(replay, renewed);
  const supersededTicket = await subject.governance.readActionTicket({
    tenant_id: "codexai",
    ticket_id: initialTicket.ticket.ticket_id,
  });
  assert.equal(supersededTicket.state, "superseded");
  assert.equal(supersededTicket.superseded_by_core_join_verdict_id, renewed.verdict_id);
  await assert.rejects(subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: initialTicket.ticket.ticket_id,
    host_session_fingerprint: initialTicket.ticket.host_session_fingerprint,
  }), /replayed/);

  const generationTwo = {
    schema_version: "continuity_core_join_renewal_v1",
    predecessor_verdict_id: renewed.verdict_id,
    predecessor_claim_digest: renewed.claim_digest,
    predecessor_release_intent_digest: renewed.claim.release_intent_digest,
    predecessor_record_digest: hostNativeDigest(renewed),
    generation: 2,
  };
  await assert.rejects(subject.governance.issueCoreJoinVerdict(coreJoinInput(
    initialManifest,
    {
      idempotency_key: "core-join-renewal-too-early",
      core_join_renewal: generationTwo,
    },
  )), /core_join_renewal_not_expired/);

  subject.advance(1_001);
  const renewedTwice = await subject.governance.issueCoreJoinVerdict(coreJoinInput(
    initialManifest,
    {
      idempotency_key: "core-join-renewal-generation-2",
      core_join_renewal: generationTwo,
    },
  ));
  assert.notEqual(renewedTwice.verdict_id, renewed.verdict_id);
  assert.equal(renewedTwice.claim.release_intent_digest,
    initial.claim.release_intent_digest);
  assert.equal(renewedTwice.claim.core_join_renewal.generation, 2);
  assert.equal(subject.governance.verifyCoreJoinVerdict(renewedTwice), true);

  const tamperedStoredClaim = structuredClone(renewedTwice);
  tamperedStoredClaim.claim.core_join_renewal.predecessor_record_digest = H("0");
  assert.equal(subject.governance.verifyCoreJoinVerdict(tamperedStoredClaim), false);

  const divergentSuccessorInput = coreJoinInput(initialManifest, {
    idempotency_key: "core-join-renewal-divergent-successor",
    core_join_renewal: renewal,
    evaluation_digest: H("f"),
  });
  await assert.rejects(
    subject.governance.issueCoreJoinVerdict(divergentSuccessorInput),
    /core_join_renewal_binding_mismatch/,
  );

  await assert.rejects(subject.governance.issueCoreJoinVerdict(coreJoinInput(
    initialManifest,
    {
      idempotency_key: "core-join-renewal-tampered-predecessor",
      core_join_renewal: {
        ...renewal,
        predecessor_record_digest: H("0"),
      },
    },
  )), /core_join_renewal_binding_mismatch/);
});

test("expired trusted software closure cannot persist a release action ticket", async () => {
  const store = createInMemoryHostNativeGovernanceStore();
  const subject = harness({ store });
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const manifest = await bindCoreJoinVerdict(
    subject.governance,
    buildHostReleaseManifestV2(mergeReleaseManifestInput()),
  );
  const request = {
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "session-fingerprint-expired-software-closure",
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: manifest,
  };
  const ticketCount = Object.keys(store.readState().tickets).length;
  await assert.rejects(
    subject.governance.issueActionTicket(request, {
      software_closure_fresh_until: new Date(subject.now() - 1).toISOString(),
    }),
    /software_cognition_closure_expired_during_consumption/,
  );
  assert.equal(Object.keys(store.readState().tickets).length, ticketCount);
});

test("expiry during asynchronous Native policy resolution leaves no durable verdict", async () => {
  const store = createInMemoryHostNativeGovernanceStore();
  let subject;
  subject = harness({ store, requiredChecksPolicyResolver: async () => {
    subject.advance(20);
    return { schema_version: "host_native_required_checks_policy_v1", tenant_id: "codexai", repository: "owner/repo", base_branch: "main",
      required_checks: ["unit-tests"], check_app: { id: 15368, slug: "github-actions", owner: "github" },
      workflow: { id: 312527659, name: "Core", path: ".github/workflows/core.yml", sha256: H("7") },
      allowed_events: ["push"] };
  } });
  const pending = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  await assert.rejects(() => subject.governance.issueCoreJoinVerdict(coreJoinInput(pending, {
    idempotency_key: "core-join-expiry-during-resolution",
    software_closure_digest: H("9"),
    software_closure_fresh_until: new Date(subject.now() + 10).toISOString(),
  })), /software_cognition_closure_expired_during_issuance/);
  assert.equal(Object.keys(store.readState().core_join_verdicts).length, 0);
});

test("Core join is consumed atomically by one reserved release ticket and missing trust fails closed", async () => {
  const subject = harness();
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const pending = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  const join = await subject.governance.issueCoreJoinVerdict(coreJoinInput(pending));
  const manifest = manifestWithCoreJoin(pending, join.verdict.verdict_id);
  const issue = (session) => subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: session,
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: manifest,
  });
  const issued = await Promise.allSettled([issue("join-race-a"), issue("join-race-b")]);
  assert.equal(issued.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(issued.filter((result) => result.status === "rejected").length, 1);
  const activeJoin = await subject.governance.readCoreJoinVerdict({
    tenant_id: "codexai",
    verdict_id: join.verdict.verdict_id,
  });
  assert.equal(activeJoin.state, "active");
  assert.equal(activeJoin.uses, 0);
  const winningTicket = issued.find((result) => result.status === "fulfilled").value;
  await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: winningTicket.ticket.ticket_id,
    host_session_fingerprint: winningTicket.ticket.host_session_fingerprint,
  });
  const storedJoin = await subject.governance.readCoreJoinVerdict({
    tenant_id: "codexai",
    verdict_id: join.verdict.verdict_id,
  });
  assert.equal(storedJoin.state, "consumed");
  assert.equal(storedJoin.uses, 1);
  assert.match(storedJoin.consumed_by_ticket_id, /^hnt_/);

  const missingJoin = buildHostReleaseManifestV2({
    ...mergeReleaseManifestInput(),
    verification: {
      ...mergeReleaseManifestInput().verification,
      core_join_verdict_id: "hnj_missing",
    },
  });
  await assert.rejects(subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "missing-join",
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: missingJoin,
  }), /core_join_verdict_not_found/);

  const noResolver = harness({ releaseJoinVerdictResolver: null });
  const noResolverDelegation =
    await noResolver.governance.issueDelegation(noResolver.delegationInput);
  const noResolverPending = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  const noResolverJoin =
    await noResolver.governance.issueCoreJoinVerdict(coreJoinInput(noResolverPending));
  await assert.rejects(noResolver.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: noResolverDelegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "no-join-resolver",
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: manifestWithCoreJoin(
      noResolverPending,
      noResolverJoin.verdict.verdict_id,
    ),
  }), /release_join_verdict_unavailable/);
});

test("owner manual merge readback persists selector-bound evidence without a retroactive ticket", async () => {
  const store = createInMemoryHostNativeGovernanceStore();
  let verifierCalls = 0;
  const manualReadbackVerifier = async ({ tenant_id, repository, pull_request, core_join_record }) => {
    verifierCalls += 1;
    const unsigned = {
      schema_version: "host_native_owner_manual_merge_github_readback_v1",
      trusted: true,
      source: "universal_core_github_readback",
      tenant_id,
      repository,
      pull_request,
      merged: true,
      merged_at: "2026-07-29T10:00:00.000Z",
      head_branch: "agent/native-work",
      base_branch: core_join_record.claim.base_branch,
      base_commit: G("1"),
      head_commit: core_join_record.claim.checks.commit,
      merge_commit: G("9"),
      main_head_commit: G("9"),
      checks_commit: core_join_record.claim.checks.commit,
      checks_passed: true,
      required_checks: core_join_record.claim.checks.required_checks,
      observed_checks: [{
        name: "unit-tests", head_commit: core_join_record.claim.checks.commit,
        status: "completed", conclusion: "success",
      }],
      required_checks_policy_digest: core_join_record.claim.required_checks_policy_digest,
      checks_attestation_digest: H("8"),
      workflow_sources: [],
      verified_at: "2026-07-29T10:00:00.000Z",
      external_side_effect: false,
      provider_execution: false,
    };
    return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
  };
  Object.defineProperty(manualReadbackVerifier, "trusted", { value: true });
  const requiredChecksPolicyResolver = async () => ({
    schema_version: "host_native_required_checks_policy_v1",
    tenant_id: "codexai",
    repository: "owner/repo",
    base_branch: "main",
    required_checks: ["unit-tests"],
    check_app: { id: 1, slug: "github-actions", owner: "github" },
    workflow: {
      id: 1,
      name: "CI",
      path: ".github/workflows/ci.yml",
      sha256: H("7"),
      candidate_sha256: null,
    },
    allowed_events: ["pull_request"],
  });
  const subject = harness({
    store,
    ownerManualMergeReadbackVerifier: manualReadbackVerifier,
    requiredChecksPolicyResolver,
    externalReadbackVerifier: async ({ ticket, target_commit, verification_scope }) => {
      const readback = trustedExternalReadback(
        ticket,
        target_commit,
        "2026-07-29T10:00:00.000Z",
        verification_scope,
      );
      readback.github.required_checks_policy_digest =
        ticket.predecessor.source_required_checks_policy_digest;
      return redigestTrustedReadback(readback);
    },
  });
  const manifest = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  const join = await subject.governance.issueCoreJoinVerdict(coreJoinInput(manifest));
  const request = {
    tenant_id: "codexai",
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    core_join_verdict_id: join.verdict.verdict_id,
    pull_request: 42,
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "owner-manual-merge-readback-nonce",
      confirmation_reference: "owner confirmed exact manual merge readback",
      purpose: "host_native_owner_manual_merge_readback",
      request_binding_hash: H("9"),
    },
    idempotency_key: "manual-merge-readback-42",
  };
  const receipt = await subject.governance.recordOwnerManualMergeReadback(request);
  assert.equal(receipt.schema_version, "host_native_owner_manual_merge_readback_v1");
  assert.equal(receipt.authority, "evidence_only");
  assert.equal(receipt.evidence_only, true);
  assert.equal(receipt.ticket_issued, false);
  assert.equal(receipt.retrospective_ticket_issued, false);
  assert.equal(receipt.action_authorized, false);
  assert.equal(receipt.execution_authorized, false);
  assert.equal(receipt.predecessor.predecessor_type, "owner_manual_github_merge_readback");
  assert.equal(receipt.predecessor.eligible_successor_action, "render.observe");
  assert.equal(receipt.predecessor.successor_ticket_required, true);
  assert.equal(receipt.predecessor.closure_ticket_required, true);
  assert.equal(receipt.predecessor.retrospective_ticket_issued, false);
  assert.equal(receipt.github_readback.merge_commit, G("9"));
  assert.match(receipt.receipt_digest, /^[a-f0-9]{64}$/);
  assert.match(receipt.signature, /^hnmmr_[a-f0-9]{64}$/);
  assert.equal(Object.keys(store.readState().tickets).length, 0);
  assert.equal(Object.keys(store.readState().owner_manual_merge_readbacks).length, 1);
  const ordinaryAuthority =
    await subject.governance.resolveManualMergeRefreshAuthority({
    tenant_id: "codexai",
    work_id: "work-1",
    core_join_verdict_id: join.verdict.verdict_id,
    manual_merge_readback_id: receipt.receipt_id,
  });
  assert.equal(ordinaryAuthority.authority_mode, "core_join");
  assert.equal(ordinaryAuthority.refresh_lineage_digest, undefined);
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  await assert.rejects(subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "manual-merge-must-not-mint-ticket",
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: manifestWithCoreJoin(manifest, join.verdict.verdict_id),
    idempotency_key: "manual-merge-retrospective-ticket-denied",
  }), /core_join_manual_merge_already_observed/);
  assert.equal(Object.keys(store.readState().tickets).length, 0);

  const observationDelegation = await subject.governance.issueDelegation({
    ...subject.delegationInput,
    allowed_branches: [receipt.github_readback.head_branch],
    allowed_actions: ["render.observe"],
    budget: {
      ...subject.delegationInput.budget,
      max_total_actions: 1,
    },
    owner_confirmation: {
      ...subject.delegationInput.owner_confirmation,
      consent_nonce: "owner-manual-merge-observation-delegation",
    },
    idempotency_key: "manual-merge-observation-delegation",
  });
  const boundManifest = manifestWithCoreJoin(manifest, join.verdict.verdict_id);
  const observationRequest = {
    tenant_id: "codexai",
    delegation_id: observationDelegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "manual-merge-observation-session",
    action: {
      kind: "render.observe",
      repository: "owner/repo",
      branch: "main",
      service_id: "srv-core",
      environment: "production",
      target_commit: G("9"),
      release_manifest_digest: boundManifest.manifest_digest,
      provider_execution: false,
    },
    evidence_digest: receipt.receipt_digest,
    release_manifest: boundManifest,
    manual_merge_readback_id: receipt.receipt_id,
    idempotency_key: "manual-merge-observation-ticket",
  };
  const invalidObservationDelegation = await subject.governance.issueDelegation({
    ...subject.delegationInput,
    allowed_actions: ["render.observe", "git.commit"],
    budget: {
      ...subject.delegationInput.budget,
      max_total_actions: 2,
    },
    owner_confirmation: {
      ...subject.delegationInput.owner_confirmation,
      consent_nonce: "owner-manual-merge-invalid-observation-delegation",
    },
    idempotency_key: "manual-merge-invalid-observation-delegation",
  });
  await assert.rejects(subject.governance.issueActionTicket({
    ...observationRequest,
    delegation_id: invalidObservationDelegation.delegation_id,
    idempotency_key: "manual-merge-invalid-observation-ticket",
  }), /owner_manual_merge_observation_delegation_invalid/);
  const unchangedAfterInvalidGrant = store.readState();
  assert.equal(
    unchangedAfterInvalidGrant.core_join_verdicts[join.verdict.verdict_id]
      .authorized_ticket_id,
    undefined,
  );
  assert.equal(
    unchangedAfterInvalidGrant.owner_manual_merge_successors[receipt.receipt_id],
    undefined,
  );
  assert.equal(Object.keys(unchangedAfterInvalidGrant.tickets).length, 0);
  await assert.rejects(subject.governance.issueActionTicket({
    ...observationRequest,
    predecessor_ticket_id: "hnt_fake-predecessor",
    idempotency_key: "manual-merge-two-predecessors-denied",
  }), /predecessor_exclusive/);
  await assert.rejects(subject.governance.issueActionTicket({
    ...observationRequest,
    action: { ...observationRequest.action, merged: true },
    idempotency_key: "manual-merge-caller-observation-fact-denied",
  }), /delegation_continuation_action_field_denied:merged/);
  await assert.rejects(subject.governance.issueActionTicket({
    ...observationRequest,
    action: {
      ...observationRequest.action,
      branch: receipt.github_readback.head_branch,
    },
    idempotency_key: "manual-merge-head-branch-substitution-denied",
  }), /branch_not_allowed/);
  await assert.rejects(subject.governance.issueActionTicket({
    ...observationRequest,
    manual_merge_readback_id: null,
    idempotency_key: "manual-merge-null-readback-id-denied",
  }), /branch_not_allowed/);
  await assert.rejects(subject.governance.issueActionTicket({
    ...observationRequest,
    manual_merge_readback_id: "",
    idempotency_key: "manual-merge-empty-readback-id-denied",
  }), /branch_not_allowed/);
  const {
    manual_merge_readback_id: _manualMergeReadbackId,
    ...missingReadbackObservationRequest
  } = observationRequest;
  await assert.rejects(subject.governance.issueActionTicket({
    ...missingReadbackObservationRequest,
    idempotency_key: "manual-merge-missing-readback-id-denied",
  }), /branch_not_allowed/);
  await assert.rejects(subject.governance.issueActionTicket({
    ...observationRequest,
    manual_merge_readback_id: `hnmmr_${"0".repeat(40)}`,
    idempotency_key: "manual-merge-forged-readback-id-denied",
  }), /branch_not_allowed/);
  const observation = await subject.governance.issueActionTicket(observationRequest);
  assert.equal(observation.ticket.action.kind, "render.observe");
  assert.equal(observation.ticket.predecessor.manual_merge_readback_id,
    receipt.receipt_id);
  assert.equal(observation.ticket.predecessor.retrospective_ticket_issued, false);
  assert.equal(Object.values(store.readState().tickets).some((record) =>
    record.ticket.action.kind === "github.merge"), false);
  const ordinaryTicketAuthority =
    await subject.governance.resolveManualMergeRefreshAuthority({
      tenant_id: "codexai",
      work_id: "work-1",
      core_join_verdict_id: join.verdict.verdict_id,
      manual_merge_readback_id: receipt.receipt_id,
      ticket_id: observation.ticket.ticket_id,
    });
  assert.equal(ordinaryTicketAuthority.authority_mode, "core_join");
  await assert.rejects(subject.governance.issueActionTicket({
    ...observationRequest,
    idempotency_key: "manual-merge-observation-ticket-substitution",
  }), /branch_not_allowed/);
  const reserved = await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: observation.ticket.ticket_id,
    host_session_fingerprint: observation.ticket.host_session_fingerprint,
    idempotency_key: "manual-merge-observation-reserve",
  });
  await subject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: observation.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: observation.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("a"),
    result_commit: G("9"),
    readback_digest: H("b"),
    idempotency_key: "manual-merge-observation-complete",
  });
  const finalized = await subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: observation.ticket.ticket_id,
    host_session_fingerprint: observation.ticket.host_session_fingerprint,
  });
  assert.equal(finalized.decision, "ALLOW_FINALIZE");
  assert.equal(finalized.target_commit, G("9"));
  assert.equal(finalized.services_verified, true);
  assert.equal(finalized.predecessor.manual_merge_readback_id, receipt.receipt_id);
  assert.equal(finalized.github_readback.manual_merge_readback_id,
    receipt.receipt_id);
  const proofKeys = crypto.generateKeyPairSync("ed25519");
  const proofSigner = createLocalGenericWorkCoreJoinSigner({
    privateKey: proofKeys.privateKey.export({ type: "pkcs8", format: "pem" }),
    keyId: "gwcj-host-native-finalize-test",
  });
  const finalizeProof = await createHostNativeFinalizeAuthorizationProof({
    authorization: finalized,
    intentAnchorDigest: H("1"),
    signer: proofSigner,
  });
  assert.equal(finalizeProof.authorization_digest,
    finalized.authorization_digest);
  assert.equal(finalizeProof.intent_anchor_digest, H("1"));
  assert.equal(verifyGenericWorkCoreJoinDigestSignature({
    digest: finalizeProof.proof_digest,
    signature: finalizeProof.signature,
    publicKey: proofKeys.publicKey,
  }), true);
  await assert.rejects(createHostNativeFinalizeAuthorizationProof({
    authorization: { ...finalized, target_commit: G("8") },
    intentAnchorDigest: H("1"),
    signer: proofSigner,
  }), /host_native_finalize_authorization_digest_invalid/);

  const replay = await subject.governance.recordOwnerManualMergeReadback(request);
  assert.equal(replay.receipt_digest, receipt.receipt_digest);
  assert.equal(verifierCalls, 1);
  await assert.rejects(subject.governance.recordOwnerManualMergeReadback({
    ...request,
    pull_request: 43,
  }), /idempotency_key_conflict/);
  await assert.rejects(subject.governance.recordOwnerManualMergeReadback({
    ...request,
    merged: true,
    idempotency_key: "manual-merge-caller-fact",
  }), /unknown_field:merged/);
});

test("post-release attestation binds a historical release to one trusted render observation", async () => {
  const store = createInMemoryHostNativeGovernanceStore();
  let verifierCalls = 0;
  let subject;
  const manualReadbackVerifier = async ({
    tenant_id,
    repository,
    pull_request,
    core_join_record,
  }) => {
    verifierCalls += 1;
    const unsigned = {
      schema_version: "host_native_owner_manual_merge_github_readback_v1",
      trusted: true,
      source: "universal_core_github_readback",
      tenant_id,
      repository,
      pull_request,
      merged: true,
      merged_at: "2026-07-29T10:00:00.000Z",
      head_branch: "agent/native-work",
      base_branch: core_join_record.claim.base_branch,
      base_commit: G("1"),
      head_commit: core_join_record.claim.checks.commit,
      merge_commit: G("9"),
      main_head_commit: G("9"),
      checks_commit: core_join_record.claim.checks.commit,
      checks_passed: true,
      required_checks: core_join_record.claim.checks.required_checks,
      observed_checks: [{
        name: "unit-tests",
        head_commit: core_join_record.claim.checks.commit,
        status: "completed",
        conclusion: "success",
      }],
      required_checks_policy_digest:
        core_join_record.claim.required_checks_policy_digest,
      checks_attestation_digest: H("8"),
      workflow_sources: [],
      verified_at: new Date(subject.now()).toISOString(),
      external_side_effect: false,
      provider_execution: false,
    };
    return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
  };
  Object.defineProperty(manualReadbackVerifier, "trusted", { value: true });
  const requiredChecksPolicyResolver = async () => ({
    schema_version: "host_native_required_checks_policy_v1",
    tenant_id: "codexai",
    repository: "owner/repo",
    base_branch: "main",
    required_checks: ["unit-tests"],
    check_app: { id: 1, slug: "github-actions", owner: "github" },
    workflow: {
      id: 1,
      name: "CI",
      path: ".github/workflows/ci.yml",
      sha256: H("7"),
      candidate_sha256: null,
    },
    allowed_events: ["pull_request"],
  });
  subject = harness({
    store,
    clockStart: "2026-07-29T10:05:00.000Z",
    ownerManualMergeReadbackVerifier: manualReadbackVerifier,
    requiredChecksPolicyResolver,
    externalReadbackVerifier: async ({ ticket, target_commit, verification_scope }) => {
      const readback = trustedExternalReadback(
        ticket,
        target_commit,
        new Date(subject.now()).toISOString(),
        verification_scope,
      );
      readback.github.required_checks_policy_digest =
        ticket.predecessor.source_required_checks_policy_digest;
      return redigestTrustedReadback(readback);
    },
  });
  const manifest = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  const freshUntil = new Date(subject.now() + 20 * 60_000).toISOString();
  const join = await subject.governance.issueCoreJoinVerdict(coreJoinInput(manifest, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
  }));
  const ownerConfirmation = {
    verified: true,
    request_bound: true,
    owner_subject_fingerprint: OWNER,
    consent_nonce: "post-release-readback-owner",
    confirmation_reference: "owner confirmed post-release trusted readback",
    purpose: "host_native_post_release_readback_attest",
    request_binding_hash: H("9"),
  };
  const selectors = {
    tenant_id: "codexai",
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    core_join_verdict_id: join.verdict_id,
    pull_request: 42,
  };
  await assert.rejects(subject.governance.recordOwnerManualMergeReadback({
    ...selectors,
    owner_confirmation: {
      ...ownerConfirmation,
      consent_nonce: "ordinary-historical-readback-owner",
      purpose: "host_native_owner_manual_merge_readback",
    },
    idempotency_key: "ordinary-historical-readback",
  }, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
  }), /owner_manual_merge_refresh_predecessor_missing/);

  const request = {
    ...selectors,
    owner_confirmation: ownerConfirmation,
    idempotency_key: "post-release-readback-attestation",
  };
  const receipt = await subject.governance.recordOwnerManualMergeReadback(request, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
    post_release_attestation: true,
  });
  assert.equal(receipt.refresh_lineage, undefined);
  assert.equal(receipt.post_release_attestation.schema_version,
    "host_native_post_release_attestation_v1");
  assert.equal(receipt.post_release_attestation.attestation_kind,
    "historical_release_readback");
  assert.equal(receipt.post_release_attestation.authorized_successor_action,
    "render.observe");
  assert.equal(receipt.post_release_attestation.core_join_verdict_id,
    join.verdict_id);
  assert.equal(receipt.post_release_attestation.release_intent_digest,
    join.claim.release_intent_digest);
  assert.equal(receipt.post_release_attestation.provider_execution, false);
  assert.equal(
    receipt.post_release_attestation.attestation_digest,
    hostNativeDigest((({ attestation_digest: _digest, ...rest }) => rest)(
      receipt.post_release_attestation,
    )),
  );
  const authority = await subject.governance.resolveManualMergeRefreshAuthority({
    tenant_id: "codexai",
    work_id: "work-1",
    core_join_verdict_id: join.verdict_id,
    manual_merge_readback_id: receipt.receipt_id,
  });
  assert.equal(authority.authority_mode, "refresh_closure_only");
  assert.equal(authority.post_release_attestation_digest,
    hostNativeDigest(receipt.post_release_attestation));

  const delegation = await subject.governance.issueDelegation({
    ...subject.delegationInput,
    allowed_actions: ["render.observe"],
    budget: { ...subject.delegationInput.budget, max_total_actions: 1 },
    owner_confirmation: {
      ...subject.delegationInput.owner_confirmation,
      consent_nonce: "post-release-observation-delegation",
    },
    idempotency_key: "post-release-observation-delegation",
  });
  const boundManifest = manifestWithCoreJoin(manifest, join.verdict_id);
  const observationRequest = {
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "post-release-observation-session",
    action: {
      kind: "render.observe",
      repository: "owner/repo",
      branch: "main",
      service_id: "srv-core",
      environment: "production",
      target_commit: G("9"),
      release_manifest_digest: boundManifest.manifest_digest,
      provider_execution: false,
    },
    evidence_digest: receipt.receipt_digest,
    release_manifest: boundManifest,
    manual_merge_readback_id: receipt.receipt_id,
    idempotency_key: "post-release-observation-ticket",
  };
  await assert.rejects(subject.governance.issueActionTicket({
    ...observationRequest,
    action: githubMergeAction(),
    idempotency_key: "post-release-action-substitution",
  }, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
  }), /owner_manual_merge_successor_action_invalid|branch_not_allowed|action_not_allowed/);
  const observation = await subject.governance.issueActionTicket(
    observationRequest,
    {
      software_closure_digest: H("2"),
      software_closure_fresh_until: freshUntil,
    },
  );
  assert.equal(observation.ticket.core_join_verdict_id, join.verdict_id);
  assert.equal(observation.ticket.predecessor.post_release_attestation
    .attestation_digest, receipt.post_release_attestation.attestation_digest);
  const ticketAuthority =
    await subject.governance.resolveManualMergeRefreshAuthority({
      tenant_id: "codexai",
      work_id: "work-1",
      core_join_verdict_id: join.verdict_id,
      manual_merge_readback_id: receipt.receipt_id,
      ticket_id: observation.ticket.ticket_id,
    });
  assert.equal(ticketAuthority.authority_mode, "refresh_closure_only");

  const reserved = await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: observation.ticket.ticket_id,
    host_session_fingerprint: observation.ticket.host_session_fingerprint,
    idempotency_key: "post-release-observation-reserve",
  });
  await subject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: observation.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: observation.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("a"),
    result_commit: G("9"),
    readback_digest: H("b"),
    idempotency_key: "post-release-observation-complete",
  });
  subject.advance(1);
  const finalized = await subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: observation.ticket.ticket_id,
    host_session_fingerprint: observation.ticket.host_session_fingerprint,
  });
  assert.equal(finalized.decision, "ALLOW_FINALIZE");
  assert.equal(finalized.target_commit, G("9"));
  assert.equal(finalized.services_verified, true);
  assert.equal(finalized.core_join_verdict_id, join.verdict_id);
  assert.equal(finalized.predecessor.post_release_attestation.attestation_digest,
    receipt.post_release_attestation.attestation_digest);

  const replay = await subject.governance.recordOwnerManualMergeReadback(request, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
    post_release_attestation: true,
  });
  assert.equal(replay.receipt_digest, receipt.receipt_digest);
  assert.equal(verifierCalls, 2);
});

test("legacy manual merge receipt refreshes once onto a canonical Join and survives Join expiry", async () => {
  const store = createInMemoryHostNativeGovernanceStore();
  let verifiedAt = "2026-07-29T10:00:00.000Z";
  const manualReadbackVerifier = async ({ tenant_id, repository, pull_request, core_join_record }) => {
    const unsigned = {
      schema_version: "host_native_owner_manual_merge_github_readback_v1",
      trusted: true,
      source: "universal_core_github_readback",
      tenant_id,
      repository,
      pull_request,
      merged: true,
      merged_at: "2026-07-29T10:00:00.000Z",
      head_branch: "agent/native-work",
      base_branch: core_join_record.claim.base_branch,
      base_commit: G("1"),
      head_commit: core_join_record.claim.checks.commit,
      merge_commit: G("9"),
      main_head_commit: G("9"),
      checks_commit: core_join_record.claim.checks.commit,
      checks_passed: true,
      required_checks: core_join_record.claim.checks.required_checks,
      observed_checks: [{
        name: "unit-tests",
        head_commit: core_join_record.claim.checks.commit,
        status: "completed",
        conclusion: "success",
      }],
      required_checks_policy_digest: core_join_record.claim.required_checks_policy_digest,
      checks_attestation_digest: H("8"),
      workflow_sources: [],
      verified_at: verifiedAt,
      external_side_effect: false,
      provider_execution: false,
    };
    return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
  };
  Object.defineProperty(manualReadbackVerifier, "trusted", { value: true });
  const requiredChecksPolicyResolver = async () => ({
    schema_version: "host_native_required_checks_policy_v1",
    tenant_id: "codexai",
    repository: "owner/repo",
    base_branch: "main",
    required_checks: ["unit-tests"],
    check_app: { id: 1, slug: "github-actions", owner: "github" },
    workflow: {
      id: 1,
      name: "CI",
      path: ".github/workflows/ci.yml",
      sha256: H("7"),
      candidate_sha256: null,
    },
    allowed_events: ["pull_request"],
  });
  const subject = harness({
    store,
    coreJoinTtlMs: 60_000,
    ticketTtlMs: 10 * 60_000,
    ownerManualMergeReadbackVerifier: manualReadbackVerifier,
    requiredChecksPolicyResolver,
    externalReadbackVerifier: async ({ ticket, target_commit, verification_scope }) => {
      const readback = trustedExternalReadback(
        ticket,
        target_commit,
        new Date(subject?.now?.() || Date.parse(verifiedAt)).toISOString(),
        verification_scope,
      );
      readback.github.required_checks_policy_digest =
        ticket.predecessor.source_required_checks_policy_digest;
      return redigestTrustedReadback(readback);
    },
  });
  const manifest = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  const oldFreshUntil = new Date(subject.now() + 20 * 60_000).toISOString();
  const oldJoin = await subject.governance.issueCoreJoinVerdict(coreJoinInput(manifest, {
    software_closure_digest: H("1"),
    software_closure_fresh_until: oldFreshUntil,
  }));
  const ownerConfirmation = {
    verified: true,
    request_bound: true,
    owner_subject_fingerprint: OWNER,
    consent_nonce: "legacy-manual-merge-owner",
    confirmation_reference: "owner confirmed exact manual merge readback",
    purpose: "host_native_owner_manual_merge_readback",
    request_binding_hash: H("9"),
  };
  const oldReceipt = await subject.governance.recordOwnerManualMergeReadback({
    tenant_id: "codexai",
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    core_join_verdict_id: oldJoin.verdict_id,
    pull_request: 42,
    owner_confirmation: ownerConfirmation,
    idempotency_key: "legacy-manual-readback",
  });
  const legacy = rewriteStoredManualMergeAsLegacy(
    store,
    oldJoin.verdict_id,
    oldReceipt.receipt_id,
    H("0"),
    {
      // The merge was observed while the original Join was valid, but the
      // signed receipt was durably recorded after that Join expired.
      recordedAt: new Date(subject.now() + 90_000).toISOString(),
    },
  );
  subject.advance(2 * 60_000);
  verifiedAt = new Date(subject.now()).toISOString();
  const freshUntil = new Date(subject.now() + 20 * 60_000).toISOString();
  const newJoin = await subject.governance.issueCoreJoinVerdict(coreJoinInput(manifest, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
  }));
  const refreshRequest = {
    tenant_id: "codexai",
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    core_join_verdict_id: newJoin.verdict_id,
    pull_request: 42,
    owner_confirmation: { ...ownerConfirmation, consent_nonce: "refresh-manual-merge-owner" },
    idempotency_key: "refresh-manual-readback",
  };
  store.mutate((state) => {
    delete state.owner_manual_merge_readbacks[legacy.receipt.receipt_id];
  });
  await assert.rejects(subject.governance.recordOwnerManualMergeReadback({
    ...refreshRequest,
    idempotency_key: "refresh-manual-readback-missing",
  }, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
  }), /owner_manual_merge_refresh_predecessor_missing/);
  store.mutate((state) => {
    const crossWork = structuredClone(legacy.receipt);
    crossWork.work_id = "work-2";
    crossWork.predecessor.work_id = "work-2";
    const {
      predecessor_digest: _predecessorDigest,
      ...crossPredecessorUnsigned
    } = crossWork.predecessor;
    crossWork.predecessor.predecessor_digest = hostNativeDigest(
      crossPredecessorUnsigned,
    );
    const {
      signature: _signature,
      receipt_digest: _receiptDigest,
      ...crossReceiptUnsigned
    } = crossWork;
    crossWork.receipt_digest = hostNativeDigest(crossReceiptUnsigned);
    crossWork.signature = signedTestDomain(
      "hnmmr",
      canonicalForSignature({
        ...crossReceiptUnsigned,
        receipt_digest: crossWork.receipt_digest,
      }),
    );
    state.owner_manual_merge_readbacks[legacy.receipt.receipt_id] = crossWork;
    state.core_join_verdicts[legacy.record.verdict_id]
      .manual_merge_readback_receipt_digest = crossWork.receipt_digest;
  });
  await assert.rejects(subject.governance.recordOwnerManualMergeReadback({
    ...refreshRequest,
    idempotency_key: "refresh-manual-readback-cross-work",
  }, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
  }), /owner_manual_merge_refresh_predecessor_missing/);
  store.mutate((state) => {
    state.owner_manual_merge_readbacks[legacy.receipt.receipt_id] =
      structuredClone(legacy.receipt);
    state.core_join_verdicts[legacy.record.verdict_id]
      .manual_merge_readback_receipt_digest = legacy.receipt.receipt_digest;
  });
  rewriteStoredManualMergeRecordedAt(
    store,
    legacy.receipt.receipt_id,
    new Date(Date.parse(legacy.receipt.github_readback.merged_at) - 1).toISOString(),
  );
  await assert.rejects(subject.governance.recordOwnerManualMergeReadback({
    ...refreshRequest,
    idempotency_key: "refresh-manual-readback-recorded-before-merge",
  }, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
  }), /owner_manual_merge_refresh_predecessor_missing/);
  rewriteStoredManualMergeRecordedAt(
    store,
    legacy.receipt.receipt_id,
    new Date(subject.now() + 1).toISOString(),
  );
  await assert.rejects(subject.governance.recordOwnerManualMergeReadback({
    ...refreshRequest,
    idempotency_key: "refresh-manual-readback-recorded-in-future",
  }, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
  }), /owner_manual_merge_refresh_predecessor_missing/);
  store.mutate((state) => {
    state.owner_manual_merge_readbacks[legacy.receipt.receipt_id] =
      structuredClone(legacy.receipt);
    state.core_join_verdicts[legacy.record.verdict_id]
      .manual_merge_readback_receipt_digest = legacy.receipt.receipt_digest;
  });
  store.mutate((state) => {
    const forged = structuredClone(legacy.receipt);
    forged.signature = `hnmmr_${"0".repeat(64)}`;
    state.owner_manual_merge_readbacks[legacy.receipt.receipt_id] = forged;
  });
  await assert.rejects(subject.governance.recordOwnerManualMergeReadback({
    ...refreshRequest,
    idempotency_key: "refresh-manual-readback-forged",
  }, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
  }), /owner_manual_merge_refresh_predecessor_missing/);
  store.mutate((state) => {
    state.owner_manual_merge_readbacks[legacy.receipt.receipt_id] =
      structuredClone(legacy.receipt);
  });
  const refreshed = await subject.governance.recordOwnerManualMergeReadback(refreshRequest, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
  });
  const refreshedReplay = await subject.governance.recordOwnerManualMergeReadback(
    refreshRequest,
    {
      software_closure_digest: H("2"),
      software_closure_fresh_until: freshUntil,
    },
  );
  assert.equal(refreshedReplay.receipt_digest, refreshed.receipt_digest);
  assert.equal(refreshed.refresh_lineage.predecessor_manual_merge_readback_id,
    legacy.receipt.receipt_id);
  assert.equal(refreshed.refresh_lineage.legacy_diff_digest, H("0"));
  assert.equal(refreshed.refresh_lineage.canonical_diff_digest, manifest.diff_digest);
  assert.equal(
    refreshed.refresh_lineage.lineage_digest,
    hostNativeDigest((({ lineage_digest: _digest, ...rest }) => rest)(
      refreshed.refresh_lineage,
    )),
  );
  const lineageState = store.readState();
  assert.equal(
    lineageState.owner_manual_merge_successors[legacy.receipt.receipt_id]
      .refreshed_manual_merge_readback_id,
    refreshed.receipt_id,
  );
  const refreshAuthority =
    await subject.governance.resolveManualMergeRefreshAuthority({
      tenant_id: "codexai",
      work_id: "work-1",
      core_join_verdict_id: newJoin.verdict_id,
      manual_merge_readback_id: refreshed.receipt_id,
    });
  assert.equal(refreshAuthority.manual_merge_readback_digest,
    refreshed.receipt_digest);
  assert.equal(refreshAuthority.authority_mode, "refresh_closure_only");
  assert.equal(refreshAuthority.refresh_lineage_digest,
    hostNativeDigest(refreshed.refresh_lineage));
  await assert.rejects(subject.governance.resolveManualMergeRefreshAuthority({
    tenant_id: "codexai",
    work_id: "work-1",
    core_join_verdict_id: newJoin.verdict_id,
    manual_merge_readback_id: `hnmmr_${"0".repeat(40)}`,
  }), /owner_manual_merge_authority_invalid/);
  store.mutate((state) => {
    state.owner_manual_merge_readbacks[refreshed.receipt_id]
      .refresh_lineage.canonical_diff_digest = H("f");
  });
  await assert.rejects(subject.governance.resolveManualMergeRefreshAuthority({
    tenant_id: "codexai",
    work_id: "work-1",
    core_join_verdict_id: newJoin.verdict_id,
    manual_merge_readback_id: refreshed.receipt_id,
  }), /owner_manual_merge_authority_invalid/);
  store.mutate((state) => {
    state.owner_manual_merge_readbacks[refreshed.receipt_id] =
      structuredClone(refreshed);
  });
  await assert.rejects(subject.governance.recordOwnerManualMergeReadback({
    tenant_id: "codexai",
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    core_join_verdict_id: newJoin.verdict_id,
    pull_request: 42,
    owner_confirmation: { ...ownerConfirmation, consent_nonce: "refresh-replay-substitution" },
    idempotency_key: "refresh-manual-readback-substitution",
  }, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
  }), /owner_manual_merge_core_join_invalid/);

  const delegation = await subject.governance.issueDelegation({
    ...subject.delegationInput,
    allowed_actions: ["render.observe"],
    budget: { ...subject.delegationInput.budget, max_total_actions: 1 },
    owner_confirmation: {
      ...subject.delegationInput.owner_confirmation,
      consent_nonce: "refreshed-observation-delegation",
    },
    idempotency_key: "refreshed-observation-delegation",
  });
  const boundManifest = manifestWithCoreJoin(manifest, newJoin.verdict_id);
  const observation = await subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "refreshed-observation-session",
    action: {
      kind: "render.observe",
      repository: "owner/repo",
      branch: "main",
      service_id: "srv-core",
      environment: "production",
      target_commit: G("9"),
      release_manifest_digest: boundManifest.manifest_digest,
      provider_execution: false,
    },
    evidence_digest: refreshed.receipt_digest,
    release_manifest: boundManifest,
    manual_merge_readback_id: refreshed.receipt_id,
    idempotency_key: "refreshed-observation-ticket",
  }, {
    software_closure_digest: H("2"),
    software_closure_fresh_until: freshUntil,
  });
  assert.equal(observation.ticket.core_join_verdict_id, newJoin.verdict_id);
  assert.equal(observation.ticket.predecessor.refresh_lineage
    .predecessor_core_join_verdict_id, legacy.record.verdict_id);
  const ticketRefreshAuthority =
    await subject.governance.resolveManualMergeRefreshAuthority({
      tenant_id: "codexai",
      work_id: "work-1",
      core_join_verdict_id: newJoin.verdict_id,
      manual_merge_readback_id: refreshed.receipt_id,
      ticket_id: observation.ticket.ticket_id,
    });
  assert.equal(ticketRefreshAuthority.ticket_id, observation.ticket.ticket_id);
  assert.equal(ticketRefreshAuthority.authority_mode, "refresh_closure_only");
  await assert.rejects(subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "refreshed-observation-session",
    action: githubMergeAction(),
    evidence_digest: refreshed.receipt_digest,
    release_manifest: boundManifest,
    manual_merge_readback_id: refreshed.receipt_id,
    idempotency_key: "refreshed-action-substitution",
  }), /owner_manual_merge_successor_action_invalid|branch_not_allowed|action_not_allowed/);

  subject.advance(2 * 60_000);
  const reserved = await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: observation.ticket.ticket_id,
    host_session_fingerprint: observation.ticket.host_session_fingerprint,
    idempotency_key: "refreshed-observation-reserve",
  });
  await subject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: observation.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: observation.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("a"),
    result_commit: G("9"),
    readback_digest: H("b"),
    idempotency_key: "refreshed-observation-complete",
  });
  const finalized = await subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: observation.ticket.ticket_id,
    host_session_fingerprint: observation.ticket.host_session_fingerprint,
  });
  assert.equal(finalized.decision, "ALLOW_FINALIZE");
  assert.equal(finalized.core_join_verdict_id, newJoin.verdict_id);
});

test("new release intents and Core Joins reject noncanonical GitHub diff digests", async () => {
  const input = mergeReleaseManifestInput({ diff_digest: H("0") });
  const { schema_version: _schema, manifest_id: _manifest, ...intentInput } = input;
  const {
    core_join_verdict_id: _coreJoinVerdictId,
    ...intentVerification
  } = intentInput.verification;
  assert.throws(() => buildHostReleaseIntentV1({
    ...intentInput,
    verification: intentVerification,
  }),
    /release_intent_diff_digest_mismatch/);

  const subject = harness();
  const manifest = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  const canonicalIntent = deriveHostReleaseIntentV1(manifest);
  const { release_intent_digest: _digest, ...unsigned } = canonicalIntent;
  const forgedUnsigned = { ...unsigned, diff_digest: H("0") };
  await assert.rejects(subject.governance.issueCoreJoinVerdict(coreJoinInput(manifest, {
    release_intent: {
      ...forgedUnsigned,
      release_intent_digest: hostNativeDigest(forgedUnsigned),
    },
  })), /core_join_release_intent_diff_digest_mismatch/);
});

test("owner manual merge readback rejects a Core Join already bound to an action ticket", async () => {
  const store = createInMemoryHostNativeGovernanceStore();
  const manualReadbackVerifier = async () => {
    throw new Error("verifier_must_not_run");
  };
  Object.defineProperty(manualReadbackVerifier, "trusted", { value: true });
  const subject = harness({ store, ownerManualMergeReadbackVerifier: manualReadbackVerifier });
  const manifest = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  const join = await subject.governance.issueCoreJoinVerdict(coreJoinInput(manifest));
  store.mutate((state) => {
    state.core_join_verdicts[join.verdict.verdict_id].authorized_ticket_id = "hnt_existing";
  });
  await assert.rejects(subject.governance.recordOwnerManualMergeReadback({
    tenant_id: "codexai",
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    core_join_verdict_id: join.verdict.verdict_id,
    pull_request: 42,
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "owner-manual-merge-bound-ticket",
      confirmation_reference: "owner confirmed exact manual merge readback",
      purpose: "host_native_owner_manual_merge_readback",
      request_binding_hash: H("9"),
    },
    idempotency_key: "manual-merge-bound-ticket",
  }), /owner_manual_merge_core_join_invalid/);
  assert.equal(Object.keys(store.readState().owner_manual_merge_readbacks).length, 0);
});

test("exact action ticket is signed, host-bounded, single-use, and completes once", async () => {
  const subject = harness();
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const issued = await issueCommitTicket(subject.governance, delegation.delegation_id);
  assert.equal(issued.state, "issued");
  assert.equal(issued.ticket.max_uses, 1);
  assert.equal(issued.ticket.host_policy_override, false);
  assert.equal(issued.ticket.host_policy_must_allow, true);
  assert.equal(issued.ticket.provider_execution, false);
  assert.equal(subject.governance.verifyActionTicket(issued.ticket), true);
  assert.equal(subject.governance.verifyActionTicket({
    ...issued.ticket,
    action: { ...issued.ticket.action, branch: "agent/other" },
  }), false);

  const reserved = await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  assert.equal(reserved.state, "reserved");
  assert.equal(reserved.uses, 1);
  await assert.rejects(subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  }), /replayed/);
  const completed = await subject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("a"),
    result_commit: G("3"),
    readback_digest: H("b"),
  });
  assert.equal(completed.state, "completed");
  await assert.rejects(subject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("a"),
    result_commit: G("3"),
    readback_digest: H("b"),
  }), /not_completable/);
});

test("observed unreserved effects preserve causality and require an explicit Core exception", async () => {
  const pushAction = {
    kind: "git.push.branch",
    repository: "owner/repo",
    branch: "agent/native-work",
    source_commit: G("3"),
    expected_remote_commit: G("1"),
    provider_execution: false,
  };
  const blocked = harness();
  const delegation = await blocked.governance.issueDelegation(blocked.delegationInput);
  const issued = await issueCommitTicket(blocked.governance, delegation.delegation_id, {
    action: pushAction,
    idempotency_key: "unreserved-issued-blocked",
  });
  const input = {
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    observed_outcome: "success",
    observed_commit: G("3"),
    readback_digest: H("a"),
    verifier_evidence_digest: H("b"),
    deviation_reason: "host action completed before reservation",
    idempotency_key: "unreserved-observation-blocked",
  };
  const mismatchTicket = await issueCommitTicket(blocked.governance, delegation.delegation_id, {
    action: pushAction,
    idempotency_key: "unreserved-issued-mismatch",
  });
  await assert.rejects(blocked.governance.observeUnreservedActionEffect({
    ...input,
    ticket_id: mismatchTicket.ticket.ticket_id,
    observed_commit: G("4"),
    idempotency_key: "unreserved-wrong-commit",
  }), /observed_commit_mismatch/);
  const observed = await blocked.governance.observeUnreservedActionEffect(input);
  assert.equal(observed.state, "observed_unreserved_effect");
  assert.equal(observed.reservation_id, undefined);
  assert.equal(observed.protocol_deviation.classification, "BLOCKED");
  assert.equal(observed.protocol_deviation.continuation_authorized, false);
  assert.equal(observed.protocol_deviation.reservation_id, null);
  assert.match(observed.protocol_deviation.signature, /^hnue_[a-f0-9]{64}$/);
  assert.deepEqual(await blocked.governance.observeUnreservedActionEffect(input), observed);
  await assert.rejects(blocked.governance.reserveActionTicket({
    tenant_id: "codexai", ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    idempotency_key: "retroactive-reservation",
  }), /replayed/);
  await assert.rejects(blocked.governance.observeUnreservedActionEffect({
    ...input, idempotency_key: "unreserved-replay-with-new-key",
  }), /unreserved_effect_not_eligible/);
  await assert.rejects(blocked.governance.observeUnreservedActionEffect({
    ...input, tenant_id: "other-tenant", idempotency_key: "unreserved-cross-tenant",
  }), /action_ticket_not_found/);
  await assert.rejects(blocked.governance.observeUnreservedActionEffect({
    ...input, observed_at: "2020-01-01T00:00:00.000Z", idempotency_key: "unreserved-forged-time",
  }), /unknown_field:observed_at/);

  const exception = harness({
    unreservedEffectVerifier: async ({ observed_commit, verifier_evidence_digest }) => ({
      classification: observed_commit === G("3") && verifier_evidence_digest === H("b")
        ? "RECONCILED_WITH_EXCEPTION" : "BLOCKED",
      continuation_authorized: true,
      reason: "independent verifier accepted the exact remote readback",
    }),
  });
  const exceptionDelegation = await exception.governance.issueDelegation(exception.delegationInput);
  const exceptionTicket = await issueCommitTicket(exception.governance, exceptionDelegation.delegation_id, {
    action: pushAction,
    idempotency_key: "unreserved-issued-exception",
  });
  const exceptionObserved = await exception.governance.observeUnreservedActionEffect({
    ...input,
    ticket_id: exceptionTicket.ticket.ticket_id,
    host_session_fingerprint: exceptionTicket.ticket.host_session_fingerprint,
    idempotency_key: "unreserved-observation-exception",
  });
  assert.equal(exceptionObserved.protocol_deviation.classification, "RECONCILED_WITH_EXCEPTION");
  assert.equal(exceptionObserved.protocol_deviation.continuation_authorized, true);
  const child = await issueCommitTicket(exception.governance, exceptionDelegation.delegation_id, {
    action: { ...pushAction, source_commit: G("4") },
    predecessor_ticket_id: exceptionTicket.ticket.ticket_id,
    idempotency_key: "unreserved-exception-predecessor",
  });
  assert.equal(child.ticket.predecessor.ticket_id, exceptionTicket.ticket.ticket_id);
});

test("unknown host outcome must reconcile through readback before a final state", async () => {
  const subject = harness();
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const issued = await issueCommitTicket(subject.governance, delegation.delegation_id);
  const reserved = await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  const uncertain = await subject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    outcome: "unknown",
    result_digest: H("b"),
  });
  assert.equal(uncertain.state, "reconciliation_required");
  const reconciled = await subject.governance.reconcileActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    observed_outcome: "success",
    observed_commit: G("3"),
    readback_digest: H("c"),
  });
  assert.equal(reconciled.state, "reconciled");
  assert.equal(reconciled.observed_outcome, "success");
  await assert.rejects(subject.governance.reconcileActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    observed_outcome: "success",
    observed_commit: G("3"),
    readback_digest: H("c"),
  }), /not_reconcilable/);
});

test("all ticket lifecycle mutations are idempotent and conflicting key reuse fails closed", async () => {
  const subject = harness();
  const delegationInput = {
    ...subject.delegationInput,
    idempotency_key: "idem-delegation-1",
  };
  const delegation = await subject.governance.issueDelegation(delegationInput);
  assert.deepEqual(
    await subject.governance.issueDelegation(delegationInput),
    delegation,
  );
  await assert.rejects(subject.governance.issueDelegation({
    ...delegationInput,
    work_id: "work-conflict",
  }), /idempotency_key_conflict/);

  const actionInput = {
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "idempotent-lifecycle",
    action: commitAction(),
    evidence_digest: H("9"),
    idempotency_key: "idem-action-1",
  };
  const issued = await subject.governance.issueActionTicket(actionInput);
  assert.deepEqual(await subject.governance.issueActionTicket(actionInput), issued);
  await assert.rejects(subject.governance.issueActionTicket({
    ...actionInput,
    evidence_digest: H("8"),
  }), /idempotency_key_conflict/);
  let current = await subject.governance.readDelegation({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
  });
  assert.equal(current.usage.commits, 0);
  assert.equal(current.usage.total_actions, 0);

  const reserveInput = {
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    idempotency_key: "idem-reserve-1",
  };
  const reserved = await subject.governance.reserveActionTicket(reserveInput);
  assert.deepEqual(await subject.governance.reserveActionTicket(reserveInput), reserved);
  await assert.rejects(subject.governance.reserveActionTicket({
    ...reserveInput,
    host_session_fingerprint: "different-session",
  }), /idempotency_key_conflict/);
  current = await subject.governance.readDelegation({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
  });
  assert.equal(current.usage.commits, 1);
  assert.equal(current.usage.total_actions, 1);

  const completeInput = {
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("a"),
    result_commit: G("3"),
    readback_digest: H("b"),
    idempotency_key: "idem-complete-1",
  };
  const completed = await subject.governance.completeActionTicket(completeInput);
  assert.deepEqual(await subject.governance.completeActionTicket(completeInput), completed);
  await assert.rejects(subject.governance.completeActionTicket({
    ...completeInput,
    result_digest: H("c"),
  }), /idempotency_key_conflict/);
  const revokeInput = {
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "idempotent-owner-revocation",
      confirmation_reference: "idempotent revocation",
    },
    idempotency_key: "idem-revoke-1",
  };
  const revoked = await subject.governance.revokeDelegation(revokeInput);
  assert.deepEqual(await subject.governance.revokeDelegation(revokeInput), revoked);
  await assert.rejects(subject.governance.revokeDelegation({
    ...revokeInput,
    owner_confirmation: {
      ...revokeInput.owner_confirmation,
      consent_nonce: "conflicting-owner-revocation",
    },
  }), /idempotency_key_conflict/);

  const reconcileSubject = harness();
  const reconcileDelegation =
    await reconcileSubject.governance.issueDelegation(reconcileSubject.delegationInput);
  const reconcileTicket =
    await issueCommitTicket(reconcileSubject.governance, reconcileDelegation.delegation_id);
  const reconcileReservation = await reconcileSubject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: reconcileTicket.ticket.ticket_id,
    host_session_fingerprint: reconcileTicket.ticket.host_session_fingerprint,
  });
  await reconcileSubject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: reconcileTicket.ticket.ticket_id,
    reservation_id: reconcileReservation.reservation_id,
    host_session_fingerprint: reconcileTicket.ticket.host_session_fingerprint,
    outcome: "unknown",
    result_digest: H("a"),
  });
  const reconcileInput = {
    tenant_id: "codexai",
    ticket_id: reconcileTicket.ticket.ticket_id,
    reservation_id: reconcileReservation.reservation_id,
    host_session_fingerprint: reconcileTicket.ticket.host_session_fingerprint,
    observed_outcome: "success",
    observed_commit: G("3"),
    readback_digest: H("b"),
    idempotency_key: "idem-reconcile-1",
  };
  const reconciled = await reconcileSubject.governance.reconcileActionTicket(reconcileInput);
  assert.deepEqual(
    await reconcileSubject.governance.reconcileActionTicket(reconcileInput),
    reconciled,
  );
  await assert.rejects(reconcileSubject.governance.reconcileActionTicket({
    ...reconcileInput,
    readback_digest: H("c"),
  }), /idempotency_key_conflict/);
});

test("delegation retries bind semantic TTL and owner identity, not volatile expiry or assertion", async () => {
  const subject = harness();
  const firstInput = {
    ...subject.delegationInput,
    idempotency_key: "idem-delegation-semantic-retry",
    requested_ttl_seconds: 3_600,
    owner_confirmation: {
      ...subject.delegationInput.owner_confirmation,
      purpose: "host_native_delegation_issue",
      request_binding_hash: H("e"),
    },
  };
  delete firstInput.expires_at;
  const first = await subject.governance.issueDelegation(firstInput);
  subject.advance(2_000);
  const replay = await subject.governance.issueDelegation({
    ...firstInput,
    owner_confirmation: {
      ...firstInput.owner_confirmation,
      consent_nonce: "fresh-owner-consent-nonce-retry",
      confirmation_reference: "fresh request-bound owner confirmation",
      request_binding_hash: H("f"),
    },
  });
  assert.deepEqual(replay, first);
  await assert.rejects(subject.governance.issueDelegation({
    ...firstInput,
    requested_ttl_seconds: 1_800,
    owner_confirmation: {
      ...firstInput.owner_confirmation,
      consent_nonce: "fresh-owner-consent-nonce-mutated-ttl",
    },
  }), /idempotency_key_conflict/);
  await assert.rejects(subject.governance.issueDelegation({
    ...firstInput,
    owner_confirmation: {
      ...firstInput.owner_confirmation,
      owner_subject_fingerprint: `osf_${H("b")}`,
      consent_nonce: "fresh-owner-consent-nonce-mutated-owner",
    },
  }), /idempotency_key_conflict/);
});

test("atomic reservation permits one concurrent consumer only", async () => {
  const subject = harness();
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const issued = await issueCommitTicket(subject.governance, delegation.delegation_id);
  const reserve = () => subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  const results = await Promise.allSettled([reserve(), reserve(), reserve()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 2);
});

test("concurrent ticket reservation cannot exceed the delegation budget", async () => {
  const subject = harness({ budget: { max_commits: 1 } });
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const issued = await Promise.all([
    issueCommitTicket(subject.governance, delegation.delegation_id, {
      host_session_fingerprint: "budget-session-a",
      idempotency_key: "budget-issue-a",
    }),
    issueCommitTicket(subject.governance, delegation.delegation_id, {
      host_session_fingerprint: "budget-session-b",
      idempotency_key: "budget-issue-b",
    }),
  ]);
  const results = await Promise.allSettled(issued.map((ticket, index) =>
    subject.governance.reserveActionTicket({
      tenant_id: "codexai",
      ticket_id: ticket.ticket.ticket_id,
      host_session_fingerprint: ticket.ticket.host_session_fingerprint,
      idempotency_key: `budget-reserve-${index}`,
    })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const current = await subject.governance.readDelegation({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
  });
  assert.equal(current.usage.commits, 1);
});

test("tenant, intent, branch, path, provider, and force boundaries fail closed", async () => {
  const subject = harness();
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  await assert.rejects(issueCommitTicket(subject.governance, delegation.delegation_id, {
    intent_anchor_digest: H("2"),
  }), /delegation_intent_mismatch/);
  await assert.rejects(issueCommitTicket(subject.governance, delegation.delegation_id, {
    action: commitAction({ branch: "unapproved/work" }),
  }), /branch_not_allowed/);
  await assert.rejects(issueCommitTicket(subject.governance, delegation.delegation_id, {
    action: commitAction({ changed_files: ["secrets/runtime.env"] }),
  }), /path_not_allowed/);
  await assert.rejects(issueCommitTicket(subject.governance, delegation.delegation_id, {
    action: commitAction({ provider_execution: true }),
  }), /provider_execution_denied/);
  await assert.rejects(subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "session-fingerprint-codex-1",
    action: {
      kind: "git.push.branch",
      repository: "owner/repo",
      branch: "agent/native-work",
      source_commit: G("4"),
      expected_remote_commit: G("1"),
      force: true,
      delete_ref: false,
      tags: false,
      induced_effects: [],
      provider_execution: false,
    },
    evidence_digest: H("9"),
  }), /absolute_deny/);
  await assert.rejects(subject.governance.readDelegation({
    tenant_id: "other",
    delegation_id: delegation.delegation_id,
  }), /cross_tenant/);
});

test("protected push and induced deploy require one exact verified release manifest", async () => {
  const subject = harness();
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const request = {
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "session-fingerprint-codex-1",
    action: protectedPushAction(),
    evidence_digest: H("6"),
  };
  await assert.rejects(subject.governance.issueActionTicket(request), /release_manifest_required/);
  const manifest = await bindCoreJoinVerdict(
    subject.governance,
    buildHostReleaseManifestV2(releaseManifestInput()),
  );
  const ticket = await subject.governance.issueActionTicket({ ...request, release_manifest: manifest });
  assert.equal(ticket.ticket.release_manifest_digest, manifest.manifest_digest);
  await assert.rejects(subject.governance.issueActionTicket({
    ...request,
    action: protectedPushAction({
      induced_effects: [{
        service_id: "srv-other",
        environment: "production",
        target_commit: G("4"),
        trigger: "github_auto_deploy",
      }],
    }),
    release_manifest: manifest,
  }), /induced_effect_mismatch/);
});

test("release checks come from signed delegation policy and induced deploy consumes both budgets", async () => {
  const subject = harness({ budget: { max_pushes: 2, max_deploys: 1 } });
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const weakPending = buildHostReleaseManifestV2(mergeReleaseManifestInput({
    verification: {
      ...mergeReleaseManifestInput().verification,
      required_checks: ["lint-only"],
    },
  }));
  const weakManifest = await bindCoreJoinVerdict(subject.governance, weakPending);
  await assert.rejects(subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "weak-check-selection",
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: weakManifest,
  }), /required_checks_policy_mismatch/);

  const first = await issueMergeTicket(subject.governance, delegation.delegation_id);
  assert.equal(first.ticket.action.kind, "github.merge");
  const beforeReserve = await subject.governance.readDelegation({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
  });
  assert.equal(beforeReserve.usage.pushes, 0);
  assert.equal(beforeReserve.usage.deploys, 0);
  await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: first.ticket.ticket_id,
    host_session_fingerprint: first.ticket.host_session_fingerprint,
  });
  const usage = await subject.governance.readDelegation({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
  });
  assert.equal(usage.usage.pushes, 1);
  assert.equal(usage.usage.deploys, 1);

  const secondManifest = await bindCoreJoinVerdict(
    subject.governance,
    buildHostReleaseManifestV2(mergeReleaseManifestInput({
      changed_files: ["services/universal-core-service/src/app.js"],
    })),
  );
  await assert.rejects(subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "second-release-budget",
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: secondManifest,
  }), /delegation_deploys_budget_exhausted/);
  const after = await subject.governance.readDelegation({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
  });
  assert.equal(after.usage.pushes, 1);
  assert.equal(after.usage.deploys, 1);
  assert.equal(after.usage.total_actions, 1);
});

test("Render origins are server-resolved, ticket-bound, and restricted to trusted HTTPS hosts", async () => {
  const mapped = harness({
    renderServiceOriginResolver: async ({ service_id }) =>
      service_id === "srv-core"
        ? "https://mapped-core.onrender.com"
        : "https://unknown.onrender.com",
  });
  const mappedDelegation =
    await mapped.governance.issueDelegation(mapped.delegationInput);
  const mappedTicket =
    await issueMergeTicket(mapped.governance, mappedDelegation.delegation_id);
  assert.equal(
    mappedTicket.ticket.release_manifest_binding.services[0].origin,
    "https://mapped-core.onrender.com",
  );

  const malicious = harness({
    renderServiceOriginResolver: async () => "https://attacker.example.com",
  });
  const maliciousDelegation =
    await malicious.governance.issueDelegation(malicious.delegationInput);
  await assert.rejects(
    issueMergeTicket(malicious.governance, maliciousDelegation.delegation_id),
    /render_service_origin_invalid/,
  );
  const explicitPort = harness({
    renderServiceOriginResolver: async () => "https://srv-core.onrender.com:443",
  });
  const explicitPortDelegation =
    await explicitPort.governance.issueDelegation(explicitPort.delegationInput);
  await assert.rejects(
    issueMergeTicket(explicitPort.governance, explicitPortDelegation.delegation_id),
    /render_service_origin_invalid/,
  );
});

test("protected push, Render deploy/rollback, and linked observation each require trusted finalization", async (t) => {
  async function finalizeExact(subject, action, pending) {
    const delegation = await subject.governance.issueDelegation(subject.delegationInput);
    const manifest = await bindCoreJoinVerdict(
      subject.governance,
      buildHostReleaseManifestV2(pending),
    );
    const issued = await subject.governance.issueActionTicket({
      tenant_id: "codexai",
      delegation_id: delegation.delegation_id,
      work_id: "work-1",
      intent_anchor_digest: H("1"),
      repository: "owner/repo",
      host_kind: "codex_native",
      host_session_fingerprint: `finalize-${action.kind}`,
      action,
      evidence_digest: H("6"),
      release_manifest: manifest,
    });
    const reserved = await subject.governance.reserveActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    });
    await subject.governance.completeActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      reservation_id: reserved.reservation_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
      outcome: "success",
      result_digest: H("a"),
      ...(action.kind === "github.merge" ? { result_commit: G("4") } : {}),
      readback_digest: H("b"),
    });
    const receipt = await subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    });
    return { delegation, manifest, issued, receipt };
  }

  function observationRequest(parent, { action = {}, input = {} } = {}) {
    return {
      tenant_id: "codexai",
      delegation_id: parent.delegation.delegation_id,
      work_id: "work-1",
      intent_anchor_digest: H("1"),
      repository: "owner/repo",
      host_kind: "codex_native",
      host_session_fingerprint: parent.issued.ticket.host_session_fingerprint,
      action: {
        kind: "render.observe",
        repository: "owner/repo",
        branch: "main",
        service_id: "srv-core",
        environment: "production",
        target_commit: G("4"),
        parent_release_ticket_id: parent.issued.ticket.ticket_id,
        parent_release_ticket_digest: hostNativeDigest(parent.issued.ticket),
        release_manifest_digest: parent.manifest.manifest_digest,
        provider_execution: false,
        ...action,
      },
      evidence_digest: H("6"),
      release_manifest: parent.manifest,
      ...input,
    };
  }
  const observationPolicy = {
    schema_version: "host_native_required_checks_policy_v1",
    tenant_id: "codexai",
    repository: "owner/repo",
    base_branch: "main",
    required_checks: ["unit-tests"],
    check_app: { id: 15368, slug: "github-actions", owner: "github" },
    workflow: {
      id: 312527659,
      name: "Core",
      path: ".github/workflows/core.yml",
      sha256: H("d"),
    },
    allowed_events: ["push", "pull_request"],
  };
  const observationPolicyDigest = hostNativeDigest({
    ...observationPolicy,
    required_checks: [...observationPolicy.required_checks].sort(),
    workflow: { ...observationPolicy.workflow, candidate_sha256: null },
    allowed_events: [...observationPolicy.allowed_events].sort(),
  });
  const linkedHarness = (options = {}) => harness({
    ...options,
    requiredChecksPolicyResolver: options.requiredChecksPolicyResolver ||
      (async () => observationPolicy),
    externalReadbackVerifier: options.externalReadbackVerifier ||
      (async ({ ticket, target_commit, verification_scope }) => {
      const readback = trustedExternalReadback(
        ticket,
        target_commit,
        "2026-07-29T10:00:00.000Z",
        verification_scope,
      );
      readback.github.required_checks_policy_digest = observationPolicyDigest;
      return redigestTrustedReadback(readback);
      }),
  });

  const pushSubject = harness();
  const pushed = await finalizeExact(
    pushSubject,
    protectedPushAction(),
    releaseManifestInput(),
  );
  assert.equal(pushed.receipt.target_commit, G("4"));
  assert.equal(pushed.receipt.github_readback.branch_commit, G("4"));

  const deploySubject = harness();
  const deployManifest = releaseManifestInput({
    delivery: {
      method: "manual_render_deploy",
      services: [{
        service_id: "srv-core",
        environment: "production",
        expected_previous_commit: G("1"),
        target_commit: G("4"),
        target_resolution: "exact_commit",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      }],
    },
  });
  const deployAction = {
    kind: "render.deploy",
    repository: "owner/repo",
    branch: "main",
    base_branch: "main",
    source_commit: G("4"),
    service_id: "srv-core",
    environment: "production",
    target_commit: G("4"),
    expected_base_commit: G("1"),
    expected_live_commit: G("1"),
    trigger: "manual",
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    rollback_commit: G("1"),
    provider_execution: false,
  };
  const deployed = await finalizeExact(deploySubject, deployAction, deployManifest);
  assert.equal(deployed.receipt.live_services[0].live_commit, G("4"));

  const mixedDeployManifest = releaseManifestInput({
    delivery: {
      method: "manual_render_deploy",
      services: [
        {
          service_id: "srv-core",
          environment: "production",
          expected_previous_commit: G("1"),
          target_commit: G("4"),
          target_resolution: "exact_commit",
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        },
        {
          service_id: "srv-already-live",
          environment: "production",
          expected_previous_commit: G("2"),
          target_commit: G("2"),
          target_resolution: "exact_commit",
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        },
      ],
    },
  });
  const mixed = await finalizeExact(harness(), deployAction, mixedDeployManifest);
  assert.equal(mixed.receipt.github_readback.rollback_commit, G("1"));
  assert.deepEqual(
    mixed.receipt.live_services.map((service) => ({
      service_id: service.service_id,
      live_commit: service.live_commit,
      previous_live_commit: service.previous_live_commit,
      rollback_commit: service.rollback_commit,
    })),
    [
      {
        service_id: "srv-core",
        live_commit: G("4"),
        previous_live_commit: G("1"),
        rollback_commit: G("1"),
      },
      {
        service_id: "srv-already-live",
        live_commit: G("2"),
        previous_live_commit: G("2"),
        rollback_commit: G("1"),
      },
    ],
  );

  const wrongPreviousSubject = harness({
    externalReadbackVerifier: async ({ ticket, target_commit, verification_scope }) => {
      const readback = trustedExternalReadback(
        ticket,
        target_commit,
        "2026-07-29T10:00:00.000Z",
        verification_scope,
      );
      readback.services.find((service) =>
        service.service_id === "srv-already-live").previous_live_commit = G("1");
      return redigestTrustedReadback(readback);
    },
  });
  await assert.rejects(
    finalizeExact(wrongPreviousSubject, deployAction, mixedDeployManifest),
    /trusted_readback_service_mismatch/,
  );

  const substitutedPolicySubject = harness({
    externalReadbackVerifier: async ({ ticket, target_commit, verification_scope }) => {
      const readback = trustedExternalReadback(
        ticket,
        target_commit,
        "2026-07-29T10:00:00.000Z",
        verification_scope,
      );
      readback.github.required_checks_policy_digest = H("8");
      return redigestTrustedReadback(readback);
    },
  });
  await assert.rejects(
    finalizeExact(substitutedPolicySubject, deployAction, mixedDeployManifest),
    /trusted_readback_github_mismatch/,
  );

  for (const [name, mutate] of [
    ["branch", (action) => { action.branch = "agent/release"; }],
    ["source commit", (action) => { delete action.source_commit; }],
    ["base branch", (action) => { delete action.base_branch; }],
    ["expected base", (action) => { delete action.expected_base_commit; }],
    ["rollback", (action) => { action.rollback_commit = G("2"); }],
    ["health contract", (action) => { action.health_contract_digest = H("0"); }],
  ]) {
    await t.test(`production deploy rejects mismatched ${name}`, async () => {
      const invalidAction = structuredClone(deployAction);
      mutate(invalidAction);
      await assert.rejects(
        finalizeExact(harness(), invalidAction, deployManifest),
        /release_manifest_action_mismatch|branch_not_allowed/,
      );
    });
  }
  await t.test("production deploy target cannot drift with its selected service", async () => {
    const driftManifest = releaseManifestInput({
      delivery: {
        method: "manual_render_deploy",
        services: [{
          service_id: "srv-core",
          environment: "production",
          expected_previous_commit: G("1"),
          target_commit: G("5"),
          target_resolution: "exact_commit",
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        }],
      },
    });
    await assert.rejects(
      finalizeExact(harness(), {
        ...deployAction,
        source_commit: G("5"),
        target_commit: G("5"),
      }, driftManifest),
      /release_manifest_action_mismatch/,
    );
  });
  await t.test("production deploy requires an exact target for every service", async () => {
    const nullTargetManifest = releaseManifestInput({
      delivery: {
        method: "manual_render_deploy",
        services: [
          {
            service_id: "srv-core",
            environment: "production",
            expected_previous_commit: G("1"),
            target_commit: G("4"),
            target_resolution: "exact_commit",
            health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
          },
          {
            service_id: "srv-unresolved",
            environment: "production",
            expected_previous_commit: G("2"),
            target_commit: null,
            target_resolution: "post_merge_readback",
            health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
          },
        ],
      },
    });
    await assert.rejects(
      finalizeExact(harness(), deployAction, nullTargetManifest),
      /release_manifest_action_mismatch/,
    );
  });

  const stagingSubject = harness();
  const stagingManifest = releaseManifestInput({
    delivery_branch: "agent/release",
    delivery: {
      method: "manual_render_deploy",
      services: [{
        service_id: "srv-core",
        environment: "staging",
        expected_previous_commit: G("1"),
        target_commit: G("4"),
        target_resolution: "exact_commit",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      }],
    },
  });
  const stagingAction = {
    ...deployAction,
    branch: "agent/release",
    environment: "staging",
    source_commit: G("4"),
    pull_request: 42,
    base_branch: "main",
    expected_base_commit: G("1"),
  };
  const staged = await finalizeExact(stagingSubject, stagingAction, stagingManifest);
  assert.equal(staged.receipt.live_services[0].live_commit, G("4"));

  for (const omitted of ["pull_request", "source_commit", "base_branch", "expected_base_commit"]) {
    const invalidSubject = harness();
    const invalidAction = { ...stagingAction };
    delete invalidAction[omitted];
    await assert.rejects(
      finalizeExact(invalidSubject, invalidAction, stagingManifest),
      /release_manifest_action_mismatch/,
    );
  }

  const rollbackSubject = harness();
  const rollbackManifest = releaseManifestInput({
    base_commit: G("2"),
    head_commit: G("1"),
    tree_sha: G("3"),
    verification: {
      ...releaseManifestInput().verification,
      checks_commit: G("1"),
    },
    delivery: {
      method: "manual_render_deploy",
      services: [{
        service_id: "srv-core",
        environment: "production",
        expected_previous_commit: G("2"),
        target_commit: G("1"),
        target_resolution: "exact_commit",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      }],
    },
    rollback: {
      mode: "redeploy_previous_commit",
      target_commit: G("2"),
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      ready: true,
    },
  });
  const rollbackAction = {
    kind: "render.rollback",
    repository: "owner/repo",
    branch: "main",
    service_id: "srv-core",
    environment: "production",
    target_commit: G("1"),
    expected_live_commit: G("2"),
    trigger: "manual",
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    rollback_commit: G("2"),
    provider_execution: false,
  };
  const rolledBack = await finalizeExact(
    rollbackSubject,
    rollbackAction,
    rollbackManifest,
  );
  assert.equal(rolledBack.receipt.target_commit, G("1"));
  assert.equal(rolledBack.receipt.live_services[0].rollback_commit, G("2"));

  const observationSubject = linkedHarness();
  const parent = await finalizeExact(
    observationSubject,
    protectedPushAction(),
    releaseManifestInput(),
  );
  const observation = await observationSubject.governance.issueActionTicket(
    observationRequest(parent),
  );
  assert.equal(
    observation.ticket.core_join_verdict_id,
    parent.issued.ticket.core_join_verdict_id,
  );
  assert.equal(
    observation.ticket.release_join_resolution_digest,
    parent.issued.ticket.release_join_resolution_digest,
  );
  assert.deepEqual(
    observation.ticket.release_manifest_binding,
    parent.issued.ticket.release_manifest_binding,
  );
  assert.equal(observation.ticket.predecessor.result_commit, parent.receipt.target_commit);
  assert.equal(
    observation.ticket.predecessor.finalize_authorization_digest,
    parent.receipt.authorization_digest,
  );
  assert.deepEqual(observation.ticket.predecessor.source_action, parent.issued.ticket.action);
  assert.equal(
    observation.ticket.predecessor.source_action_digest,
    hostNativeDigest(parent.issued.ticket.action),
  );
  const observationReservation = await observationSubject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: observation.ticket.ticket_id,
    host_session_fingerprint: observation.ticket.host_session_fingerprint,
  });
  await observationSubject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: observation.ticket.ticket_id,
    reservation_id: observationReservation.reservation_id,
    host_session_fingerprint: observation.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("a"),
    readback_digest: H("b"),
  });
  const observed = await observationSubject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: observation.ticket.ticket_id,
    host_session_fingerprint: observation.ticket.host_session_fingerprint,
  });
  assert.equal(observed.target_commit, G("4"));

  for (const [name, mutation, expected] of [
    ["evidence", (request) => { request.evidence_digest = H("7"); }, /predecessor_ticket_invalid/],
    ["branch", (request) => { request.action.branch = "agent/other"; }, /predecessor_ticket_invalid/],
    ["service anchor", (request) => { request.action.service_id = "srv-other"; }, /predecessor_ticket_invalid/],
    ["manifest", (request) => {
      request.release_manifest = buildHostReleaseManifestV2({
        ...releaseManifestInput(),
        manifest_id: "other-manifest",
      });
    }, /predecessor_ticket_invalid/],
  ]) {
    await t.test(`linked observation rejects mismatched ${name}`, async () => {
      const subject = linkedHarness();
      const linkedParent = await finalizeExact(subject, protectedPushAction(), releaseManifestInput());
      const request = observationRequest(linkedParent);
      mutation(request);
      await assert.rejects(subject.governance.issueActionTicket(request), expected);
    });
  }

  await t.test("linked observation rejects an expired parent authorization", async () => {
    const subject = linkedHarness({ reservationLeaseMs: 1_000 });
    const linkedParent = await finalizeExact(subject, protectedPushAction(), releaseManifestInput());
    subject.advance(1_001);
    await assert.rejects(
      subject.governance.issueActionTicket(observationRequest(linkedParent)),
      /predecessor_finalize_authorization_invalid/,
    );
  });

  await t.test("consumed Core Join may expire while a re-attested parent authorization remains fresh", async () => {
    let verifiedAt = Date.parse("2026-07-29T10:00:00.000Z");
    const subject = linkedHarness({
      externalReadbackVerifier: async ({ ticket, target_commit, verification_scope }) => {
        const readback = trustedExternalReadback(
          ticket,
          target_commit,
          new Date(verifiedAt).toISOString(),
          verification_scope,
        );
        readback.github.required_checks_policy_digest = observationPolicyDigest;
        return redigestTrustedReadback(readback);
      },
    });
    const linkedParent = await finalizeExact(
      subject,
      protectedPushAction(),
      releaseManifestInput(),
    );
    const consumedJoin = await subject.governance.readCoreJoinVerdict({
      tenant_id: "codexai",
      verdict_id: linkedParent.issued.ticket.core_join_verdict_id,
    });
    assert.equal(consumedJoin.state, "consumed");
    assert.equal(consumedJoin.uses, 1);
    assert.equal(
      Date.parse(consumedJoin.verdict.expires_at) - Date.parse(consumedJoin.verdict.issued_at),
      30 * 60_000,
    );
    const elapsed = 30 * 60_000 + 1_000;
    verifiedAt += elapsed;
    subject.advance(elapsed);
    assert.ok(Date.parse(consumedJoin.verdict.expires_at) < subject.now());
    const refreshed = await subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: linkedParent.issued.ticket.ticket_id,
      host_session_fingerprint: linkedParent.issued.ticket.host_session_fingerprint,
    });
    assert.notEqual(
      refreshed.authorization_digest,
      linkedParent.receipt.authorization_digest,
    );
    assert.equal(Date.parse(refreshed.expires_at) - Date.parse(refreshed.issued_at), 5 * 60_000);
    assert.ok(Date.parse(refreshed.issued_at) > Date.parse(consumedJoin.verdict.expires_at));
    assert.ok(Date.parse(refreshed.expires_at) > subject.now());
    const observation = await subject.governance.issueActionTicket(
      observationRequest(linkedParent),
    );
    assert.equal(
      observation.ticket.predecessor.finalize_authorization_digest,
      refreshed.authorization_digest,
    );
    assert.equal(
      observation.ticket.core_join_verdict_id,
      consumedJoin.verdict_id,
    );
  });

  async function expiredParentForFreshObservation() {
    let verifiedAt = Date.parse("2026-07-29T10:00:00.000Z");
    const subject = linkedHarness({
      externalReadbackVerifier: async ({ ticket, target_commit, verification_scope }) => {
        const readback = trustedExternalReadback(
          ticket,
          target_commit,
          new Date(verifiedAt).toISOString(),
          verification_scope,
        );
        readback.github.required_checks_policy_digest = observationPolicyDigest;
        return redigestTrustedReadback(readback);
      },
    });
    const parent = await finalizeExact(
      subject,
      protectedPushAction(),
      releaseManifestInput(),
    );
    subject.advance(60 * 60_000 + 1);
    verifiedAt = subject.now();
    const refreshed = await subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: parent.issued.ticket.ticket_id,
      host_session_fingerprint: parent.issued.ticket.host_session_fingerprint,
    });
    return { subject, parent, refreshed };
  }

  async function observationOnlyDelegation(subject, {
    ownerSubjectFingerprint = OWNER,
    allowedActions = ["render.observe"],
    maxTotalActions = 1,
    nonce = "owner-consent-observe-continuation-0001",
  } = {}) {
    return subject.governance.issueDelegation({
      ...subject.delegationInput,
      owner_confirmation: {
        ...subject.delegationInput.owner_confirmation,
        owner_subject_fingerprint: ownerSubjectFingerprint,
        consent_nonce: nonce,
        confirmation_reference: "owner confirmed one late production observation",
      },
      audience: ["codex_native"],
      allowed_branches: ["main"],
      allowed_actions: allowedActions,
      budget: {
        max_agents: 1,
        max_parallel: 1,
        max_commits: 1,
        max_pushes: 1,
        max_deploys: 1,
        max_total_actions: maxTotalActions,
      },
      expires_at: new Date(subject.now() + 60 * 60_000).toISOString(),
    });
  }

  await t.test("expired delegation continues through one signed owner-confirmed observation only", async () => {
    const { subject, parent, refreshed } = await expiredParentForFreshObservation();
    const successor = await observationOnlyDelegation(subject);
    const issued = await subject.governance.issueActionTicket(observationRequest(parent, {
      input: { delegation_id: successor.delegation_id },
    }));
    const continuation = issued.ticket.predecessor.delegation_continuation;
    assert.equal(continuation.schema_version, "host_native_delegation_continuation_v1");
    assert.equal(continuation.parent_delegation_id, parent.delegation.delegation_id);
    assert.equal(continuation.successor_delegation_id, successor.delegation_id);
    assert.equal(continuation.owner_subject_fingerprint, OWNER);
    assert.equal(continuation.host_kind, parent.issued.ticket.host_kind);
    assert.equal(
      continuation.host_session_fingerprint,
      parent.issued.ticket.host_session_fingerprint,
    );
    assert.equal(
      continuation.parent_finalize_authorization_digest,
      refreshed.authorization_digest,
    );
    assert.equal(continuation.authorized_action, "render.observe");
    assert.equal(continuation.max_total_actions, 1);
    assert.equal(continuation.provider_execution, false);
    assert.match(continuation.continuation_digest, /^[a-f0-9]{64}$/);
    assert.match(continuation.signature, /^hndc_[a-f0-9]{64}$/);

    const reserved = await subject.governance.reserveActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    });
    await subject.governance.completeActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      reservation_id: reserved.reservation_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
      outcome: "success",
      result_digest: H("a"),
      readback_digest: H("b"),
    });
    subject.advance(60 * 60_000 + 1);
    const expiredSuccessor = await subject.governance.readDelegation({
      tenant_id: "codexai",
      delegation_id: successor.delegation_id,
    });
    assert.equal(expiredSuccessor.effective_state, "expired");
    const receipt = await subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    });
    assert.equal(receipt.target_commit, G("4"));
    assert.equal(receipt.services_verified, true);
    const consumed = await subject.governance.readDelegation({
      tenant_id: "codexai",
      delegation_id: successor.delegation_id,
    });
    assert.deepEqual(consumed.usage, {
      commits: 0,
      pushes: 0,
      deploys: 0,
      total_actions: 1,
    });
  });

  await t.test("fresh observation continuation rejects an active parent delegation", async () => {
    const subject = linkedHarness();
    const parent = await finalizeExact(
      subject,
      protectedPushAction(),
      releaseManifestInput(),
    );
    const successor = await observationOnlyDelegation(subject);
    await assert.rejects(
      subject.governance.issueActionTicket(observationRequest(parent, {
        input: { delegation_id: successor.delegation_id },
      })),
      /delegation_continuation_invalid/,
    );
  });

  await t.test("fresh observation continuation rejects a revoked parent delegation", async () => {
    const { subject, parent } = await expiredParentForFreshObservation();
    await subject.governance.revokeDelegation({
      tenant_id: "codexai",
      delegation_id: parent.delegation.delegation_id,
      owner_confirmation: {
        ...subject.delegationInput.owner_confirmation,
        consent_nonce: "owner-consent-revoke-expired-parent-0001",
        confirmation_reference: "owner revoked expired parent delegation",
      },
    });
    const successor = await observationOnlyDelegation(subject);
    await assert.rejects(
      subject.governance.issueActionTicket(observationRequest(parent, {
        input: { delegation_id: successor.delegation_id },
      })),
      /delegation_continuation_invalid/,
    );
  });

  await t.test("fresh observation continuation rejects a different owner subject", async () => {
    const { subject, parent } = await expiredParentForFreshObservation();
    const successor = await observationOnlyDelegation(subject, {
      ownerSubjectFingerprint: `osf_${H("b")}`,
    });
    await assert.rejects(
      subject.governance.issueActionTicket(observationRequest(parent, {
        input: { delegation_id: successor.delegation_id },
      })),
      /delegation_continuation_invalid/,
    );
  });

  for (const [name, delegationOverrides] of [
    ["broader actions", { allowedActions: ["git.commit", "render.observe"] }],
    ["broader budget", { maxTotalActions: 2 }],
  ]) {
    await t.test(`fresh observation continuation rejects ${name}`, async () => {
      const { subject, parent } = await expiredParentForFreshObservation();
      const successor = await observationOnlyDelegation(subject, delegationOverrides);
      await assert.rejects(
        subject.governance.issueActionTicket(observationRequest(parent, {
          input: { delegation_id: successor.delegation_id },
        })),
        /delegation_continuation_invalid/,
      );
    });
  }

  await t.test("fresh observation continuation rejects induced or effectful action fields", async () => {
    const { subject, parent } = await expiredParentForFreshObservation();
    const successor = await observationOnlyDelegation(subject);
    await assert.rejects(
      subject.governance.issueActionTicket(observationRequest(parent, {
        action: {
          induced_effects: [{
            service_id: "srv-core",
            environment: "production",
            trigger: "github_auto_deploy",
          }],
        },
        input: { delegation_id: successor.delegation_id },
      })),
      /delegation_continuation_action_field_denied:induced_effects/,
    );
  });

  await t.test("fresh observation continuation rejects a different host session", async () => {
    const { subject, parent } = await expiredParentForFreshObservation();
    const successor = await observationOnlyDelegation(subject);
    await assert.rejects(
      subject.governance.issueActionTicket(observationRequest(parent, {
        input: {
          delegation_id: successor.delegation_id,
          host_session_fingerprint: "different-host-session",
        },
      })),
      /predecessor_ticket_invalid|delegation_continuation_invalid/,
    );
  });

  await t.test("real governance ticket finalizes through the real external verifier", async () => {
    const workflowSource = "name: Core\non: [push]\n";
    const workflowSha = crypto.createHash("sha256").update(workflowSource).digest("hex");
    const json = (body) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      const root = "https://api.github.com/repos/owner/repo";
      if (url === `${root}/commits/${G("4")}/check-runs?per_page=100`) {
        return json({ check_runs: [{
          id: 101,
          name: "unit-tests",
          head_sha: G("4"),
          status: "completed",
          conclusion: "success",
          details_url: "https://github.com/owner/repo/actions/runs/700/job/800",
          app: { id: 15368, slug: "github-actions", owner: { login: "github" } },
        }] });
      }
      if (url === `${root}/actions/runs/700`) {
        return json({
          id: 700,
          workflow_id: 312527659,
          run_attempt: 1,
          name: "Core",
          path: ".github/workflows/core.yml",
          event: "push",
          head_sha: G("4"),
          head_branch: "main",
          repository: { full_name: "owner/repo" },
          pull_requests: [],
          status: "completed",
          conclusion: "success",
        });
      }
      if ([G("1"), G("4")].some((ref) =>
        url === `${root}/contents/.github/workflows/core.yml?ref=${ref}`)) {
        return json({
          type: "file",
          path: ".github/workflows/core.yml",
          encoding: "base64",
          content: Buffer.from(workflowSource).toString("base64"),
        });
      }
      if (url === `${root}/git/ref/heads/main`) return json({ object: { sha: G("4") } });
      if (url === `${root}/git/commits/${G("4")}`) return json({ sha: G("4") });
      if (url === `${root}/git/commits/${G("1")}`) return json({ sha: G("1") });
      if (url === "https://srv-core.onrender.com/healthz") {
        return json({
          ok: true,
          render_ready: true,
          version: "integration-1",
          build: { build_id: "build-integration", commit_sha: G("4"), commit_verifiable: true },
          health_contract_version: HOST_NATIVE_HEALTH_CONTRACT_VERSION,
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    };
    const externalReadbackVerifier = createHostNativeExternalReadbackVerifier({
      fetchImpl,
      requiredChecksPolicyResolver: async () => ({
        schema_version: "host_native_required_checks_policy_v1",
        tenant_id: "codexai",
        repository: "owner/repo",
        base_branch: "main",
        required_checks: ["unit-tests"],
        check_app: { id: 15368, slug: "github-actions", owner: "github" },
        workflow: {
          id: 312527659,
          name: "Core",
          path: ".github/workflows/core.yml",
          sha256: workflowSha,
        },
        allowed_events: ["push"],
      }),
      now: () => Date.parse("2026-07-29T10:00:00.000Z"),
    });
    const requiredChecksPolicy = {
      schema_version: "host_native_required_checks_policy_v1",
      tenant_id: "codexai",
      repository: "owner/repo",
      base_branch: "main",
      required_checks: ["unit-tests"],
      check_app: { id: 15368, slug: "github-actions", owner: "github" },
      workflow: {
        id: 312527659,
        name: "Core",
        path: ".github/workflows/core.yml",
        sha256: workflowSha,
      },
      allowed_events: ["push"],
    };
    const subject = harness({
      externalReadbackVerifier,
      requiredChecksPolicyResolver: async () => requiredChecksPolicy,
    });
    const linkedParent = await finalizeExact(subject, protectedPushAction(), releaseManifestInput());
    const issued = await subject.governance.issueActionTicket(observationRequest(linkedParent));
    const reserved = await subject.governance.reserveActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    });
    await subject.governance.completeActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      reservation_id: reserved.reservation_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
      outcome: "success",
      result_digest: H("a"),
      readback_digest: H("b"),
    });
    const receipt = await subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    });
    assert.equal(receipt.target_commit, G("4"));
    assert.equal(receipt.github_readback.action_kind, "render.observe");
    assert.equal(receipt.github_readback.source_action_kind, "git.push.protected");
    assert.equal(receipt.live_services[0].live_commit, G("4"));
    assert.ok(calls.some(({ url }) => url.endsWith("/git/ref/heads/main")));
    assert.ok(calls.some(({ url }) => url === "https://srv-core.onrender.com/healthz"));
  });

  await t.test("merged-PR parent drives real full-release observation when workflow association is empty", async () => {
    const baseCommit = G("1");
    const headCommit = G("3");
    const mergeCommit = G("4");
    assert.notEqual(mergeCommit, headCommit);
    const workflowSource = "name: Core Merge\non: [pull_request]\n";
    const workflowSha = crypto.createHash("sha256").update(workflowSource).digest("hex");
    const policy = {
      schema_version: "host_native_required_checks_policy_v1",
      tenant_id: "codexai",
      repository: "owner/repo",
      base_branch: "main",
      required_checks: ["unit-tests"],
      check_app: { id: 15368, slug: "github-actions", owner: "github" },
      workflow: {
        id: 312527659,
        name: "Core Merge",
        path: ".github/workflows/core-merge.yml",
        sha256: workflowSha,
      },
      allowed_events: ["pull_request"],
    };
    const json = (body) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      const root = "https://api.github.com/repos/owner/repo";
      if (url === `${root}/commits/${headCommit}/check-runs?per_page=100`) {
        return json({ check_runs: [{
          id: 201,
          name: "unit-tests",
          head_sha: headCommit,
          status: "completed",
          conclusion: "success",
          details_url: "https://github.com/owner/repo/actions/runs/900/job/901",
          app: { id: 15368, slug: "github-actions", owner: { login: "github" } },
        }] });
      }
      if (url === `${root}/actions/runs/900`) {
        return json({
          id: 900,
          workflow_id: 312527659,
          run_attempt: 1,
          name: "Core Merge",
          path: ".github/workflows/core-merge.yml",
          event: "pull_request",
          head_sha: headCommit,
          head_branch: "agent/native-work",
          repository: { full_name: "owner/repo" },
          pull_requests: [],
          status: "completed",
          conclusion: "success",
        });
      }
      if ([baseCommit, headCommit].some((ref) =>
        url === `${root}/contents/.github/workflows/core-merge.yml?ref=${ref}`)) {
        return json({
          type: "file",
          path: ".github/workflows/core-merge.yml",
          encoding: "base64",
          content: Buffer.from(workflowSource).toString("base64"),
        });
      }
      if (url === `${root}/pulls/42`) {
        return json({
          number: 42,
          state: "closed",
          draft: false,
          merged: true,
          merge_commit_sha: mergeCommit,
          head: {
            sha: headCommit,
            ref: "agent/native-work",
            repo: { full_name: "owner/repo" },
          },
          base: {
            sha: baseCommit,
            ref: "main",
            repo: { full_name: "owner/repo" },
          },
        });
      }
      if (url === `${root}/git/ref/heads/main`) {
        return json({ object: { sha: mergeCommit } });
      }
      if (url === `${root}/git/commits/${mergeCommit}`) return json({ sha: mergeCommit });
      if (url === `${root}/git/commits/${baseCommit}`) return json({ sha: baseCommit });
      const service = /https:\/\/(srv-core|srv-aux)\.onrender\.com\/healthz$/.exec(url)?.[1];
      if (service) {
        return json({
          ok: true,
          render_ready: true,
          version: `integration-${service}`,
          build: {
            build_id: `build-${service}`,
            commit_sha: mergeCommit,
            commit_verifiable: true,
          },
          health_contract_version: HOST_NATIVE_HEALTH_CONTRACT_VERSION,
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    };
    let verificationClock = Date.parse("2026-07-29T10:00:00.000Z");
    const externalReadbackVerifier = createHostNativeExternalReadbackVerifier({
      fetchImpl,
      requiredChecksPolicyResolver: async () => policy,
      now: () => verificationClock,
    });
    const subject = harness({
      externalReadbackVerifier,
      requiredChecksPolicyResolver: async () => policy,
    });
    const services = ["srv-core", "srv-aux"].map((service_id) => ({
      service_id,
      environment: "production",
      expected_previous_commit: baseCommit,
      target_commit: null,
      target_resolution: "post_merge_readback",
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    }));
    const parent = await finalizeExact(
      subject,
      githubMergeAction({
        induced_effects: services.map(({ service_id, environment }) => ({
          service_id,
          environment,
          trigger: "github_auto_deploy",
        })),
      }),
      mergeReleaseManifestInput({
        delivery: {
          method: "github_protected_push_auto_deploy",
          services,
        },
      }),
    );
    assert.equal(parent.issued.ticket.action.head_commit, headCommit);
    assert.equal(parent.receipt.target_commit, mergeCommit);
    assert.equal(parent.receipt.verification_scope, "github_merge_and_checks_only");
    assert.equal(parent.receipt.services_verified, false);
    assert.deepEqual(parent.receipt.live_services, []);
    subject.advance(60 * 60_000 + 1);
    verificationClock = subject.now();
    const refreshedParent = await subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: parent.issued.ticket.ticket_id,
      host_session_fingerprint: parent.issued.ticket.host_session_fingerprint,
    });
    const successor = await observationOnlyDelegation(subject, {
      nonce: "owner-consent-merge-observe-continuation-0001",
    });
    const observation = await subject.governance.issueActionTicket(
      observationRequest(parent, {
        action: { target_commit: mergeCommit },
        input: { delegation_id: successor.delegation_id },
      }),
    );
    assert.equal(
      observation.ticket.predecessor.delegation_continuation
        .parent_finalize_authorization_digest,
      refreshedParent.authorization_digest,
    );
    assert.equal(
      observation.ticket.predecessor.delegation_continuation
        .successor_delegation_id,
      successor.delegation_id,
    );
    const reserved = await subject.governance.reserveActionTicket({
      tenant_id: "codexai",
      ticket_id: observation.ticket.ticket_id,
      host_session_fingerprint: observation.ticket.host_session_fingerprint,
    });
    await subject.governance.completeActionTicket({
      tenant_id: "codexai",
      ticket_id: observation.ticket.ticket_id,
      reservation_id: reserved.reservation_id,
      host_session_fingerprint: observation.ticket.host_session_fingerprint,
      outcome: "success",
      result_digest: H("a"),
      readback_digest: H("b"),
    });
    const receipt = await subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: observation.ticket.ticket_id,
      host_session_fingerprint: observation.ticket.host_session_fingerprint,
    });
    assert.equal(receipt.verification_scope, "full_release");
    assert.equal(receipt.services_verified, true);
    assert.equal(receipt.target_commit, mergeCommit);
    assert.equal(receipt.github_readback.action_kind, "render.observe");
    assert.equal(receipt.github_readback.source_action_kind, "github.merge");
    assert.equal(receipt.github_readback.pull_request, 42);
    assert.equal(receipt.github_readback.head_commit, headCommit);
    assert.equal(receipt.github_readback.merge_commit, mergeCommit);
    assert.equal(receipt.github_readback.branch, "main");
    assert.equal(receipt.github_readback.branch_commit, mergeCommit);
    assert.deepEqual(
      receipt.live_services.map(({ service_id, live_commit, rollback_commit }) => ({
        service_id,
        live_commit,
        rollback_commit,
      })),
      [
        { service_id: "srv-aux", live_commit: mergeCommit, rollback_commit: baseCommit },
        { service_id: "srv-core", live_commit: mergeCommit, rollback_commit: baseCommit },
      ],
    );
    assert.ok(calls.some(({ url }) => url.endsWith("/actions/runs/900")));
    assert.ok(calls.some(({ url }) => url.endsWith("/git/ref/heads/main")));
    assert.ok(calls.filter(({ url }) => url.endsWith("/pulls/42")).length >= 2);
    for (const service of ["srv-core", "srv-aux"]) {
      assert.ok(calls.some(({ url }) =>
        url === `https://${service}.onrender.com/healthz`));
    }
  });
});

test("GitHub draft, ready and protected merge are exact bounded actions", async () => {
  const draftSubject = harness();
  const draftDelegation = await draftSubject.governance.issueDelegation(draftSubject.delegationInput);
  const common = {
    tenant_id: "codexai",
    delegation_id: draftDelegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "session-fingerprint-codex-pr",
    evidence_digest: H("9"),
  };
  const draft = await draftSubject.governance.issueActionTicket({
    ...common,
    action: {
      kind: "github.draft_pr",
      repository: "owner/repo",
      head_branch: "agent/native-work",
      base_branch: "main",
      head_commit: G("3"),
      expected_base_commit: G("1"),
      title_digest: H("a"),
      body_digest: H("b"),
      draft: true,
      force: false,
      delete_ref: false,
      tags: false,
      provider_execution: false,
    },
  });
  assert.equal(draft.ticket.action.kind, "github.draft_pr");

  const readySubject = harness();
  const readyDelegation = await readySubject.governance.issueDelegation(readySubject.delegationInput);
  const ready = await readySubject.governance.issueActionTicket({
    ...common,
    delegation_id: readyDelegation.delegation_id,
    action: {
      kind: "github.ready",
      repository: "owner/repo",
      head_branch: "agent/native-work",
      base_branch: "main",
      pull_request: 42,
      head_commit: G("3"),
      draft_before: true,
      ready_for_review: true,
      force: false,
      delete_ref: false,
      tags: false,
      provider_execution: false,
    },
  });
  assert.equal(ready.ticket.action.kind, "github.ready");

  const mergeSubject = harness();
  const mergeDelegation = await mergeSubject.governance.issueDelegation(mergeSubject.delegationInput);
  const mergeRequest = {
    ...common,
    delegation_id: mergeDelegation.delegation_id,
    action: githubMergeAction(),
    evidence_digest: H("6"),
  };
  await assert.rejects(
    mergeSubject.governance.issueActionTicket(mergeRequest),
    /release_manifest_required/,
  );
  const preMergeTargetManifest = await bindCoreJoinVerdict(
    mergeSubject.governance,
    buildHostReleaseManifestV2(mergeReleaseManifestInput({
    delivery: {
      method: "github_protected_push_auto_deploy",
      services: [{
        service_id: "srv-core",
        environment: "production",
        expected_previous_commit: G("1"),
        target_commit: G("3"),
        target_resolution: "exact_commit",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      }],
    },
    })),
  );
  await assert.rejects(mergeSubject.governance.issueActionTicket({
    ...mergeRequest,
    release_manifest: preMergeTargetManifest,
  }), /github_merge_post_merge_readback_required/);
  const manifest = await bindCoreJoinVerdict(
    mergeSubject.governance,
    buildHostReleaseManifestV2(mergeReleaseManifestInput()),
  );
  const merged = await mergeSubject.governance.issueActionTicket({
    ...mergeRequest,
    release_manifest: manifest,
  });
  assert.equal(merged.ticket.action.kind, "github.merge");
  assert.equal(merged.ticket.release_manifest_digest, manifest.manifest_digest);
  const reserved = await mergeSubject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: merged.ticket.ticket_id,
    host_session_fingerprint: merged.ticket.host_session_fingerprint,
  });
  await assert.rejects(mergeSubject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: merged.ticket.ticket_id,
    host_session_fingerprint: merged.ticket.host_session_fingerprint,
  }), /successful_outcome_required/);
  await assert.rejects(mergeSubject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: merged.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: merged.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("d"),
  }), /commit_result_evidence_required/);
  const completionReadbackDigest = H("e");
  const completed = await mergeSubject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: merged.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: merged.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("d"),
    result_commit: G("4"),
    readback_digest: completionReadbackDigest,
  });
  assert.equal(completed.result_commit, G("4"));
  const finalize = await mergeSubject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: merged.ticket.ticket_id,
    host_session_fingerprint: merged.ticket.host_session_fingerprint,
  });
  assert.equal(finalize.trusted, true);
  assert.equal(finalize.allowed, true);
  assert.equal(finalize.decision_id, merged.ticket.ticket_id);
  assert.equal(finalize.target_commit, G("4"));
  assert.equal(finalize.action_ticket_id, merged.ticket.ticket_id);
  assert.equal(finalize.release_manifest_digest, manifest.manifest_digest);
  assert.equal(finalize.host_readback_digest, completionReadbackDigest);
  assert.match(finalize.external_readback_digest, /^[a-f0-9]{64}$/);
  assert.equal(finalize.result_commit_verified, true);
  assert.equal(finalize.verification_scope, "github_merge_and_checks_only");
  assert.equal(finalize.services_verified, false);
  assert.deepEqual(finalize.live_services, []);
  assert.match(finalize.signature, /^hnf_[a-f0-9]{64}$/);
  await assert.rejects(mergeSubject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: merged.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: merged.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("d"),
    result_commit: G("4"),
    readback_digest: completionReadbackDigest,
  }), /not_completable/);
  await assert.rejects(mergeSubject.governance.issueActionTicket({
    ...mergeRequest,
    action: githubMergeAction({ base_branch: "agent/not-protected" }),
    release_manifest: await bindCoreJoinVerdict(
      mergeSubject.governance,
      buildHostReleaseManifestV2(mergeReleaseManifestInput({
        delivery_branch: "agent/not-protected",
      })),
    ),
  }), /protected_base_required/);
  await assert.rejects(mergeSubject.governance.issueActionTicket({
    ...mergeRequest,
    action: githubMergeAction({ induced_effects: [] }),
    release_manifest: manifest,
  }), /induced_deploy_required/);
  await assert.rejects(mergeSubject.governance.issueActionTicket({
    ...mergeRequest,
    action: githubMergeAction({ force: true }),
    release_manifest: manifest,
  }), /absolute_deny/);
});

test("optional predecessor chain is commit-bound and carried into the final release receipt", async () => {
  const subject = harness();
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const completeSimple = async (record, extra = {}) => {
    const reserved = await subject.governance.reserveActionTicket({
      tenant_id: "codexai",
      ticket_id: record.ticket.ticket_id,
      host_session_fingerprint: record.ticket.host_session_fingerprint,
    });
    return subject.governance.completeActionTicket({
      tenant_id: "codexai",
      ticket_id: record.ticket.ticket_id,
      reservation_id: reserved.reservation_id,
      host_session_fingerprint: record.ticket.host_session_fingerprint,
      outcome: "success",
      result_digest: H("a"),
      ...extra,
    });
  };
  const commit = await issueCommitTicket(subject.governance, delegation.delegation_id);
  await completeSimple(commit, {
    result_commit: G("3"),
    readback_digest: H("b"),
  });
  const push = await subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "predecessor-push",
    predecessor_ticket_id: commit.ticket.ticket_id,
    action: {
      kind: "git.push.branch",
      repository: "owner/repo",
      branch: "agent/native-work",
      source_commit: G("3"),
      expected_remote_commit: G("1"),
      force: false,
      delete_ref: false,
      tags: false,
      induced_effects: [],
      provider_execution: false,
    },
    evidence_digest: H("9"),
  });
  await completeSimple(push);
  const draft = await subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "predecessor-draft",
    predecessor_ticket_id: push.ticket.ticket_id,
    action: {
      kind: "github.draft_pr",
      repository: "owner/repo",
      head_branch: "agent/native-work",
      base_branch: "main",
      head_commit: G("3"),
      expected_base_commit: G("1"),
      title_digest: H("a"),
      body_digest: H("b"),
      draft: true,
      force: false,
      delete_ref: false,
      tags: false,
      provider_execution: false,
    },
    evidence_digest: H("9"),
  });
  await completeSimple(draft);
  const ready = await subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "predecessor-ready",
    predecessor_ticket_id: draft.ticket.ticket_id,
    action: {
      kind: "github.ready",
      repository: "owner/repo",
      head_branch: "agent/native-work",
      base_branch: "main",
      pull_request: 42,
      head_commit: G("3"),
      draft_before: true,
      ready_for_review: true,
      force: false,
      delete_ref: false,
      tags: false,
      provider_execution: false,
    },
    evidence_digest: H("9"),
  });
  await completeSimple(ready);
  const pending = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  const manifest = await bindCoreJoinVerdict(subject.governance, pending);
  const merge = await subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "predecessor-merge",
    predecessor_ticket_id: ready.ticket.ticket_id,
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: manifest,
  });
  assert.equal(merge.ticket.predecessor.ticket_id, ready.ticket.ticket_id);
  assert.match(merge.ticket.predecessor_chain_digest, /^[a-f0-9]{64}$/);
  const mergeReservation = await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: merge.ticket.ticket_id,
    host_session_fingerprint: merge.ticket.host_session_fingerprint,
  });
  await subject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: merge.ticket.ticket_id,
    reservation_id: mergeReservation.reservation_id,
    host_session_fingerprint: merge.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("a"),
    result_commit: G("4"),
    readback_digest: H("b"),
  });
  const receipt = await subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: merge.ticket.ticket_id,
    host_session_fingerprint: merge.ticket.host_session_fingerprint,
  });
  assert.deepEqual(receipt.predecessor, merge.ticket.predecessor);
  assert.equal(receipt.predecessor_chain_digest, merge.ticket.predecessor_chain_digest);
});

test("Render deploy predecessor requires a current trusted merge finalization bound into the chain", async () => {
  const subject = harness();
  const merge = await prepareFinalizableMerge(subject);
  const deployManifest = await bindCoreJoinVerdict(
    subject.governance,
    buildHostReleaseManifestV2(releaseManifestInput({
      delivery: {
        method: "manual_render_deploy",
        services: [{
          service_id: "srv-core",
          environment: "production",
          expected_previous_commit: G("1"),
          target_commit: G("4"),
          target_resolution: "exact_commit",
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        }],
      },
    })),
  );
  const deployRequest = {
    tenant_id: "codexai",
    delegation_id: merge.delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "post-merge-render-deploy",
    predecessor_ticket_id: merge.issued.ticket.ticket_id,
    action: {
      kind: "render.deploy",
      repository: "owner/repo",
      branch: "main",
      base_branch: "main",
      source_commit: G("4"),
      service_id: "srv-core",
      environment: "production",
      target_commit: G("4"),
      expected_base_commit: G("1"),
      expected_live_commit: G("1"),
      trigger: "manual",
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      rollback_commit: G("1"),
      provider_execution: false,
    },
    evidence_digest: H("7"),
    release_manifest: deployManifest,
  };

  await assert.rejects(
    subject.governance.issueActionTicket(deployRequest),
    /predecessor_finalize_authorization_required/,
  );
  const mergeReceipt = await subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: merge.issued.ticket.ticket_id,
    host_session_fingerprint: merge.issued.ticket.host_session_fingerprint,
  });
  assert.equal(mergeReceipt.verification_scope, "github_merge_and_checks_only");
  assert.equal(mergeReceipt.services_verified, false);
  assert.deepEqual(mergeReceipt.live_services, []);

  const deploy = await subject.governance.issueActionTicket(deployRequest);
  assert.equal(
    deploy.ticket.predecessor.finalize_authorization_digest,
    mergeReceipt.authorization_digest,
  );
  assert.equal(
    deploy.ticket.predecessor_chain_digest,
    hostNativeDigest(deploy.ticket.predecessor),
  );
});

test("Render deploy predecessor rejects stale, tampered, and target-mismatched finalize receipts", async (t) => {
  async function prepared({ tamper, advance = 0, targetCommit = G("4") } = {}) {
    const store = createInMemoryHostNativeGovernanceStore();
    const subject = harness({ store });
    const merge = await prepareFinalizableMerge(subject);
    await subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: merge.issued.ticket.ticket_id,
      host_session_fingerprint: merge.issued.ticket.host_session_fingerprint,
    });
    if (tamper) store.mutate((state) => tamper(
      state.tickets[merge.issued.ticket.ticket_id].finalize_authorization,
    ));
    if (advance) subject.advance(advance);
    const manifest = await bindCoreJoinVerdict(
      subject.governance,
      buildHostReleaseManifestV2(releaseManifestInput({
        head_commit: targetCommit,
        verification: {
          ...releaseManifestInput().verification,
          checks_commit: targetCommit,
        },
        delivery: {
          method: "manual_render_deploy",
          services: [{
            service_id: "srv-core",
            environment: "production",
            expected_previous_commit: G("1"),
            target_commit: targetCommit,
            target_resolution: "exact_commit",
            health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
          }],
        },
      })),
    );
    return {
      subject,
      request: {
        tenant_id: "codexai",
        delegation_id: merge.delegation.delegation_id,
        work_id: "work-1",
        intent_anchor_digest: H("1"),
        repository: "owner/repo",
        host_kind: "codex_native",
        host_session_fingerprint: "attacked-render-deploy",
        predecessor_ticket_id: merge.issued.ticket.ticket_id,
        action: {
          kind: "render.deploy",
          repository: "owner/repo",
          branch: "main",
          base_branch: "main",
          source_commit: targetCommit,
          service_id: "srv-core",
          environment: "production",
          target_commit: targetCommit,
          expected_base_commit: G("1"),
          expected_live_commit: G("1"),
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
          rollback_commit: G("1"),
          provider_execution: false,
        },
        evidence_digest: H("7"),
        release_manifest: manifest,
      },
    };
  }

  await t.test("expired receipt", async () => {
    const item = await prepared({ advance: 5 * 60_000 + 1 });
    await assert.rejects(
      item.subject.governance.issueActionTicket(item.request),
      /predecessor_finalize_authorization_invalid/,
    );
  });
  await t.test("tampered receipt digest", async () => {
    const item = await prepared({
      tamper: (receipt) => { receipt.authorization_digest = H("f"); },
    });
    await assert.rejects(
      item.subject.governance.issueActionTicket(item.request),
      /predecessor_finalize_authorization_invalid/,
    );
  });
  await t.test("target mismatch", async () => {
    const item = await prepared({ targetCommit: G("5") });
    await assert.rejects(
      item.subject.governance.issueActionTicket(item.request),
      /predecessor_finalize_authorization_invalid/,
    );
  });
});

test("GitHub merge reconciliation rejects a mismatched observed commit", async () => {
  const subject = harness();
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const manifest = await bindCoreJoinVerdict(
    subject.governance,
    buildHostReleaseManifestV2(mergeReleaseManifestInput()),
  );
  const issued = await subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "session-fingerprint-codex-merge-reconcile",
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: manifest,
  });
  const reserved = await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  await subject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    outcome: "unknown",
    result_digest: H("d"),
    result_commit: G("4"),
    readback_digest: H("e"),
  });
  const reconciliationReadbackDigest = H("f");
  await assert.rejects(subject.governance.reconcileActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    observed_outcome: "success",
    observed_commit: G("5"),
    readback_digest: reconciliationReadbackDigest,
  }), /observed_commit_mismatch/);
  const reconciled = await subject.governance.reconcileActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    observed_outcome: "success",
    observed_commit: G("4"),
    readback_digest: reconciliationReadbackDigest,
  });
  assert.equal(reconciled.state, "reconciled");
  const finalize = await subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  assert.equal(finalize.outcome_source, "reconciled_readback");
  assert.equal(finalize.target_commit, G("4"));
  assert.equal(finalize.host_readback_digest, reconciliationReadbackDigest);
});

test("completed releases re-attest after receipt expiry without replaying the action", async () => {
  let verifierCalls = 0;
  let verifiedAtOverride = null;
  let readbackTransform = (readback) => readback;
  let subject;
  subject = harness({
    ticketTtlMs: 60_000,
    externalReadbackVerifier: async ({ ticket, target_commit, verification_scope }) => {
      verifierCalls += 1;
      const readback = trustedExternalReadback(
        ticket,
        target_commit,
        verifiedAtOverride || new Date(subject.now()).toISOString(),
        verification_scope,
      );
      return readbackTransform(readback);
    },
  });
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const issued = await issueMergeTicket(subject.governance, delegation.delegation_id);
  const reserved = await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  subject.advance(2 * 60_000 + 1);
  await subject.governance.revokeDelegation({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "owner-revokes-after-reserve",
      confirmation_reference: "revoke new actions while allowing bounded closure",
    },
  });
  const completed = await subject.governance.completeActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("a"),
    result_commit: G("4"),
    readback_digest: H("b"),
  });
  assert.equal(completed.state, "completed");
  subject.advance(Date.parse(reserved.reservation_expires_at) - subject.now() + 1);
  const receipt = await subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  assert.ok(Date.parse(receipt.issued_at) > Date.parse(issued.ticket.expires_at));
  assert.ok(Date.parse(receipt.expires_at) > Date.parse(reserved.reservation_expires_at));
  assert.ok(Date.parse(receipt.expires_at) > Date.parse(receipt.issued_at));
  assert.deepEqual(receipt.changed_files, issued.ticket.release_manifest_binding.changed_files);
  assert.equal(receipt.core_join_verdict_id, issued.ticket.core_join_verdict_id);
  assert.match(receipt.core_join_verdict_digest, /^[a-f0-9]{64}$/);
  assert.match(receipt.release_intent_digest, /^[a-f0-9]{64}$/);
  const replay = await subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  assert.deepEqual(replay, receipt);
  assert.equal(verifierCalls, 1);
  await assert.rejects(issueCommitTicket(subject.governance, delegation.delegation_id), /delegation_not_active/);
  const lifecycleBeforeReattestation = {
    ticket: await subject.governance.readActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
    }),
    delegation: await subject.governance.readDelegation({
      tenant_id: "codexai",
      delegation_id: delegation.delegation_id,
    }),
    join: await subject.governance.readCoreJoinVerdict({
      tenant_id: "codexai",
      verdict_id: issued.ticket.core_join_verdict_id,
    }),
  };
  subject.advance(Date.parse(receipt.expires_at) - subject.now() + 1);
  readbackTransform = (readback) => redigestTrustedReadback({
    ...readback,
    github: { ...readback.github, merge_commit: G("5") },
  });
  await assert.rejects(subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  }), /trusted_readback_github_mismatch/);
  let historical = await subject.governance.readActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
  });
  assert.deepEqual(historical.finalize_authorization, receipt);
  assert.equal(historical.finalize_authorization_history, undefined);

  readbackTransform = (readback) => readback;
  verifiedAtOverride = receipt.issued_at;
  await assert.rejects(subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  }), /trusted_readback_stale/);
  historical = await subject.governance.readActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
  });
  assert.deepEqual(historical.finalize_authorization, receipt);
  assert.equal(historical.finalize_authorization_history, undefined);

  verifiedAtOverride = null;
  const reattested = await subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  assert.notEqual(reattested.authorization_digest, receipt.authorization_digest);
  assert.equal(reattested.previous_authorization_digest, receipt.authorization_digest);
  assert.ok(Date.parse(reattested.issued_at) > Date.parse(receipt.expires_at));
  const reattestedReplay = await subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  assert.deepEqual(reattestedReplay, reattested);

  subject.advance(Date.parse(reattested.expires_at) - subject.now() + 1);
  const callsBeforeConcurrentReattestation = verifierCalls;
  const [concurrentOne, concurrentTwo] = await Promise.all([
    subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    }),
    subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    }),
  ]);
  assert.deepEqual(concurrentTwo, concurrentOne);
  assert.equal(
    concurrentOne.previous_authorization_digest,
    reattested.authorization_digest,
  );
  assert.equal(verifierCalls, callsBeforeConcurrentReattestation + 2);

  let latest = concurrentOne;
  const expectedHistoricalDigests = [
    receipt.authorization_digest,
    reattested.authorization_digest,
  ];
  for (let index = 0; index < 17; index += 1) {
    subject.advance(Date.parse(latest.expires_at) - subject.now() + 1);
    expectedHistoricalDigests.push(latest.authorization_digest);
    latest = await subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    });
  }
  historical = await subject.governance.readActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
  });
  assert.deepEqual(historical.finalize_authorization, latest);
  assert.equal(historical.finalize_authorization_history.length, 16);
  assert.deepEqual(
    historical.finalize_authorization_history.map((entry) => entry.authorization_digest),
    expectedHistoricalDigests.slice(-16),
  );
  for (const entry of historical.finalize_authorization_history) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "authorization_digest",
      "expires_at",
      "external_readback_digest",
      "issued_at",
    ]);
  }
  const lifecycleAfterReattestation = {
    delegation: await subject.governance.readDelegation({
      tenant_id: "codexai",
      delegation_id: delegation.delegation_id,
    }),
    join: await subject.governance.readCoreJoinVerdict({
      tenant_id: "codexai",
      verdict_id: issued.ticket.core_join_verdict_id,
    }),
  };
  assert.equal(historical.state, lifecycleBeforeReattestation.ticket.state);
  assert.equal(historical.uses, lifecycleBeforeReattestation.ticket.uses);
  assert.equal(historical.reservation_id, lifecycleBeforeReattestation.ticket.reservation_id);
  assert.equal(historical.result_digest, lifecycleBeforeReattestation.ticket.result_digest);
  assert.deepEqual(
    lifecycleAfterReattestation.delegation.usage,
    lifecycleBeforeReattestation.delegation.usage,
  );
  assert.equal(lifecycleAfterReattestation.join.state, lifecycleBeforeReattestation.join.state);
  assert.equal(lifecycleAfterReattestation.join.uses, lifecycleBeforeReattestation.join.uses);
  assert.equal(
    lifecycleAfterReattestation.join.consumed_by_ticket_id,
    lifecycleBeforeReattestation.join.consumed_by_ticket_id,
  );

  const expired = harness({ reservationLeaseMs: 60_000 });
  const expiredDelegation =
    await expired.governance.issueDelegation(expired.delegationInput);
  const expiredTicket =
    await issueMergeTicket(expired.governance, expiredDelegation.delegation_id);
  const expiredReservation = await expired.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: expiredTicket.ticket.ticket_id,
    host_session_fingerprint: expiredTicket.ticket.host_session_fingerprint,
  });
  expired.advance(60_001);
  const completion = {
    tenant_id: "codexai",
    ticket_id: expiredTicket.ticket.ticket_id,
    reservation_id: expiredReservation.reservation_id,
    host_session_fingerprint: expiredTicket.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("a"),
    result_commit: G("4"),
    readback_digest: H("b"),
  };
  await assert.rejects(
    expired.governance.completeActionTicket(completion),
    /reservation_expired/,
  );
  await assert.rejects(expired.governance.reconcileActionTicket({
    tenant_id: "codexai",
    ticket_id: expiredTicket.ticket.ticket_id,
    reservation_id: expiredReservation.reservation_id,
    host_session_fingerprint: expiredTicket.ticket.host_session_fingerprint,
    observed_outcome: "success",
    observed_commit: G("4"),
    readback_digest: H("c"),
  }), /reservation_expired/);
  await assert.rejects(expired.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: expiredTicket.ticket.ticket_id,
    host_session_fingerprint: expiredTicket.ticket.host_session_fingerprint,
  }), /reservation_expired/);
});

test("finalize ignores caller attestations and fails closed on unavailable or mismatched trusted readback", async () => {
  const unavailable = harness({ externalReadbackVerifier: null });
  const unavailableRelease = await prepareFinalizableMerge(unavailable);
  await assert.rejects(unavailable.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: unavailableRelease.issued.ticket.ticket_id,
    host_session_fingerprint: unavailableRelease.issued.ticket.host_session_fingerprint,
  }), /trusted_readback_unavailable/);
  await assert.rejects(unavailable.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: unavailableRelease.issued.ticket.ticket_id,
    host_session_fingerprint: unavailableRelease.issued.ticket.host_session_fingerprint,
    live_verification: { trusted: true },
  }), /unknown_field:live_verification/);

  const cases = [
    {
      name: "untrusted",
      expected: /trusted_readback_invalid/,
      mutate: (readback) => ({ ...readback, trusted: false }),
    },
    {
      name: "stale",
      expected: /trusted_readback_stale/,
      mutate: (readback) => ({ ...readback, verified_at: "2026-07-29T09:00:00.000Z" }),
    },
    {
      name: "wrong target commit",
      expected: /trusted_readback_github_mismatch/,
      mutate: (readback) => redigestTrustedReadback({
        ...readback,
        github: { ...readback.github, target_commit: G("5") },
      }),
    },
    {
      name: "wrong merge commit",
      expected: /trusted_readback_github_mismatch/,
      mutate: (readback) => redigestTrustedReadback({
        ...readback,
        github: { ...readback.github, merge_commit: G("5") },
      }),
    },
    {
      name: "wrong merge head",
      expected: /trusted_readback_github_mismatch/,
      mutate: (readback) => redigestTrustedReadback({
        ...readback,
        github: { ...readback.github, head_commit: G("5") },
      }),
    },
    {
      name: "wrong merge base",
      expected: /trusted_readback_github_mismatch/,
      mutate: (readback) => redigestTrustedReadback({
        ...readback,
        github: { ...readback.github, expected_base_commit: G("5") },
      }),
    },
    {
      name: "merge-only readback claims Render service",
      expected: /trusted_readback_verification_scope_invalid/,
      mutate: (readback) => {
        const unsigned = {
          service_id: "srv-core",
          environment: "production",
          origin: "https://srv-core.onrender.com",
          live_commit: G("4"),
        };
        return {
          ...readback,
          services: [{ ...unsigned, readback_digest: hostNativeDigest(unsigned) }],
        };
      },
    },
    {
      name: "wrong verification scope",
      expected: /trusted_readback_github_mismatch/,
      mutate: (readback) => ({ ...readback, verification_scope: "full_release" }),
    },
    {
      name: "forged digest",
      expected: /trusted_readback_github_digest_mismatch/,
      mutate: (readback) => ({
        ...readback,
        github: { ...readback.github, readback_digest: H("a") },
      }),
    },
    {
      name: "non-success required check",
      expected: /trusted_readback_checks_not_ready/,
      mutate: (readback) => redigestTrustedReadback({
        ...readback,
        github: {
          ...readback.github,
          observed_checks: readback.github.observed_checks.map((check) => ({
            ...check,
            conclusion: "neutral",
          })),
        },
      }),
    },
  ];
  for (const scenario of cases) {
    let subject;
    subject = harness({
      externalReadbackVerifier: async ({ ticket, target_commit, verification_scope }) => scenario.mutate(
        trustedExternalReadback(
          ticket,
          target_commit,
          new Date(subject.now()).toISOString(),
          verification_scope,
        ),
      ),
    });
    const release = await prepareFinalizableMerge(subject);
    await assert.rejects(subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: release.issued.ticket.ticket_id,
      host_session_fingerprint: release.issued.ticket.host_session_fingerprint,
    }), scenario.expected, scenario.name);
  }
});

test("file governance store survives restart and preserves one-shot state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "host-native-governance-"));
  const signingSecret = "host-native-persistent-store-secret-at-least-32-bytes";
  let sequence = 0;
  const base = harness();
  const makeGovernance = () => withTestIdempotency(createHostNativeGovernance({
    store: createFileHostNativeGovernanceStore({ root }),
    signingSecret,
    closureAttestationSigningSecret: CLOSURE_ATTESTATION_SECRET,
    now: () => base.now(),
    idFactory: () => `persistent-${++sequence}`,
  }));
  try {
    const first = makeGovernance();
    const delegation = await first.issueDelegation(base.delegationInput);
    const issued = await issueCommitTicket(first, delegation.delegation_id);

    const afterRestart = makeGovernance();
    const restored = await afterRestart.readDelegation({
      tenant_id: "codexai",
      delegation_id: delegation.delegation_id,
    });
    assert.equal(restored.effective_state, "active");
    const reserved = await afterRestart.reserveActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    });
    assert.equal(reserved.state, "reserved");

    const secondRestart = makeGovernance();
    await assert.rejects(secondRestart.reserveActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    }), /replayed/);
    await assert.rejects(
      secondRestart.issueDelegation({ ...base.delegationInput, work_id: "work-replayed" }),
      /owner_confirmation_replayed/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("file store recovers a reserved release without re-execution and persists receipt/idempotency", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "host-native-release-recovery-"));
  const signingSecret = "host-native-release-recovery-secret-at-least-32-bytes";
  let sequence = 0;
  let clock = Date.parse("2026-07-29T10:00:00.000Z");
  const makeGovernance = () => withTestIdempotency(createHostNativeGovernance({
    store: createFileHostNativeGovernanceStore({ root }),
    signingSecret,
    closureAttestationSigningSecret: CLOSURE_ATTESTATION_SECRET,
    now: () => clock,
    idFactory: () => `recovery-${++sequence}`,
    externalReadbackVerifier: async ({ ticket, target_commit, verification_scope }) =>
      trustedExternalReadback(
        ticket,
        target_commit,
        new Date(clock).toISOString(),
        verification_scope,
      ),
    releaseJoinVerdictResolver: async (request) =>
      trustedJoinResolution(request, clock),
  }));
  try {
    const base = harness();
    const first = makeGovernance();
    const delegation = await first.issueDelegation({
      ...base.delegationInput,
      idempotency_key: "recovery-delegation",
    });
    const pending = buildHostReleaseManifestV2(mergeReleaseManifestInput());
    const join = await first.issueCoreJoinVerdict(coreJoinInput(pending, {
      idempotency_key: "recovery-core-join",
    }));
    const duplicateJoin = await makeGovernance().issueCoreJoinVerdict(coreJoinInput(pending, {
      idempotency_key: "recovery-core-join-alternate-key",
    }));
    assert.equal(duplicateJoin.verdict.verdict_id, join.verdict.verdict_id);
    const manifest = manifestWithCoreJoin(pending, join.verdict.verdict_id);
    const actionInput = {
      tenant_id: "codexai",
      delegation_id: delegation.delegation_id,
      work_id: "work-1",
      intent_anchor_digest: H("1"),
      repository: "owner/repo",
      host_kind: "codex_native",
      host_session_fingerprint: "recovery-release-session",
      action: githubMergeAction(),
      evidence_digest: H("6"),
      release_manifest: manifest,
      idempotency_key: "recovery-action",
    };
    const issued = await first.issueActionTicket(actionInput);
    const reserveInput = {
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
      idempotency_key: "recovery-reserve",
    };
    const reserved = await first.reserveActionTicket(reserveInput);

    const afterCrash = makeGovernance();
    const replayedIssue = await afterCrash.issueActionTicket(actionInput);
    assert.equal(replayedIssue.ticket.ticket_id, issued.ticket.ticket_id);
    const replayedReserve = await afterCrash.reserveActionTicket(reserveInput);
    assert.equal(replayedReserve.reservation_id, reserved.reservation_id);
    const reconciled = await afterCrash.reconcileActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      reservation_id: reserved.reservation_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
      observed_outcome: "success",
      observed_commit: G("4"),
      readback_digest: H("c"),
      idempotency_key: "recovery-reconcile",
    });
    assert.equal(reconciled.state, "reconciled");
    const receipt = await afterCrash.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    });

    const afterReceiptRestart = makeGovernance();
    const restoredReceipt = await afterReceiptRestart.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    });
    assert.deepEqual(restoredReceipt, receipt);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("file governance store enforces CAS reservation budgets across concurrent instances", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "host-native-governance-cas-"));
  const signingSecret = "host-native-persistent-cas-secret-at-least-32-bytes";
  let sequence = 0;
  const base = harness();
  const makeGovernance = () => withTestIdempotency(createHostNativeGovernance({
    store: createFileHostNativeGovernanceStore({ root }),
    signingSecret,
    closureAttestationSigningSecret: CLOSURE_ATTESTATION_SECRET,
    now: () => base.now(),
    idFactory: () => `cas-${++sequence}`,
  }));
  try {
    const issuer = makeGovernance();
    const delegation = await issuer.issueDelegation({
      ...base.delegationInput,
      budget: { ...base.delegationInput.budget, max_commits: 1 },
    });
    const first = makeGovernance();
    const second = makeGovernance();
    const issued = await Promise.all([
      issueCommitTicket(first, delegation.delegation_id, {
        host_session_fingerprint: "cas-session-a",
        idempotency_key: "cas-issue-a",
      }),
      issueCommitTicket(second, delegation.delegation_id, {
        host_session_fingerprint: "cas-session-b",
        idempotency_key: "cas-issue-b",
      }),
    ]);
    const results = await Promise.allSettled([
      first.reserveActionTicket({
        tenant_id: "codexai",
        ticket_id: issued[0].ticket.ticket_id,
        host_session_fingerprint: issued[0].ticket.host_session_fingerprint,
        idempotency_key: "cas-reserve-a",
      }),
      second.reserveActionTicket({
        tenant_id: "codexai",
        ticket_id: issued[1].ticket.ticket_id,
        host_session_fingerprint: issued[1].ticket.host_session_fingerprint,
        idempotency_key: "cas-reserve-b",
      }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const stored = await issuer.readDelegation({
      tenant_id: "codexai",
      delegation_id: delegation.delegation_id,
    });
    assert.equal(stored.usage.commits, 1);
    assert.equal(stored.usage.total_actions, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("revocation and expiry invalidate outstanding authority without changing host policy", async () => {
  const subject = harness();
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const issued = await issueCommitTicket(subject.governance, delegation.delegation_id);
  const revoked = await subject.governance.revokeDelegation({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "owner-consent-nonce-revoke-0002",
      confirmation_reference: "owner revoked delegation",
    },
  });
  assert.equal(revoked.state, "revoked");
  await assert.rejects(subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  }), /delegation_not_active/);

  const expiring = harness();
  const shortDelegation = await expiring.governance.issueDelegation({
    ...expiring.delegationInput,
    expires_at: new Date(expiring.now() + 60_000).toISOString(),
  });
  expiring.advance(60_001);
  await assert.rejects(
    issueCommitTicket(expiring.governance, shortDelegation.delegation_id),
    /delegation_not_active/,
  );
});

test("brief ticket expires before reservation and cannot be revived", async () => {
  const subject = harness({ ticketTtlMs: 2 * 60 * 1_000 });
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const issued = await issueCommitTicket(subject.governance, delegation.delegation_id);
  subject.advance(2 * 60 * 1_000 + 1);
  await assert.rejects(subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  }), /action_ticket_expired/);
});

test("expired unreserved release ticket leaves budget and Core join available for same-session recovery", async () => {
  const subject = harness();
  const delegation = await subject.governance.issueDelegation({
    ...subject.delegationInput,
    budget: {
      ...subject.delegationInput.budget,
      max_pushes: 1,
      max_deploys: 1,
      max_total_actions: 1,
    },
  });
  const pending = buildHostReleaseManifestV2(mergeReleaseManifestInput());
  const join = await subject.governance.issueCoreJoinVerdict(coreJoinInput(pending));
  const manifest = manifestWithCoreJoin(pending, join.verdict.verdict_id);
  const issue = (session) => subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: session,
    action: githubMergeAction(),
    evidence_digest: H("6"),
    release_manifest: manifest,
  });
  const expired = await issue("expired-release-session");
  subject.advance(10 * 60 * 1_000 + 1);
  await assert.rejects(subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: expired.ticket.ticket_id,
    host_session_fingerprint: expired.ticket.host_session_fingerprint,
  }), /action_ticket_expired/);
  const stillActive = await subject.governance.readCoreJoinVerdict({
    tenant_id: "codexai",
    verdict_id: join.verdict.verdict_id,
  });
  assert.equal(stillActive.state, "active");
  assert.equal(stillActive.uses, 0);
  const unusedDelegation = await subject.governance.readDelegation({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
  });
  assert.equal(unusedDelegation.usage.total_actions, 0);

  await assert.rejects(issue("different-release-session"),
    /core_join_ticket_replacement_binding_mismatch/);

  const replacement = await issue("expired-release-session");
  const superseded = await subject.governance.readActionTicket({
    tenant_id: "codexai",
    ticket_id: expired.ticket.ticket_id,
  });
  assert.equal(superseded.state, "superseded");
  assert.equal(superseded.superseded_by_ticket_id, replacement.ticket.ticket_id);
  await assert.rejects(subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: expired.ticket.ticket_id,
    host_session_fingerprint: expired.ticket.host_session_fingerprint,
  }), /replayed/);
  const reserved = await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: replacement.ticket.ticket_id,
    host_session_fingerprint: replacement.ticket.host_session_fingerprint,
  });
  assert.equal(reserved.state, "reserved");
  const consumed = await subject.governance.readCoreJoinVerdict({
    tenant_id: "codexai",
    verdict_id: join.verdict.verdict_id,
  });
  assert.equal(consumed.state, "consumed");
  assert.equal(consumed.consumed_by_ticket_id, replacement.ticket.ticket_id);
  const chargedDelegation = await subject.governance.readDelegation({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
  });
  assert.equal(chargedDelegation.usage.total_actions, 1);
});
