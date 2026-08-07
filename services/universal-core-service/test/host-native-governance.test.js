import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HOST_NATIVE_ABSOLUTE_DENY_ACTIONS,
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  buildHostNativeWorkPlan,
  buildHostReleaseManifestV2,
  createFileHostNativeGovernanceStore,
  createHostNativeGovernance,
  createInMemoryHostNativeGovernanceStore,
  deriveHostReleaseIntentV1,
  hostNativeDigest,
  hostNativeGithubDiffDigest,
  validateHostReleaseManifestV2,
} from "../src/hostNativeGovernance.js";

const H = (value) => String(value).repeat(64);
const G = (value) => String(value).repeat(40);
const OWNER = `osf_${H("a")}`;
const CLOSURE_ATTESTATION_SECRET =
  "host-native-governance-closure-attestation-secret-0123456789";
const IDEMPOTENT_METHODS = new Set([
  "issueCoreJoinVerdict",
  "issueDelegation",
  "revokeDelegation",
  "issueActionTicket",
  "reserveActionTicket",
  "completeActionTicket",
  "reconcileActionTicket",
  "issueClosureHandoff",
  "redeemClosureHandoff",
]);
let testIdempotencySequence = 0;

function withTestIdempotency(governance) {
  return new Proxy(governance, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (!IDEMPOTENT_METHODS.has(property) || typeof value !== "function") return value;
      return (input = {}) => value.call(target, {
        ...input,
        idempotency_key: input.idempotency_key ||
          `test-${String(property).toLowerCase()}-${++testIdempotencySequence}`,
      });
    },
  });
}

function trustedExternalReadback(ticket, targetCommit, verifiedAt) {
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
  const githubUnsigned = {
    api_origin: "https://api.github.com",
    repository: ticket.repository,
    action_kind: action.kind,
    head_branch: action.head_branch || null,
    base_branch: action.base_branch || null,
    pull_request: mergeAction ? action.pull_request : null,
    merged: mergeAction ? true : null,
    head_commit: action.head_commit || binding.verification.checks_commit,
    expected_base_commit: action.expected_base_commit || binding.base_commit,
    merge_commit: mergeAction ? targetCommit : null,
    target_commit: targetCommit,
    branch: action.branch || action.base_branch || null,
    branch_commit: mergeAction ? null : targetCommit,
    checks_commit: binding.verification.checks_commit,
    checks_passed: true,
    required_checks: requiredChecks,
    observed_checks: observedChecks,
    rollback_commit: binding.rollback.target_commit,
    rollback_commit_available: true,
  };
  const services = binding.services.map((expected) => {
    const unsigned = {
      service_id: expected.service_id,
      environment: expected.environment,
      origin: expected.origin,
      health_path: "/healthz",
      deployment_id: `dep-${expected.service_id}`,
      live_commit: targetCommit,
      version: "test-1.0.0",
      health_status: "healthy",
      health_contract_digest: expected.health_contract_digest,
      rollback_commit: binding.rollback.target_commit,
      rollback_status: "previous_live_attested",
    };
    return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
  });
  return {
    schema_version: "host_native_external_readback_v1",
    trusted: true,
    verifier_id: "core_server_external_readback_v1",
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

function trustedSupersededExternalReadback(
  originalTicket,
  originalCommit,
  supersedingTicket,
  supersedingCommit,
  verifiedAt,
) {
  const strictGithub = (ticket, targetCommit) => {
    const readback = trustedExternalReadback(ticket, targetCommit, verifiedAt);
    const unsigned = {
      ...readback.github,
      head_tree_sha: ticket.release_manifest_binding.tree_sha,
      merge_parents: [
        ticket.action.expected_base_commit,
        ticket.action.head_commit,
      ],
    };
    delete unsigned.readback_digest;
    return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
  };
  return {
    schema_version: "host_native_superseded_external_readback_v1",
    trusted: true,
    verifier_id: "core_server_superseded_external_readback_v1",
    verified_at: verifiedAt,
    original_github: strictGithub(originalTicket, originalCommit),
    superseding_github: strictGithub(supersedingTicket, supersedingCommit),
    services: trustedExternalReadback(
      supersedingTicket,
      supersedingCommit,
      verifiedAt,
    ).services,
    external_side_effect: false,
    provider_execution: false,
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
    provider_execution: false,
  };
}

function harness({
  budget = {},
  allowedActions,
  clockStart = "2026-07-29T10:00:00.000Z",
  ticketTtlMs,
  reservationLeaseMs,
  closureHandoffTtlMs,
  store = createInMemoryHostNativeGovernanceStore(),
  signingSecret = "host-native-governance-test-signing-secret-at-least-32-bytes",
  externalReadbackVerifier,
  releaseJoinVerdictResolver,
  renderServiceOriginResolver,
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
      ? (async ({
        ticket,
        target_commit,
        superseding_ticket,
        superseding_target_commit,
      }) => superseding_ticket
        ? trustedSupersededExternalReadback(
          ticket,
          target_commit,
          superseding_ticket,
          superseding_target_commit,
          new Date(clock).toISOString(),
        )
        : trustedExternalReadback(
          ticket,
          target_commit,
          new Date(clock).toISOString(),
        ))
      : externalReadbackVerifier,
    releaseJoinVerdictResolver: releaseJoinVerdictResolver === undefined
      ? (async (request) => trustedJoinResolution(request, clock))
      : releaseJoinVerdictResolver,
    renderServiceOriginResolver: renderServiceOriginResolver || null,
    ...(ticketTtlMs === undefined ? {} : { ticketTtlMs }),
    ...(reservationLeaseMs === undefined ? {} : { reservationLeaseMs }),
    ...(closureHandoffTtlMs === undefined ? {} : { closureHandoffTtlMs }),
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

async function prepareFinalizableMerge(subject, ticketOverrides = {}) {
  const delegation = await subject.governance.issueDelegation(subject.delegationInput);
  const issued = await issueMergeTicket(
    subject.governance,
    delegation.delegation_id,
    ticketOverrides,
  );
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

async function prepareSupersedingMerge(subject, overrides = {}) {
  const intent = H("2");
  const workId = "work-2";
  const delegation = await subject.governance.issueDelegation({
    ...subject.delegationInput,
    work_id: workId,
    intent_anchor_digest: intent,
    owner_confirmation: {
      ...subject.delegationInput.owner_confirmation,
      consent_nonce: "owner-consent-nonce-superseding-release",
    },
    idempotency_key: "superseding-release-delegation",
  });
  const pending = buildHostReleaseManifestV2(mergeReleaseManifestInput({
    manifest_id: "manifest-superseding-release",
    work_id: workId,
    intent_anchor_digest: intent,
    base_commit: overrides.base_commit || G("4"),
    head_commit: G("7"),
    tree_sha: G("8"),
    verification: {
      ...releaseManifestInput().verification,
      checks_commit: G("7"),
    },
    delivery: {
      method: "github_protected_push_auto_deploy",
      services: [{
        service_id: "srv-core",
        environment: "production",
        expected_previous_commit: overrides.expected_previous_commit || G("4"),
        target_commit: null,
        target_resolution: "post_merge_readback",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      }],
    },
    rollback: {
      mode: "forward_revert",
      target_commit: overrides.rollback_commit || overrides.base_commit || G("4"),
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      ready: true,
    },
  }));
  const join = await subject.governance.issueCoreJoinVerdict(
    coreJoinInput(pending, {
      local_plan_id: "local-plan-2",
      local_plan_digest: H("8"),
    }),
  );
  const manifest = manifestWithCoreJoin(pending, join.verdict.verdict_id);
  const issued = await subject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
    work_id: workId,
    intent_anchor_digest: intent,
    repository: "owner/repo",
    host_kind: "chatgpt_native",
    host_session_fingerprint: "7".repeat(32),
    action: githubMergeAction({
      pull_request: 43,
      head_commit: G("7"),
      expected_base_commit: overrides.expected_base_commit || G("4"),
      checks_commit: G("7"),
    }),
    evidence_digest: H("6"),
    release_manifest: manifest,
    idempotency_key: `superseding-release-ticket-${
      overrides.idempotency_suffix || "valid"
    }`,
  });
  const reserved = await subject.governance.reserveActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    idempotency_key: `superseding-release-reserve-${
      overrides.idempotency_suffix || "valid"
    }`,
  });
  if (overrides.reconciled) {
    await subject.governance.reconcileActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      reservation_id: reserved.reservation_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
      observed_outcome: "success",
      observed_commit: G("9"),
      readback_digest: H("8"),
      idempotency_key: `superseding-release-reconcile-${
        overrides.idempotency_suffix || "valid"
      }`,
    });
  } else {
    await subject.governance.completeActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      reservation_id: reserved.reservation_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
      outcome: "success",
      result_digest: H("7"),
      result_commit: G("9"),
      readback_digest: H("8"),
      idempotency_key: `superseding-release-complete-${
        overrides.idempotency_suffix || "valid"
      }`,
    });
  }
  return { delegation, issued, reserved };
}

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

test("protected push, Render deploy/rollback, and linked observation each require trusted finalization", async () => {
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
      readback_digest: H("b"),
    });
    const receipt = await subject.governance.authorizeFinalize({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
      host_session_fingerprint: issued.ticket.host_session_fingerprint,
    });
    return { delegation, manifest, issued, receipt };
  }

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
    service_id: "srv-core",
    environment: "production",
    target_commit: G("4"),
    expected_live_commit: G("1"),
    trigger: "manual",
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    rollback_commit: G("1"),
    provider_execution: false,
  };
  const deployed = await finalizeExact(deploySubject, deployAction, deployManifest);
  assert.equal(deployed.receipt.live_services[0].live_commit, G("4"));

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

  const observationSubject = harness();
  const parent = await finalizeExact(
    observationSubject,
    protectedPushAction(),
    releaseManifestInput(),
  );
  const observation = await observationSubject.governance.issueActionTicket({
    tenant_id: "codexai",
    delegation_id: parent.delegation.delegation_id,
    work_id: "work-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "linked-render-observation",
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
    },
    evidence_digest: H("6"),
    release_manifest: parent.manifest,
  });
  assert.equal(
    observation.ticket.core_join_verdict_id,
    parent.issued.ticket.core_join_verdict_id,
  );
  assert.equal(
    observation.ticket.release_join_resolution_digest,
    parent.issued.ticket.release_join_resolution_digest,
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
  assert.equal(finalize.live_services[0].live_commit, G("4"));
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
    externalReadbackVerifier: async ({ ticket, target_commit }) => {
      verifierCalls += 1;
      const readback = trustedExternalReadback(
        ticket,
        target_commit,
        verifiedAtOverride || new Date(subject.now()).toISOString(),
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
    services: readback.services.map((service) => ({
      ...service,
      live_commit: G("5"),
    })),
  });
  await assert.rejects(subject.governance.authorizeFinalize({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  }), /trusted_readback_service_mismatch/);
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
      name: "wrong live commit",
      expected: /trusted_readback_service_mismatch/,
      mutate: (readback) => redigestTrustedReadback({
        ...readback,
        services: [{ ...readback.services[0], live_commit: G("5") }],
      }),
    },
    {
      name: "wrong Render origin",
      expected: /trusted_readback_service_mismatch/,
      mutate: (readback) => redigestTrustedReadback({
        ...readback,
        services: [{
          ...readback.services[0],
          origin: "https://attacker.onrender.com",
        }],
      }),
    },
    {
      name: "wrong health contract",
      expected: /trusted_readback_service_mismatch/,
      mutate: (readback) => redigestTrustedReadback({
        ...readback,
        services: [{
          ...readback.services[0],
          health_contract_digest: H("a"),
        }],
      }),
    },
    {
      name: "rollback not ready",
      expected: /trusted_readback_service_mismatch/,
      mutate: (readback) => redigestTrustedReadback({
        ...readback,
        services: [{
          ...readback.services[0],
          rollback_status: "unavailable",
        }],
      }),
    },
    {
      name: "missing service",
      expected: /trusted_readback_service_set_mismatch/,
      mutate: (readback) => ({ ...readback, services: [] }),
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
      externalReadbackVerifier: async ({ ticket, target_commit }) => scenario.mutate(
        trustedExternalReadback(
          ticket,
          target_commit,
          new Date(subject.now()).toISOString(),
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
    externalReadbackVerifier: async ({ ticket, target_commit }) =>
      trustedExternalReadback(ticket, target_commit, new Date(clock).toISOString()),
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

test("owner-signed closure handoff preserves execution binding and redeems once across host types", async () => {
  const subject = harness();
  const executionSession = "1".repeat(32);
  const closureSession = "2".repeat(32);
  const { delegation, issued } = await prepareFinalizableMerge(subject, {
    host_kind: "codex_native",
    host_session_fingerprint: executionSession,
  });
  const ticketBefore = await subject.governance.readActionTicket({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
  });
  const delegationBefore = await subject.governance.readDelegation({
    tenant_id: "codexai",
    delegation_id: delegation.delegation_id,
  });
  const coreJoinBefore = await subject.governance.readCoreJoinVerdict({
    tenant_id: "codexai",
    verdict_id: issued.ticket.core_join_verdict_id,
  });
  const issueInput = {
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    work_id: "work-1",
    plan_id: "local-plan-1",
    result_commit: G("4"),
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: closureSession,
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "closure-handoff-owner-consent-1",
      confirmation_reference: "owner approved exact successor closure",
    },
    idempotency_key: "closure-handoff-issue-exact-1",
  };
  const handoffRecord = await subject.governance.issueClosureHandoff(issueInput);
  assert.equal(handoffRecord.state, "issued");
  assert.equal(handoffRecord.uses, 0);
  assert.equal(handoffRecord.handoff.execution_host_kind, "codex_native");
  assert.equal(
    handoffRecord.handoff.execution_host_session_fingerprint,
    executionSession,
  );
  assert.equal(handoffRecord.handoff.closure_host_kind, "chatgpt_native");
  assert.equal(handoffRecord.handoff.closure_session_fingerprint, closureSession);
  assert.equal(handoffRecord.handoff.local_plan_id, "local-plan-1");
  assert.equal(handoffRecord.handoff.external_action_replay_allowed, false);
  assert.equal(handoffRecord.handoff.max_uses, 1);
  assert.deepEqual(
    await subject.governance.issueClosureHandoff(issueInput),
    handoffRecord,
  );

  const redeemInput = {
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    handoff_id: handoffRecord.handoff.handoff_id,
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: closureSession,
    idempotency_key: "closure-handoff-redeem-exact-1",
  };
  const receipt = await subject.governance.redeemClosureHandoff(redeemInput);
  assert.equal(receipt.schema_version, "host_native_finalize_authorization_v2");
  assert.equal(receipt.execution_host_kind, "codex_native");
  assert.equal(receipt.execution_host_session_fingerprint, executionSession);
  assert.equal(receipt.closure_host_kind, "chatgpt_native");
  assert.equal(receipt.closure_session_fingerprint, closureSession);
  assert.equal(receipt.closure_handoff_id, handoffRecord.handoff.handoff_id);
  assert.equal(receipt.local_plan_id, "local-plan-1");
  assert.equal(receipt.target_commit, G("4"));
  assert.equal(receipt.result_commit_verified, true);
  assert.equal(receipt.external_action_replay_allowed, false);
  assert.deepEqual(
    await subject.governance.redeemClosureHandoff(redeemInput),
    receipt,
  );
  await assert.rejects(subject.governance.redeemClosureHandoff({
    ...redeemInput,
    idempotency_key: "closure-handoff-redeem-second-key",
  }), /closure_handoff_replayed/);
  const consumed = await subject.governance.readClosureHandoff({
    tenant_id: "codexai",
    handoff_id: handoffRecord.handoff.handoff_id,
  });
  assert.equal(consumed.state, "consumed");
  assert.equal(consumed.uses, 1);
  assert.deepEqual(
    await subject.governance.readActionTicket({
      tenant_id: "codexai",
      ticket_id: issued.ticket.ticket_id,
    }),
    ticketBefore,
  );
  assert.deepEqual(
    await subject.governance.readDelegation({
      tenant_id: "codexai",
      delegation_id: delegation.delegation_id,
    }),
    delegationBefore,
  );
  assert.deepEqual(
    await subject.governance.readCoreJoinVerdict({
      tenant_id: "codexai",
      verdict_id: issued.ticket.core_join_verdict_id,
    }),
    coreJoinBefore,
  );
});

test("closure handoff finalizes a directly superseded release from historical and current trusted readback", async () => {
  const subject = harness();
  const original = await prepareFinalizableMerge(subject, {
    host_kind: "codex_native",
    host_session_fingerprint: "a".repeat(32),
  });
  const superseding = await prepareSupersedingMerge(subject);
  const originalBefore = await subject.governance.readActionTicket({
    tenant_id: "codexai",
    ticket_id: original.issued.ticket.ticket_id,
  });
  const supersedingBefore = await subject.governance.readActionTicket({
    tenant_id: "codexai",
    ticket_id: superseding.issued.ticket.ticket_id,
  });
  const handoff = await subject.governance.issueClosureHandoff({
    tenant_id: "codexai",
    ticket_id: original.issued.ticket.ticket_id,
    superseding_action_ticket_id: superseding.issued.ticket.ticket_id,
    work_id: "work-1",
    plan_id: "local-plan-1",
    result_commit: G("4"),
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "b".repeat(32),
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "closure-handoff-owner-consent-superseded",
      confirmation_reference: "owner approved exact superseded closure",
    },
    idempotency_key: "closure-handoff-superseded-issue",
  });
  assert.equal(
    handoff.handoff.superseding_action_ticket_id,
    superseding.issued.ticket.ticket_id,
  );
  assert.equal(handoff.handoff.superseding_result_commit, G("9"));
  const receipt = await subject.governance.redeemClosureHandoff({
    tenant_id: "codexai",
    ticket_id: original.issued.ticket.ticket_id,
    handoff_id: handoff.handoff.handoff_id,
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "b".repeat(32),
    idempotency_key: "closure-handoff-superseded-redeem",
  });
  assert.equal(receipt.schema_version, "host_native_finalize_authorization_v3");
  assert.equal(receipt.decision, "ALLOW_FINALIZE_SUPERSEDED_RELEASE");
  assert.equal(receipt.release_state, "superseded");
  assert.equal(receipt.target_commit, G("4"));
  assert.equal(receipt.current_live_commit, G("9"));
  assert.equal(receipt.github_readback.merge_commit, G("4"));
  assert.deepEqual(receipt.github_readback.merge_parents, [G("1"), G("3")]);
  assert.equal(receipt.superseding_github_readback.merge_commit, G("9"));
  assert.deepEqual(
    receipt.superseding_github_readback.merge_parents,
    [G("4"), G("7")],
  );
  assert.equal(receipt.live_services[0].live_commit, G("9"));
  assert.equal(receipt.live_services[0].rollback_commit, G("4"));
  assert.equal(
    receipt.superseding_release_join_resolution.previous_live_attestations[0]
      .live_commit,
    G("4"),
  );
  assert.deepEqual(
    await subject.governance.readActionTicket({
      tenant_id: "codexai",
      ticket_id: original.issued.ticket.ticket_id,
    }),
    originalBefore,
  );
  assert.deepEqual(
    await subject.governance.readActionTicket({
      tenant_id: "codexai",
      ticket_id: superseding.issued.ticket.ticket_id,
    }),
    supersedingBefore,
  );
});

test("superseded closure handoff preserves a reconciled successor without a host result digest", async () => {
  const subject = harness();
  const original = await prepareFinalizableMerge(subject);
  const superseding = await prepareSupersedingMerge(subject, {
    reconciled: true,
    idempotency_suffix: "reconciled",
  });
  const handoff = await subject.governance.issueClosureHandoff({
    tenant_id: "codexai",
    ticket_id: original.issued.ticket.ticket_id,
    superseding_action_ticket_id: superseding.issued.ticket.ticket_id,
    work_id: "work-1",
    plan_id: "local-plan-1",
    result_commit: G("4"),
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "e".repeat(32),
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "closure-handoff-owner-consent-reconciled-successor",
      confirmation_reference: "owner approved reconciled successor closure",
    },
    idempotency_key: "closure-handoff-reconciled-successor-issue",
  });
  const receipt = await subject.governance.redeemClosureHandoff({
    tenant_id: "codexai",
    ticket_id: original.issued.ticket.ticket_id,
    handoff_id: handoff.handoff.handoff_id,
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "e".repeat(32),
    idempotency_key: "closure-handoff-reconciled-successor-redeem",
  });
  assert.equal(receipt.superseding_outcome_source, "reconciled_readback");
  assert.equal(receipt.superseding_host_result_digest, undefined);
  const unsigned = { ...receipt };
  delete unsigned.authorization_digest;
  delete unsigned.signature;
  assert.equal(receipt.authorization_digest, hostNativeDigest(unsigned));
});

test("superseded closure handoff rejects a non-direct successor and a production advance", async () => {
  const direct = harness();
  const original = await prepareFinalizableMerge(direct);
  const nonDirect = await prepareSupersedingMerge(direct, {
    base_commit: G("5"),
    expected_base_commit: G("5"),
    expected_previous_commit: G("5"),
    rollback_commit: G("5"),
    idempotency_suffix: "non-direct",
  });
  const baseIssue = {
    tenant_id: "codexai",
    ticket_id: original.issued.ticket.ticket_id,
    superseding_action_ticket_id: nonDirect.issued.ticket.ticket_id,
    work_id: "work-1",
    plan_id: "local-plan-1",
    result_commit: G("4"),
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "c".repeat(32),
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "closure-handoff-owner-consent-non-direct",
      confirmation_reference: "owner requested non-direct closure",
    },
    idempotency_key: "closure-handoff-non-direct-issue",
  };
  await assert.rejects(
    direct.governance.issueClosureHandoff(baseIssue),
    /closure_handoff_superseding_release_mismatch/,
  );

  let currentClock = "2026-07-29T10:00:00.000Z";
  const advanced = harness({
    externalReadbackVerifier: async ({
      ticket,
      target_commit,
      superseding_ticket,
      superseding_target_commit,
    }) => {
      const readback = trustedSupersededExternalReadback(
        ticket,
        target_commit,
        superseding_ticket,
        superseding_target_commit,
        currentClock,
      );
      const service = readback.services[0];
      const unsigned = { ...service, live_commit: G("a") };
      delete unsigned.readback_digest;
      readback.services[0] = {
        ...unsigned,
        readback_digest: hostNativeDigest(unsigned),
      };
      return readback;
    },
  });
  const advancedOriginal = await prepareFinalizableMerge(advanced);
  const advancedSuccessor = await prepareSupersedingMerge(advanced);
  const handoff = await advanced.governance.issueClosureHandoff({
    ...baseIssue,
    ticket_id: advancedOriginal.issued.ticket.ticket_id,
    superseding_action_ticket_id: advancedSuccessor.issued.ticket.ticket_id,
    closure_session_fingerprint: "d".repeat(32),
    owner_confirmation: {
      ...baseIssue.owner_confirmation,
      consent_nonce: "closure-handoff-owner-consent-production-advanced",
    },
    idempotency_key: "closure-handoff-production-advanced-issue",
  });
  await assert.rejects(advanced.governance.redeemClosureHandoff({
    tenant_id: "codexai",
    ticket_id: advancedOriginal.issued.ticket.ticket_id,
    handoff_id: handoff.handoff.handoff_id,
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "d".repeat(32),
    idempotency_key: "closure-handoff-production-advanced-redeem",
  }), /trusted_superseded_readback_service_mismatch/);
});

test("closure handoff fails closed on binding drift and concurrent redemption", async () => {
  const subject = harness();
  const executionSession = "3".repeat(32);
  const closureSession = "4".repeat(32);
  const { issued } = await prepareFinalizableMerge(subject, {
    host_kind: "codex_native",
    host_session_fingerprint: executionSession,
  });
  const baseIssue = {
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    work_id: "work-1",
    plan_id: "local-plan-1",
    result_commit: G("4"),
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: closureSession,
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "closure-handoff-owner-consent-concurrent",
      confirmation_reference: "owner approved concurrent redemption test",
    },
    idempotency_key: "closure-handoff-concurrent-issue",
  };
  await assert.rejects(subject.governance.issueClosureHandoff({
    ...baseIssue,
    plan_id: "different-local-plan",
  }), /closure_handoff_plan_mismatch/);
  await assert.rejects(subject.governance.issueClosureHandoff({
    ...baseIssue,
    result_commit: G("9"),
  }), /result_commit_mismatch/);
  const handoffRecord = await subject.governance.issueClosureHandoff(baseIssue);
  await assert.rejects(subject.governance.redeemClosureHandoff({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    handoff_id: handoffRecord.handoff.handoff_id,
    closure_host_kind: "codex_native",
    closure_session_fingerprint: closureSession,
    idempotency_key: "closure-handoff-wrong-host",
  }), /closure_handoff_successor_mismatch/);
  const redemption = (key) => subject.governance.redeemClosureHandoff({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    handoff_id: handoffRecord.handoff.handoff_id,
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: closureSession,
    idempotency_key: key,
  });
  const results = await Promise.allSettled([
    redemption("closure-handoff-concurrent-a"),
    redemption("closure-handoff-concurrent-b"),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.match(
    String(results.find((result) => result.status === "rejected")?.reason?.message),
    /closure_handoff_replayed/,
  );
});

test("closure handoff rejects cross-tenant access, expiry, and persisted binding tamper before readback", async () => {
  let readbackCalls = 0;
  const externalReadbackVerifier = async ({ ticket, target_commit }) => {
    readbackCalls += 1;
    return trustedExternalReadback(
      ticket,
      target_commit,
      "2026-07-29T10:00:00.000Z",
    );
  };
  const subject = harness({ externalReadbackVerifier });
  const { issued } = await prepareFinalizableMerge(subject, {
    host_kind: "codex_native",
    host_session_fingerprint: "5".repeat(32),
  });
  const handoff = await subject.governance.issueClosureHandoff({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    work_id: "work-1",
    plan_id: "local-plan-1",
    result_commit: G("4"),
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "6".repeat(32),
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "closure-handoff-owner-consent-security",
      confirmation_reference: "owner approved security-bound handoff",
    },
    idempotency_key: "closure-handoff-security-issue",
  });
  await assert.rejects(subject.governance.readClosureHandoff({
    tenant_id: "tenant-other",
    handoff_id: handoff.handoff.handoff_id,
  }), /cross_tenant_closure_handoff_denied/);
  await assert.rejects(subject.governance.redeemClosureHandoff({
    tenant_id: "tenant-other",
    ticket_id: issued.ticket.ticket_id,
    handoff_id: handoff.handoff.handoff_id,
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "6".repeat(32),
    idempotency_key: "closure-handoff-cross-tenant",
  }), /cross_tenant_closure_handoff_denied/);
  assert.equal(readbackCalls, 0);
  subject.advance(2 * 60_000 + 1);
  await assert.rejects(subject.governance.redeemClosureHandoff({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    handoff_id: handoff.handoff.handoff_id,
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "6".repeat(32),
    idempotency_key: "closure-handoff-expired",
  }), /closure_handoff_expired/);
  assert.equal(readbackCalls, 0);

  const tamperStore = createInMemoryHostNativeGovernanceStore();
  const tamperedSubject = harness({
    store: tamperStore,
    externalReadbackVerifier,
  });
  const tamperedTicket = await prepareFinalizableMerge(tamperedSubject, {
    host_kind: "codex_native",
    host_session_fingerprint: "7".repeat(32),
  });
  const tamperedHandoff = await tamperedSubject.governance.issueClosureHandoff({
    tenant_id: "codexai",
    ticket_id: tamperedTicket.issued.ticket.ticket_id,
    work_id: "work-1",
    plan_id: "local-plan-1",
    result_commit: G("4"),
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "8".repeat(32),
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "closure-handoff-owner-consent-tamper",
      confirmation_reference: "owner approved tamper test handoff",
    },
    idempotency_key: "closure-handoff-tamper-issue",
  });
  tamperStore.mutate((state) => {
    state.closure_handoffs[
      tamperedHandoff.handoff.handoff_id
    ].handoff.result_commit = G("8");
    return null;
  });
  await assert.rejects(tamperedSubject.governance.redeemClosureHandoff({
    tenant_id: "codexai",
    ticket_id: tamperedTicket.issued.ticket.ticket_id,
    handoff_id: tamperedHandoff.handoff.handoff_id,
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "8".repeat(32),
    idempotency_key: "closure-handoff-tamper-redeem",
  }), /closure_handoff_signature_invalid/);
  assert.equal(readbackCalls, 0);
});

test("closure handoff cannot cross its TTL while server-owned readback is running", async () => {
  let subject;
  subject = harness({
    closureHandoffTtlMs: 1_000,
    externalReadbackVerifier: async ({ ticket, target_commit }) => {
      subject.advance(1_001);
      return trustedExternalReadback(
        ticket,
        target_commit,
        new Date(subject.now()).toISOString(),
      );
    },
  });
  const { issued } = await prepareFinalizableMerge(subject, {
    host_kind: "codex_native",
    host_session_fingerprint: "9".repeat(32),
  });
  const handoff = await subject.governance.issueClosureHandoff({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    work_id: "work-1",
    plan_id: "local-plan-1",
    result_commit: G("4"),
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "a".repeat(32),
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "closure-handoff-owner-consent-slow-readback",
      confirmation_reference: "owner approved slow-readback handoff test",
    },
    idempotency_key: "closure-handoff-slow-readback-issue",
  });
  await assert.rejects(subject.governance.redeemClosureHandoff({
    tenant_id: "codexai",
    ticket_id: issued.ticket.ticket_id,
    handoff_id: handoff.handoff.handoff_id,
    closure_host_kind: "chatgpt_native",
    closure_session_fingerprint: "a".repeat(32),
    idempotency_key: "closure-handoff-slow-readback-redeem",
  }), /closure_handoff_expired/);
  const stillIssued = await subject.governance.readClosureHandoff({
    tenant_id: "codexai",
    handoff_id: handoff.handoff.handoff_id,
  });
  assert.equal(stillIssued.state, "issued");
  assert.equal(stillIssued.uses, 0);
});
