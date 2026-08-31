import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  createHostNativeExternalReadbackVerifier,
  createHostNativeOwnerManualMergeReadbackVerifier,
  createHostNativeReleaseJoinVerdictResolver,
} from "../src/hostNativeExternalReadback.js";
import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  HOST_NATIVE_HEALTH_CONTRACT_VERSION,
  hostNativeDigest,
  hostNativeGithubDiffDigest,
} from "../src/hostNativeGovernance.js";

const BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const TARGET = "3".repeat(40);
const ALTERNATE = "4".repeat(40);
const TREE = "5".repeat(40);
const RELEASE_CHANGED_FILES = ["services/universal-core-service/src/app.js"];
const VERIFIED_AT = "2026-07-29T12:00:00.000Z";
const WORKFLOW_SOURCE = "name: Nyra Core Intelligence\non: [pull_request, push]\n";
const WORKFLOW_SHA256 = crypto
  .createHash("sha256")
  .update(WORKFLOW_SOURCE)
  .digest("hex");
const WORKFLOW_CANDIDATE_SOURCE =
  "name: Nyra Core Intelligence\non: [pull_request, push]\n# staged candidate\n";
const WORKFLOW_CANDIDATE_SHA256 = crypto
  .createHash("sha256")
  .update(WORKFLOW_CANDIDATE_SOURCE)
  .digest("hex");
const WORKFLOW_UNKNOWN_SOURCE =
  "name: Nyra Core Intelligence\non: [pull_request, push]\n# unknown digest\n";

function jsonResponse(body, {
  status = 200,
  headers = {},
} = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function mergeTicket({
  tenantId = "tenant-a",
  repository = "owner/repo",
  services = [{
    service_id: "service-a",
    environment: "production",
    origin: "https://service-a.onrender.com",
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  }],
} = {}) {
  const normalizedServices = services.map((service) => ({
    expected_previous_commit: service.expected_previous_commit || BASE,
    ...service,
  }));
  const previousLiveAttestations = normalizedServices.map((service) => {
    const expectedPreviousCommit = service.expected_previous_commit;
    const unsigned = {
      service_id: service.service_id,
      environment: service.environment,
      origin: service.origin,
      health_path: "/healthz",
      deployment_id: `previous-${service.service_id}`,
      live_commit: expectedPreviousCommit,
      health_status: "healthy",
      health_contract_digest: service.health_contract_digest,
    };
    return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
  });
  const sourceUnsigned = {
    schema_version: "host_native_source_attestation_v1",
    repository,
    evidence_kind: "github_pull_request_files",
    pull_request: 42,
    base_commit: BASE,
    head_commit: HEAD,
    tree_sha: TREE,
    changed_files: RELEASE_CHANGED_FILES,
    diff_digest: hostNativeGithubDiffDigest({
      repository,
      base_commit: BASE,
      head_commit: HEAD,
      tree_sha: TREE,
      changed_files: RELEASE_CHANGED_FILES,
    }),
  };
  const sourceAttestation = {
    ...sourceUnsigned,
    attestation_digest: hostNativeDigest(sourceUnsigned),
  };
  const releaseJoinResolution = {
    schema_version: "host_native_release_join_resolution_v1",
    trusted: true,
    authority: "universal_core",
    allowed: true,
    verdict_id: "hnj_test",
    tenant_id: tenantId,
    work_id: "work-a",
    intent_anchor_digest: "a".repeat(64),
    repository,
    checks_commit: HEAD,
    evidence_digest: "b".repeat(64),
    issued_at: VERIFIED_AT,
    resolved_at: VERIFIED_AT,
    source_attestation: sourceAttestation,
    previous_live_attestations: previousLiveAttestations,
    pre_action_readback_digest: hostNativeDigest({
      source_attestation: sourceAttestation,
      previous_live_attestations: previousLiveAttestations,
    }),
    provider_execution: false,
  };
  return {
    tenant_id: tenantId,
    work_id: "work-a",
    intent_anchor_digest: "a".repeat(64),
    repository,
    evidence_digest: "b".repeat(64),
    core_join_verdict_id: "hnj_test",
    provider_execution: false,
    action: {
      kind: "github.merge",
      pull_request: 42,
      head_branch: "agent/release",
      base_branch: "main",
      head_commit: HEAD,
      expected_base_commit: BASE,
      checks_commit: HEAD,
    },
    release_manifest_binding: {
      base_commit: BASE,
      verification: {
        required_checks: ["deployment-parity", "unit-tests"],
        checks_commit: HEAD,
      },
      services: normalizedServices,
      rollback: {
        target_commit: BASE,
      },
    },
    release_join_resolution: releaseJoinResolution,
    release_join_resolution_digest: hostNativeDigest(releaseJoinResolution),
  };
}

function refreshReleaseJoinSourceAttestation(ticket) {
  const resolution = ticket.release_join_resolution;
  const source = resolution.source_attestation;
  try {
    source.diff_digest = hostNativeGithubDiffDigest({
      repository: source.repository,
      base_commit: source.base_commit,
      head_commit: source.head_commit,
      tree_sha: source.tree_sha,
      changed_files: source.changed_files,
    });
  } catch {
    // Preserve the malformed signed shape so the verifier itself must reject it.
  }
  delete source.attestation_digest;
  source.attestation_digest = hostNativeDigest(source);
  resolution.pre_action_readback_digest = hostNativeDigest({
    source_attestation: source,
    previous_live_attestations: resolution.previous_live_attestations,
  });
  ticket.release_join_resolution_digest = hostNativeDigest(resolution);
  return ticket;
}

function branchTicket(overrides = {}) {
  const ticket = mergeTicket(overrides);
  return {
    ...ticket,
    action: {
      kind: "git.push.protected",
      branch: "release/v1",
      source_commit: TARGET,
      expected_remote_commit: BASE,
      checks_commit: HEAD,
    },
  };
}

function successfulChecks(commit = HEAD) {
  return {
    check_runs: [
      {
        name: "unit-tests",
        head_sha: commit,
        status: "completed",
        conclusion: "success",
      },
      {
        name: "deployment-parity",
        head_sha: commit,
        status: "completed",
        conclusion: "success",
      },
    ],
  };
}

function pullRequest(repository = "owner/repo", overrides = {}) {
  return {
    merged: true,
    merge_commit_sha: TARGET,
    head: {
      sha: HEAD,
      ref: "agent/release",
      repo: { full_name: repository },
    },
    base: {
      sha: BASE,
      ref: "main",
      repo: { full_name: repository },
    },
    ...overrides,
  };
}

function serviceHealth(serviceId, overrides = {}) {
  return {
    ok: true,
    render_ready: true,
    version: "1.2.3",
    build: {
      build_id: `build-${serviceId}`,
      commit_sha: TARGET,
      commit_verifiable: true,
    },
    health_contract_version: HOST_NATIVE_HEALTH_CONTRACT_VERSION,
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    ...overrides,
  };
}

const STRICT_POLICY = Object.freeze({
  schema_version: "host_native_required_checks_policy_v1",
  tenant_id: "tenant-a",
  repository: "owner/repo",
  base_branch: "main",
  required_checks: ["core-mcp", "deployment-parity", "universal-core"],
  check_app: { id: 15368, slug: "github-actions", owner: "github" },
  workflow: {
    id: 312527659,
    name: "Nyra Core Intelligence",
    path: ".github/workflows/nyra-core-intelligence.yml",
    sha256: WORKFLOW_SHA256,
  },
  allowed_events: ["pull_request", "push"],
});
const STRICT_POLICY_DIGEST = hostNativeDigest({
  ...STRICT_POLICY,
  required_checks: [...STRICT_POLICY.required_checks].sort(),
  workflow: { ...STRICT_POLICY.workflow, candidate_sha256: null },
  allowed_events: [...STRICT_POLICY.allowed_events].sort(),
});
const RULESET_ONLY_RULES = Object.freeze([
  { ruleset_id: 901, type: "deletion" },
  { ruleset_id: 901, type: "non_fast_forward" },
  {
    ruleset_id: 901,
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: STRICT_POLICY.required_checks.map((context) => ({
        context,
        integration_id: STRICT_POLICY.check_app.id,
      })),
    },
  },
  {
    ruleset_id: 901,
    type: "pull_request",
    parameters: {
      required_approving_review_count: 1,
      allowed_merge_methods: ["merge"],
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_extra_approval_for_unattributed_changes: false,
      require_last_push_approval: false,
      required_review_thread_resolution: false,
      required_reviewers: [],
    },
  },
]);
const REAL_RULESET_ONLY_RULES = Object.freeze(RULESET_ONLY_RULES.map((rule) =>
  rule.type === "pull_request" ? {
    ...rule,
    ruleset_id: 20861970,
    parameters: {
      ...rule.parameters,
      required_approving_review_count: 0,
      required_review_thread_resolution: true,
      require_extra_approval_for_unattributed_changes: true,
    },
  } : { ...rule, ruleset_id: 20861970 }));

function attributedPullCommit(commitSha, parentSha, overrides = {}) {
  return {
    sha: commitSha,
    parents: [{ sha: parentSha }],
    author: { login: "author-a" },
    committer: { login: "committer-a" },
    commit: {
      verification: {
        verified: false,
        reason: "unsigned",
        signature: null,
        payload: null,
        verified_at: null,
      },
    },
    ...overrides,
  };
}

function attributedCommitChain(length) {
  const commits = [];
  let parent = BASE;
  for (let index = 0; index < length; index += 1) {
    const commitSha = index === length - 1
      ? HEAD
      : (index + 10).toString(16).padStart(40, "0");
    commits.push(attributedPullCommit(commitSha, parent));
    parent = commitSha;
  }
  return commits;
}

function strictTicket() {
  const ticket = mergeTicket();
  ticket.release_manifest_binding.base_branch = "main";
  ticket.release_manifest_binding.verification.required_checks =
    [...STRICT_POLICY.required_checks];
  return ticket;
}

function strictChecks({
  runIds = {},
  wrongApp = false,
  includeDuplicateRerun = false,
} = {}) {
  const checks = STRICT_POLICY.required_checks.map((name, index) => ({
    id: runIds[name] || 100 + index,
    name,
    head_sha: HEAD,
    status: "completed",
    conclusion: "success",
    details_url: "https://github.com/owner/repo/actions/runs/700/job/800",
    app: {
      id: 15368,
      slug: "github-actions",
      owner: { login: "github" },
    },
  }));
  if (includeDuplicateRerun) {
    checks.push({ ...checks[0], id: 1 });
  }
  if (wrongApp) {
    checks.push({
      ...checks[0],
      id: 999,
      app: { id: 44, slug: "spoof", owner: { login: "attacker" } },
    });
  }
  return { check_runs: checks };
}

function strictWorkflow(overrides = {}) {
  return {
    id: 700,
    workflow_id: 312527659,
    run_attempt: 2,
    name: "Nyra Core Intelligence",
    path: ".github/workflows/nyra-core-intelligence.yml",
    event: "pull_request",
    head_sha: HEAD,
    head_branch: "agent/release",
    repository: { full_name: "owner/repo" },
    pull_requests: [{
      url: "https://api.github.com/repos/owner/repo/pulls/42",
      number: 42,
      head: { ref: "agent/release", sha: HEAD },
      base: { ref: "main", sha: BASE },
    }],
    status: "completed",
    conclusion: "success",
    ...overrides,
  };
}

function strictFetch({
  ticket = strictTicket(),
  checks = strictChecks(),
  workflowById = new Map([[700, strictWorkflow()]]),
  calls = [],
} = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    const root = "https://api.github.com/repos/owner/repo";
    if (url === `${root}/commits/${HEAD}/check-runs?per_page=100`) {
      return jsonResponse(checks);
    }
    if ([
      `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${BASE}`,
      `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${HEAD}`,
    ].includes(url)) {
      return jsonResponse({
        type: "file",
        path: ".github/workflows/nyra-core-intelligence.yml",
        encoding: "base64",
        content: Buffer.from(WORKFLOW_SOURCE).toString("base64"),
      });
    }
    const runMatch = /\/actions\/runs\/(\d+)$/.exec(url);
    if (runMatch) return jsonResponse(workflowById.get(Number(runMatch[1])));
    if (url === `${root}/pulls/42`) return jsonResponse(pullRequest());
    if (url === `${root}/git/commits/${TARGET}`) return jsonResponse({ sha: TARGET });
    if (url === `${root}/git/commits/${BASE}`) return jsonResponse({ sha: BASE });
    if (url === "https://service-a.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-a"));
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

function strictFetchWithWorkflowSources({
  baseSource = WORKFLOW_SOURCE,
  headSource = WORKFLOW_SOURCE,
  ...strictFetchOptions
} = {}) {
  const fallback = strictFetch(strictFetchOptions);
  return async (url, init) => {
    const root = "https://api.github.com/repos/owner/repo";
    if (
      url ===
      `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${BASE}`
    ) {
      return jsonResponse({
        type: "file",
        path: ".github/workflows/nyra-core-intelligence.yml",
        encoding: "base64",
        content: Buffer.from(baseSource).toString("base64"),
      });
    }
    if (
      url ===
      `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${HEAD}`
    ) {
      return jsonResponse({
        type: "file",
        path: ".github/workflows/nyra-core-intelligence.yml",
        encoding: "base64",
        content: Buffer.from(headSource).toString("base64"),
      });
    }
    return fallback(url, init);
  };
}

function strictProtectedPushTicket() {
  const ticket = strictTicket();
  ticket.action = {
    kind: "git.push.protected",
    branch: "main",
    source_commit: HEAD,
    expected_remote_commit: BASE,
    force: false,
    delete_ref: false,
    tags: false,
    provider_execution: false,
  };
  return ticket;
}

function strictObserveTicket() {
  const ticket = strictTicket();
  const serviceB = {
    service_id: "service-b",
    environment: "production",
    origin: "https://service-b.onrender.com",
    expected_previous_commit: BASE,
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  };
  ticket.release_manifest_binding.services.push(serviceB);
  const previousBUnsigned = {
    service_id: serviceB.service_id,
    environment: serviceB.environment,
    origin: serviceB.origin,
    health_path: "/healthz",
    deployment_id: "previous-service-b",
    live_commit: BASE,
    health_status: "healthy",
    health_contract_digest: serviceB.health_contract_digest,
  };
  ticket.release_join_resolution.previous_live_attestations.push({
    ...previousBUnsigned,
    readback_digest: hostNativeDigest(previousBUnsigned),
  });
  ticket.release_join_resolution.pre_action_readback_digest = hostNativeDigest({
    source_attestation: ticket.release_join_resolution.source_attestation,
    previous_live_attestations: ticket.release_join_resolution.previous_live_attestations,
  });
  ticket.release_join_resolution_digest = hostNativeDigest(ticket.release_join_resolution);
  const sourceAction = {
    ...ticket.action,
    repository: ticket.repository,
    provider_execution: false,
  };
  const manifestDigest = "c".repeat(64);
  const parentTicketId = "hnt_parent-release";
  const parentTicketDigest = "d".repeat(64);
  ticket.host_kind = "codex_native";
  ticket.host_session_fingerprint = "observe-session";
  ticket.release_manifest_digest = manifestDigest;
  ticket.release_intent_digest = "e".repeat(64);
  ticket.core_join_verdict_digest = "f".repeat(64);
  ticket.release_manifest_binding = {
    ...ticket.release_manifest_binding,
    schema_version: "host_release_manifest_v2",
    repository: ticket.repository,
    manifest_digest: manifestDigest,
    delivery_branch: "main",
  };
  ticket.action = {
    kind: "render.observe",
    repository: ticket.repository,
    branch: "main",
    service_id: "service-a",
    environment: "production",
    target_commit: TARGET,
    parent_release_ticket_id: parentTicketId,
    parent_release_ticket_digest: parentTicketDigest,
    release_manifest_digest: manifestDigest,
    provider_execution: false,
  };
  const policyDigest = hostNativeDigest({
    schema_version: STRICT_POLICY.schema_version,
    tenant_id: STRICT_POLICY.tenant_id,
    repository: STRICT_POLICY.repository,
    base_branch: STRICT_POLICY.base_branch,
    required_checks: [...STRICT_POLICY.required_checks].sort(),
    check_app: STRICT_POLICY.check_app,
    workflow: { ...STRICT_POLICY.workflow, candidate_sha256: null },
    allowed_events: [...STRICT_POLICY.allowed_events].sort(),
  });
  const receiptUnsigned = {
    schema_version: "host_native_finalize_authorization_v1",
    trusted: true,
    allowed: true,
    decision: "ALLOW_FINALIZE",
    decision_id: parentTicketId,
    tenant_id: ticket.tenant_id,
    work_id: ticket.work_id,
    repository: ticket.repository,
    result_commit_verified: true,
    action_ticket_id: parentTicketId,
    action_ticket_digest: parentTicketDigest,
    target_commit: TARGET,
    release_manifest_digest: manifestDigest,
    release_intent_digest: ticket.release_intent_digest,
    core_join_verdict_id: ticket.core_join_verdict_id,
    core_join_verdict_digest: ticket.core_join_verdict_digest,
    core_join_resolution_digest: ticket.release_join_resolution_digest,
    predecessor: null,
    predecessor_chain_digest: null,
    evidence_digest: ticket.evidence_digest,
    host_kind: ticket.host_kind,
    host_session_fingerprint: ticket.host_session_fingerprint,
    host_policy_override: false,
    host_policy_must_allow: true,
    provider_execution: false,
    github_readback: { required_checks_policy_digest: policyDigest },
  };
  const authorizationDigest = hostNativeDigest(receiptUnsigned);
  const finalizeAuthorization = {
    ...receiptUnsigned,
    authorization_digest: authorizationDigest,
    signature: `hnf_${"a".repeat(64)}`,
  };
  ticket.predecessor = {
    ticket_id: parentTicketId,
    ticket_digest: parentTicketDigest,
    result_commit: TARGET,
    finalize_authorization: finalizeAuthorization,
    finalize_authorization_digest: authorizationDigest,
    source_action: sourceAction,
    source_action_digest: hostNativeDigest(sourceAction),
    source_evidence_digest: ticket.evidence_digest,
    source_required_checks_policy_digest: policyDigest,
  };
  ticket.predecessor_chain_digest = hostNativeDigest(ticket.predecessor);
  return ticket;
}

function strictObserveFetch({
  ticket = strictObserveTicket(),
  refSha = TARGET,
  pull = pullRequest(),
  calls = [],
} = {}) {
  const fallback = strictFetch({ ticket, calls });
  return async (url, init) => {
    const root = "https://api.github.com/repos/owner/repo";
    if (url === `${root}/git/ref/heads/main`) {
      calls.push({ url, init });
      return jsonResponse({ object: { sha: refSha } });
    }
    if (url === `${root}/pulls/42`) {
      calls.push({ url, init });
      return jsonResponse(pull);
    }
    if (url === "https://service-b.onrender.com/healthz") {
      calls.push({ url, init });
      return jsonResponse(serviceHealth("service-b"));
    }
    return fallback(url, init);
  };
}

function strictOwnerManualMergeObserveTicket() {
  const ticket = strictObserveTicket();
  const sourceAction = structuredClone(ticket.predecessor.source_action);
  const policyDigest = ticket.predecessor.source_required_checks_policy_digest;
  const manualReceiptId = `hnmmr_${"a".repeat(40)}`;
  const manualReceiptDigest = "b".repeat(64);
  ticket.evidence_digest = manualReceiptDigest;
  ticket.release_join_resolution.evidence_digest = manualReceiptDigest;
  ticket.release_join_resolution_digest = hostNativeDigest(ticket.release_join_resolution);
  ticket.action = {
    kind: "render.observe",
    repository: ticket.repository,
    branch: "main",
    service_id: "service-a",
    environment: "production",
    target_commit: TARGET,
    release_manifest_digest: ticket.release_manifest_digest,
    provider_execution: false,
  };
  ticket.predecessor = {
    schema_version: "host_native_owner_manual_merge_predecessor_v2",
    predecessor_type: "owner_manual_github_merge_readback",
    manual_merge_readback_id: manualReceiptId,
    manual_merge_readback_digest: manualReceiptDigest,
    source_readback_digest: "c".repeat(64),
    core_join_verdict_id: ticket.core_join_verdict_id,
    core_join_record_digest: "d".repeat(64),
    result_commit: TARGET,
    source_action: sourceAction,
    source_action_digest: hostNativeDigest(sourceAction),
    source_evidence_digest: manualReceiptDigest,
    source_required_checks_policy_digest: policyDigest,
    retrospective_ticket_issued: false,
    provider_execution: false,
  };
  ticket.predecessor_chain_digest = hostNativeDigest(ticket.predecessor);
  return ticket;
}

function refreshObservePredecessor(ticket) {
  const receipt = ticket.predecessor.finalize_authorization;
  const { signature: _signature, authorization_digest: _digest, ...receiptUnsigned } = receipt;
  receipt.authorization_digest = hostNativeDigest(receiptUnsigned);
  receipt.signature = `hnf_${"a".repeat(64)}`;
  ticket.predecessor.finalize_authorization_digest = receipt.authorization_digest;
  ticket.predecessor.source_action_digest = hostNativeDigest(ticket.predecessor.source_action);
  ticket.predecessor_chain_digest = hostNativeDigest(ticket.predecessor);
  return ticket;
}

function strictProtectedPushObserveTicket() {
  const ticket = strictObserveTicket();
  ticket.action.target_commit = HEAD;
  ticket.predecessor.result_commit = HEAD;
  ticket.predecessor.source_action = {
    kind: "git.push.protected",
    repository: ticket.repository,
    branch: "main",
    source_commit: HEAD,
    expected_remote_commit: BASE,
    force: false,
    delete_ref: false,
    tags: false,
    provider_execution: false,
  };
  ticket.predecessor.finalize_authorization.target_commit = HEAD;
  return refreshObservePredecessor(ticket);
}

function strictStagingDeployTicket() {
  const ticket = strictTicket();
  ticket.release_manifest_binding.services[0].environment = "staging";
  ticket.release_join_resolution.previous_live_attestations[0].environment = "staging";
  ticket.release_join_resolution_digest = hostNativeDigest(ticket.release_join_resolution);
  ticket.action = {
    kind: "render.deploy",
    repository: "owner/repo",
    service_id: "service-a",
    environment: "staging",
    branch: "agent/release",
    source_commit: HEAD,
    target_commit: HEAD,
    expected_live_commit: BASE,
    pull_request: 42,
    base_branch: "main",
    expected_base_commit: BASE,
    provider_execution: false,
  };
  return ticket;
}

function strictStagingDeployFetch({
  ticket = strictStagingDeployTicket(),
  workflow = strictWorkflow(),
  pull = pullRequest("owner/repo", { number: 42, merged: false, merge_commit_sha: null, state: "open", draft: false }),
  refSha = HEAD,
} = {}) {
  const fallback = strictFetch({
    ticket,
    workflowById: new Map([[700, workflow]]),
  });
  return async (url, init) => {
    if (url === "https://api.github.com/repos/owner/repo/git/ref/heads/agent/release") {
      return jsonResponse({ object: { sha: refSha } });
    }
    if (url === "https://api.github.com/repos/owner/repo/git/commits/2222222222222222222222222222222222222222") {
      return jsonResponse({ sha: HEAD });
    }
    if (url === "https://api.github.com/repos/owner/repo/git/commits/1111111111111111111111111111111111111111") {
      return jsonResponse({ sha: BASE });
    }
    if (url === "https://api.github.com/repos/owner/repo/pulls/42") {
      return jsonResponse(pull);
    }
    if (url === "https://service-a.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-a", {
        build: { build_id: "build-service-a", commit_sha: HEAD, commit_verifiable: true },
      }));
    }
    return fallback(url, init);
  };
}

function strictProductionDeployTicket() {
  const ticket = mergeTicket({
    services: [
      {
        service_id: "service-a",
        environment: "production",
        origin: "https://service-a.onrender.com",
        expected_previous_commit: BASE,
        target_commit: HEAD,
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      },
      {
        service_id: "service-b",
        environment: "production",
        origin: "https://service-b.onrender.com",
        expected_previous_commit: ALTERNATE,
        target_commit: ALTERNATE,
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      },
    ],
  });
  ticket.release_manifest_binding.base_branch = "main";
  ticket.release_manifest_binding.delivery_branch = "main";
  ticket.release_manifest_binding.verification.required_checks =
    [...STRICT_POLICY.required_checks];
  ticket.release_join_resolution.required_checks_policy_digest = STRICT_POLICY_DIGEST;
  ticket.release_join_resolution_digest = hostNativeDigest(ticket.release_join_resolution);
  ticket.action = {
    kind: "render.deploy",
    repository: "owner/repo",
    branch: "main",
    base_branch: "main",
    service_id: "service-a",
    environment: "production",
    source_commit: HEAD,
    target_commit: HEAD,
    expected_base_commit: BASE,
    expected_live_commit: BASE,
    provider_execution: false,
  };
  return ticket;
}

function strictProductionDeployFetch({ ticket = strictProductionDeployTicket() } = {}) {
  const fallback = strictFetch({
    ticket,
    workflowById: new Map([[700, strictWorkflow({
      event: "push",
      head_branch: "main",
      pull_requests: [],
    })]]),
  });
  return async (url, init) => {
    const root = "https://api.github.com/repos/owner/repo";
    if (url === `${root}/git/ref/heads/main`) {
      return jsonResponse({ object: { sha: HEAD } });
    }
    if (url === `${root}/git/commits/${HEAD}`) return jsonResponse({ sha: HEAD });
    if (url === "https://service-a.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-a", {
        build: { build_id: "current-service-a", commit_sha: HEAD, commit_verifiable: true },
      }));
    }
    if (url === "https://service-b.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-b", {
        build: { build_id: "current-service-b", commit_sha: ALTERNATE, commit_verifiable: true },
      }));
    }
    return fallback(url, init);
  };
}

function strictProtectedPushFetch({
  baseSource = WORKFLOW_SOURCE,
  headSource = WORKFLOW_SOURCE,
  ticket = strictProtectedPushTicket(),
} = {}) {
  const fallback = strictFetchWithWorkflowSources({
    baseSource,
    headSource,
    ticket,
    workflowById: new Map([[
      700,
      strictWorkflow({
        event: "push",
        head_branch: "main",
        pull_requests: [],
      }),
    ]]),
  });
  return async (url, init) => {
    const root = "https://api.github.com/repos/owner/repo";
    if (url === `${root}/git/ref/heads/main`) {
      return jsonResponse({ object: { sha: HEAD } });
    }
    if (url === `${root}/git/commits/${HEAD}`) {
      return jsonResponse({ sha: HEAD });
    }
    if (url === "https://service-a.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-a", {
        build: {
          build_id: "build-service-a",
          commit_sha: HEAD,
          commit_verifiable: true,
        },
      }));
    }
    return fallback(url, init);
  };
}

test("render.observe verifies signed merged-PR source, exact main target, all services and rollback", async (t) => {
  const verify = async (ticket = strictObserveTicket(), fetchOptions = {}, resolver = async () => STRICT_POLICY) => {
    const calls = [];
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictObserveFetch({ ticket, calls, ...fetchOptions }),
      requiredChecksPolicyResolver: resolver,
      now: () => Date.parse(VERIFIED_AT),
    });
    return { result: await verifier({ ticket, target_commit: TARGET }), calls };
  };

  assert.notEqual(TARGET, HEAD);
  const { result, calls } = await verify();
  assert.equal(result.github.action_kind, "render.observe");
  assert.equal(result.github.source_action_kind, "github.merge");
  assert.equal(result.github.head_commit, HEAD);
  assert.equal(result.github.target_commit, TARGET);
  assert.equal(result.github.branch_commit, TARGET);
  assert.equal(result.github.merge_commit, TARGET);
  assert.equal(result.github.pull_request, 42);
  assert.equal(result.services.length, 2);
  assert.deepEqual(
    result.services.map(({ service_id, live_commit, rollback_commit }) => ({
      service_id, live_commit, rollback_commit,
    })),
    [
      { service_id: "service-a", live_commit: TARGET, rollback_commit: BASE },
      { service_id: "service-b", live_commit: TARGET, rollback_commit: BASE },
    ],
  );
  assert.ok(calls.some(({ url }) => url.endsWith("/git/ref/heads/main")));
  assert.ok(calls.some(({ url }) => url.endsWith("/pulls/42")));
  assert.ok(calls.some(({ url }) => url === "https://service-a.onrender.com/healthz"));
  assert.ok(calls.some(({ url }) => url === "https://service-b.onrender.com/healthz"));

  await t.test("strict workflow policy is mandatory", async () => {
    await assert.rejects(
      verify(strictObserveTicket(), {}, null),
      /required_checks_policy_unavailable/,
    );
  });

  await t.test("a different valid workflow policy cannot replace the signed parent policy", async () => {
    await assert.rejects(
      verify(strictObserveTicket(), {}, async () => ({
        ...STRICT_POLICY,
        workflow: {
          ...STRICT_POLICY.workflow,
          candidate_sha256: WORKFLOW_CANDIDATE_SHA256,
        },
      })),
      /required_checks_policy_mismatch/,
    );
  });

  for (const [name, mutate] of [
    ["predecessor chain", (ticket) => { ticket.predecessor_chain_digest = "0".repeat(64); }],
    ["source action", (ticket) => { ticket.predecessor.source_action.pull_request = 99; }],
    ["source action digest", (ticket) => { ticket.predecessor.source_action_digest = "0".repeat(64); }],
    ["parent id", (ticket) => { ticket.action.parent_release_ticket_id = "hnt_other"; }],
    ["result target", (ticket) => { ticket.predecessor.result_commit = ALTERNATE; }],
    ["manifest binding", (ticket) => { ticket.release_manifest_binding.manifest_digest = "0".repeat(64); }],
    ["resolution digest", (ticket) => { ticket.release_join_resolution_digest = "0".repeat(64); }],
    ["recursive observe", (ticket) => { ticket.predecessor.source_action.kind = "render.observe"; }],
  ]) {
    await t.test(`tampered ${name} fails before provider readback`, async () => {
      const ticket = strictObserveTicket();
      mutate(ticket);
      let fetched = false;
      const verifier = createHostNativeExternalReadbackVerifier({
        fetchImpl: async () => { fetched = true; throw new Error("must not fetch"); },
        requiredChecksPolicyResolver: async () => STRICT_POLICY,
      });
      await assert.rejects(
        verifier({ ticket, target_commit: TARGET }),
        /trusted_readback_observation_binding_invalid/,
      );
      assert.equal(fetched, false);
    });
  }

  await t.test("main ref must equal TARGET, not HEAD", async () => {
    await assert.rejects(
      verify(strictObserveTicket(), { refSha: HEAD }),
      /trusted_readback_branch_commit_mismatch/,
    );
  });
});

test("owner manual-merge predecessor drives fresh GitHub, checks and Render observation", async (t) => {
  const verify = async (ticket = strictOwnerManualMergeObserveTicket()) => {
    const calls = [];
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictObserveFetch({ ticket, calls }),
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
      now: () => Date.parse(VERIFIED_AT),
    });
    return { result: await verifier({ ticket, target_commit: TARGET }), calls };
  };
  const ticket = strictOwnerManualMergeObserveTicket();
  const { result, calls } = await verify(ticket);
  assert.equal(result.github.manual_merge_readback_id,
    ticket.predecessor.manual_merge_readback_id);
  assert.equal(result.github.manual_merge_readback_digest,
    ticket.predecessor.manual_merge_readback_digest);
  assert.equal(result.github.source_readback_digest,
    ticket.predecessor.source_readback_digest);
  assert.equal(Object.hasOwn(result.github, "predecessor_ticket_id"), false);
  assert.equal(result.github.merge_commit, TARGET);
  assert.equal(result.github.branch_commit, TARGET);
  assert.equal(result.services.every((service) =>
    service.live_commit === TARGET && service.health_status === "healthy"), true);
  assert.ok(calls.some(({ url }) => url.endsWith("/pulls/42")));
  assert.ok(calls.some(({ url }) => url.endsWith("/git/ref/heads/main")));
  assert.ok(calls.some(({ url }) => url.endsWith("/healthz")));

  await t.test("refreshed lineage distinguishes original and successor Join", async () => {
    const candidate = strictOwnerManualMergeObserveTicket();
    const lineageUnsigned = {
      schema_version: "host_native_owner_manual_merge_refresh_lineage_v1",
      predecessor_manual_merge_readback_id: `hnmmr_${"d".repeat(40)}`,
      predecessor_manual_merge_readback_digest: "e".repeat(64),
      predecessor_core_join_verdict_id: `hnj_${"f".repeat(40)}`,
      successor_core_join_verdict_id: candidate.core_join_verdict_id,
      legacy_diff_digest: "1".repeat(64),
      canonical_diff_digest: "2".repeat(64),
      predecessor_release_intent_digest: "3".repeat(64),
      successor_release_intent_digest: "4".repeat(64),
      correction: "legacy_diff_digest_to_host_native_github_diff_digest",
      authorized_successor_action: "render.observe",
      provider_execution: false,
    };
    candidate.predecessor.refresh_lineage = {
      ...lineageUnsigned,
      lineage_digest: hostNativeDigest(lineageUnsigned),
    };
    candidate.predecessor.refresh_lineage_digest = hostNativeDigest(
      candidate.predecessor.refresh_lineage,
    );
    candidate.predecessor_chain_digest = hostNativeDigest(candidate.predecessor);
    const { result } = await verify(candidate);
    assert.equal(result.github.manual_merge_original_readback_id,
      lineageUnsigned.predecessor_manual_merge_readback_id);
    assert.equal(result.github.manual_merge_original_core_join_verdict_id,
      lineageUnsigned.predecessor_core_join_verdict_id);
    assert.equal(result.github.manual_merge_successor_core_join_verdict_id,
      candidate.core_join_verdict_id);

    candidate.predecessor.refresh_lineage.successor_core_join_verdict_id =
      `hnj_${"0".repeat(40)}`;
    candidate.predecessor.refresh_lineage_digest = hostNativeDigest(
      candidate.predecessor.refresh_lineage,
    );
    candidate.predecessor_chain_digest = hostNativeDigest(candidate.predecessor);
    await assert.rejects(verify(candidate),
      /trusted_readback_observation_binding_invalid/);
  });

  for (const [name, mutate] of [
    ["receipt id", (candidate) => {
      candidate.predecessor.manual_merge_readback_id = `hnmmr_${"f".repeat(40)}`;
    }],
    ["receipt digest", (candidate) => {
      candidate.predecessor.manual_merge_readback_digest = "f".repeat(64);
    }],
    ["Core Join base", (candidate) => {
      candidate.predecessor.source_action.expected_base_commit = ALTERNATE;
    }],
  ]) {
    await t.test(`${name} substitution fails before provider readback`, async () => {
      const candidate = strictOwnerManualMergeObserveTicket();
      mutate(candidate);
      let fetched = false;
      const verifier = createHostNativeExternalReadbackVerifier({
        fetchImpl: async () => { fetched = true; throw new Error("must_not_fetch"); },
        requiredChecksPolicyResolver: async () => STRICT_POLICY,
      });
      await assert.rejects(verifier({ ticket: candidate, target_commit: TARGET }),
        /trusted_readback_observation_binding_invalid/);
      assert.equal(fetched, false);
    });
  }
});

test("render.observe also verifies an exact protected-push predecessor", async () => {
  const ticket = strictProtectedPushObserveTicket();
  const calls = [];
  const fallback = strictProtectedPushFetch({ ticket });
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === "https://service-b.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-b", {
        build: { build_id: "build-service-b", commit_sha: HEAD, commit_verifiable: true },
      }));
    }
    return fallback(url, init);
  };
  const verifier = createHostNativeExternalReadbackVerifier({
    fetchImpl,
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
    now: () => Date.parse(VERIFIED_AT),
  });
  const result = await verifier({ ticket, target_commit: HEAD });
  assert.equal(result.github.action_kind, "render.observe");
  assert.equal(result.github.source_action_kind, "git.push.protected");
  assert.equal(result.github.branch, "main");
  assert.equal(result.github.branch_commit, HEAD);
  assert.equal(result.github.pull_request, null);
  assert.equal(result.github.merged, null);
  assert.equal(result.services.length, 2);
  assert.equal(calls.some(({ url }) => url.endsWith("/pulls/42")), false);
});

test("strict required-check attestation pins app/workflow, accepts deterministic rerun, and caches one run", async () => {
  const ticket = strictTicket();
  const calls = [];
  const verify = createHostNativeExternalReadbackVerifier({
    fetchImpl: strictFetch({
      ticket,
      checks: strictChecks({ includeDuplicateRerun: true }),
      calls,
    }),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
    workflowRunCacheMaximumEntries: 1,
    now: () => Date.parse(VERIFIED_AT),
  });
  const first = await verify({ ticket, target_commit: TARGET });
  await verify({ ticket, target_commit: TARGET });
  assert.equal(
    calls.filter((call) => call.url.endsWith("/actions/runs/700")).length,
    1,
  );
  assert.equal(verify.workflow_run_cache.maximum_entries, 1);
  assert.equal(verify.workflow_run_cache.size(), 1);
  assert.equal(verify.workflow_source_cache.maximum_entries, 1);
  assert.equal(verify.workflow_source_cache.size(), 1);
  assert.equal(first.github.observed_checks[0].check_run_id, 100);
  assert.equal(first.github.observed_checks[0].workflow_run_attempt, 2);
  assert.match(first.github.required_checks_policy_digest, /^[a-f0-9]{64}$/);
  assert.match(first.github.checks_attestation_digest, /^[a-f0-9]{64}$/);
});

test("owner manual-merge verifier derives PR, checks and main facts from GitHub", async (t) => {
  const coreJoinRecord = {
    release_intent: { base_commit: BASE },
    claim: {
      tenant_id: "tenant-a",
      repository: "owner/repo",
      base_branch: "main",
      checks: {
        commit: HEAD,
        required_checks: [...STRICT_POLICY.required_checks],
      },
      required_checks_policy_digest: STRICT_POLICY_DIGEST,
    },
  };
  const run = async ({
    mainCommit = TARGET,
    pullOverrides = {},
    workflow = strictWorkflow(),
  } = {}) => {
    const calls = [];
    const fallback = strictFetch({
      calls,
      workflowById: new Map([[700, workflow]]),
    });
    const fetchImpl = async (url, init) => {
      const root = "https://api.github.com/repos/owner/repo";
      if (url === `${root}/pulls/42`) {
        calls.push({ url, init });
        return jsonResponse(pullRequest("owner/repo", {
          state: "closed",
          merged_at: "2026-07-29T11:59:00.000Z",
          ...pullOverrides,
        }));
      }
      if (url === `${root}/git/ref/heads/main`) {
        calls.push({ url, init });
        return jsonResponse({ object: { sha: mainCommit } });
      }
      return fallback(url, init);
    };
    const verifier = createHostNativeOwnerManualMergeReadbackVerifier({
      fetchImpl,
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
      now: () => Date.parse(VERIFIED_AT),
    });
    return { result: await verifier({
      tenant_id: "tenant-a",
      repository: "owner/repo",
      pull_request: 42,
      core_join_record: coreJoinRecord,
    }), calls };
  };
  const { result, calls } = await run();
  assert.equal(result.schema_version,
    "host_native_owner_manual_merge_github_readback_v1");
  assert.equal(result.source, "universal_core_github_readback");
  assert.equal(result.merged, true);
  assert.equal(result.head_commit, HEAD);
  assert.equal(result.merge_commit, TARGET);
  assert.equal(result.main_head_commit, TARGET);
  assert.equal(result.checks_passed, true);
  assert.equal(result.required_checks_policy_digest, STRICT_POLICY_DIGEST);
  assert.equal(result.external_side_effect, false);
  assert.equal(result.provider_execution, false);
  assert.match(result.readback_digest, /^[a-f0-9]{64}$/);
  assert.ok(calls.some(({ url }) => url.endsWith("/pulls/42")));
  assert.ok(calls.some(({ url }) => url.endsWith("/git/ref/heads/main")));
  assert.ok(calls.some(({ url }) => url.endsWith(`/commits/${HEAD}/check-runs?per_page=100`)));

  await t.test("an empty workflow PR association reuses the server-validated PR", async () => {
    const observed = await run({ workflow: strictWorkflow({ pull_requests: [] }) });
    assert.equal(observed.result.pull_request, 42);
    assert.equal(observed.result.head_commit, HEAD);
    assert.equal(observed.result.base_commit, BASE);
  });

  await t.test("a non-empty substituted workflow PR association fails closed", async () => {
    await assert.rejects(run({
      workflow: strictWorkflow({
        pull_requests: [{
          url: "https://api.github.com/repos/owner/repo/pulls/99",
          number: 99,
          head: { ref: "agent/release", sha: HEAD },
          base: { ref: "main", sha: BASE },
        }],
      }),
    }), /workflow_pull_request_mismatch/);
  });

  await t.test("main drift fails closed", async () => {
    await assert.rejects(run({ mainCommit: ALTERNATE }),
      /owner_manual_merge_readback_main_drift/);
  });
  await t.test("a substituted PR head fails closed", async () => {
    await assert.rejects(run({
      pullOverrides: { head: { sha: ALTERNATE, ref: "agent/release", repo: { full_name: "owner/repo" } } },
    }), /owner_manual_merge_readback_pull_request_mismatch/);
  });
  await t.test("a PR base SHA different from the Core Join base fails closed", async () => {
    await assert.rejects(run({
      pullOverrides: { base: { sha: ALTERNATE, ref: "main", repo: { full_name: "owner/repo" } } },
    }), /owner_manual_merge_readback_pull_request_mismatch/);
  });
});

test("post-merge empty workflow association uses only the signed Core source attestation", async (t) => {
  const emptyWorkflow = strictWorkflow({ pull_requests: [] });
  const verify = (ticket = strictTicket(), extra = {}) => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictFetch({
        ticket,
        workflowById: new Map([[700, emptyWorkflow]]),
      }),
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
      now: () => Date.parse(VERIFIED_AT),
    });
    return verifier({ ticket, target_commit: TARGET, ...extra });
  };

  const ticket = strictTicket();
  const result = await verify(ticket);
  assert.equal(result.github.pull_request, 42);
  assert.equal(result.github.head_commit, HEAD);
  assert.equal(result.github.expected_base_commit, BASE);
  assert.equal(
    ticket.release_join_resolution_digest,
    hostNativeDigest(ticket.release_join_resolution),
  );
  assert.equal(
    ticket.release_join_resolution.source_attestation.attestation_digest,
    hostNativeDigest((({ attestation_digest: _digest, ...unsigned }) => unsigned)(
      ticket.release_join_resolution.source_attestation,
    )),
  );

  await t.test("missing persisted resolution fails closed", async () => {
    const missing = strictTicket();
    delete missing.release_join_resolution;
    delete missing.release_join_resolution_digest;
    await assert.rejects(verify(missing), /workflow_pull_request_mismatch/);
  });

  await t.test("caller-supplied source facts cannot substitute", async () => {
    const missing = strictTicket();
    const callerSource = structuredClone(
      missing.release_join_resolution.source_attestation,
    );
    delete missing.release_join_resolution.source_attestation;
    missing.release_join_resolution_digest = hostNativeDigest(
      missing.release_join_resolution,
    );
    await assert.rejects(
      verify(missing, { source_attestation: callerSource }),
      /workflow_pull_request_mismatch/,
    );
  });

  await t.test("resolution digest mismatch fails closed", async () => {
    const mismatched = strictTicket();
    mismatched.release_join_resolution_digest = "0".repeat(64);
    await assert.rejects(verify(mismatched), /workflow_pull_request_mismatch/);
  });

  for (const [name, mutate] of [
    ["repository", (source) => { source.repository = "attacker/repo"; }],
    ["pull request", (source) => { source.pull_request = 99; }],
    ["base commit", (source) => { source.base_commit = ALTERNATE; }],
    ["head commit", (source) => { source.head_commit = ALTERNATE; }],
    ["tree shape", (source) => { source.tree_sha = "not-a-commit"; }],
    ["evidence kind", (source) => { source.evidence_kind = "github_compare_files"; }],
    ["changed-file shape", (source) => { source.changed_files = [...source.changed_files, ...source.changed_files]; }],
    ["unexpected branch field", (source) => { source.head_branch = "agent/release"; }],
  ]) {
    await t.test(`mismatched signed ${name} fails closed`, async () => {
      const mismatched = strictTicket();
      mutate(mismatched.release_join_resolution.source_attestation);
      refreshReleaseJoinSourceAttestation(mismatched);
      await assert.rejects(verify(mismatched), /workflow_pull_request_mismatch/);
    });
  }
});

test("staging Render deploy accepts only an exact same-repository pull-request attestation", async (t) => {
  const ticket = strictStagingDeployTicket();
  const verify = ({ workflow, pull, policy = STRICT_POLICY } = {}) => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictStagingDeployFetch({ ticket, workflow, pull }),
      requiredChecksPolicyResolver: async () => policy,
      now: () => Date.parse(VERIFIED_AT),
    });
    return verifier({ ticket, target_commit: HEAD });
  };

  const result = await verify();
  assert.equal(result.github.branch_commit, HEAD);
  assert.equal(result.github.pull_request, 42);
  assert.equal(result.services[0].live_commit, HEAD);

  await t.test("production remains push-only", async () => {
    const production = structuredClone(ticket);
    production.action.environment = "production";
    production.release_manifest_binding.services[0].environment = "production";
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictStagingDeployFetch({ ticket: production }),
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
    });
    await assert.rejects(
      verifier({ ticket: production, target_commit: HEAD }),
      /workflow_run_mismatch/,
    );
  });

  await t.test("policy must explicitly allow pull_request", async () => {
    await assert.rejects(
      verify({ policy: { ...STRICT_POLICY, allowed_events: ["push"] } }),
      /required_checks_policy_event_denied/,
    );
  });

  await t.test("remote branch must still resolve to the exact target", async () => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictStagingDeployFetch({ ticket, refSha: ALTERNATE }),
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
    });
    await assert.rejects(
      verifier({ ticket, target_commit: HEAD }),
      /trusted_readback_branch_commit_mismatch/,
    );
  });

  await t.test("empty workflow association cannot use the merge-only fallback", async () => {
    await assert.rejects(
      verify({ workflow: strictWorkflow({ pull_requests: [] }) }),
      /workflow_pull_request_mismatch/,
    );
  });

  for (const [name, pull] of [
    ["fork", pullRequest("owner/repo", { number: 42, merged: false, state: "open", draft: false, head: { sha: HEAD, ref: "agent/release", repo: { full_name: "fork/repo" } } })],
    ["wrong head", pullRequest("owner/repo", { number: 42, merged: false, state: "open", draft: false, head: { sha: ALTERNATE, ref: "agent/release", repo: { full_name: "owner/repo" } } })],
    ["wrong base", pullRequest("owner/repo", { number: 42, merged: false, state: "open", draft: false, base: { sha: ALTERNATE, ref: "main", repo: { full_name: "owner/repo" } } })],
    ["draft", pullRequest("owner/repo", { number: 42, merged: false, state: "open", draft: true })],
    ["closed", pullRequest("owner/repo", { number: 42, merged: false, state: "closed", draft: false })],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(verify({ pull }), /workflow_pull_request_mismatch/);
    });
  }
});

test("strict workflow digest rotation permits only monotonic staged transitions", async (t) => {
  const candidatePolicy = Object.freeze({
    ...STRICT_POLICY,
    workflow: Object.freeze({
      ...STRICT_POLICY.workflow,
      candidate_sha256: WORKFLOW_CANDIDATE_SHA256,
    }),
  });
  const promotedPolicy = Object.freeze({
    ...candidatePolicy,
    workflow: Object.freeze({
      ...candidatePolicy.workflow,
      sha256: WORKFLOW_CANDIDATE_SHA256,
      candidate_sha256: null,
    }),
  });
  const verifySources = async ({
    baseSource,
    headSource,
    policy = candidatePolicy,
  }) => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictFetchWithWorkflowSources({ baseSource, headSource }),
      requiredChecksPolicyResolver: async () => policy,
      now: () => Date.parse(VERIFIED_AT),
    });
    return verifier({ ticket: strictTicket(), target_commit: TARGET });
  };

  await t.test("current/current is accepted", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_SOURCE,
      headSource: WORKFLOW_SOURCE,
      policy: STRICT_POLICY,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_SHA256, WORKFLOW_SHA256],
    );
  });

  await t.test("stage-A-candidate-policy keeps unchanged workflow A/A valid", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_SOURCE,
      headSource: WORKFLOW_SOURCE,
      policy: candidatePolicy,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_SHA256, WORKFLOW_SHA256],
    );
  });

  await t.test("stage-B-live-policy accepts PR A-to-B only with candidate", async () => {
    await assert.rejects(
      verifySources({
        baseSource: WORKFLOW_SOURCE,
        headSource: WORKFLOW_CANDIDATE_SOURCE,
        policy: STRICT_POLICY,
      }),
      /workflow_source_mismatch/,
    );
    const result = await verifySources({
      baseSource: WORKFLOW_SOURCE,
      headSource: WORKFLOW_CANDIDATE_SOURCE,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_SHA256, WORKFLOW_CANDIDATE_SHA256],
    );
  });

  await t.test("live candidate policy accepts B/B during promotion window", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_CANDIDATE_SOURCE,
      headSource: WORKFLOW_CANDIDATE_SOURCE,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_CANDIDATE_SHA256, WORKFLOW_CANDIDATE_SHA256],
    );
  });

  await t.test("post-promote-policy accepts B/B with candidate null", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_CANDIDATE_SOURCE,
      headSource: WORKFLOW_CANDIDATE_SOURCE,
      policy: promotedPolicy,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_CANDIDATE_SHA256, WORKFLOW_CANDIDATE_SHA256],
    );
    assert.equal(promotedPolicy.workflow.candidate_sha256, null);
  });

  await t.test("unknown digest is rejected", async () => {
    await assert.rejects(
      verifySources({
        baseSource: WORKFLOW_SOURCE,
        headSource: WORKFLOW_UNKNOWN_SOURCE,
      }),
      /workflow_source_mismatch/,
    );
  });

  await t.test("candidate-current-rollback is rejected", async () => {
    await assert.rejects(
      verifySources({
        baseSource: WORKFLOW_CANDIDATE_SOURCE,
        headSource: WORKFLOW_SOURCE,
      }),
      /workflow_source_rotation_mismatch/,
    );
  });
});

test("protected push workflow digest rotation attests base/head and remains monotonic", async (t) => {
  const candidatePolicy = Object.freeze({
    ...STRICT_POLICY,
    workflow: Object.freeze({
      ...STRICT_POLICY.workflow,
      candidate_sha256: WORKFLOW_CANDIDATE_SHA256,
    }),
  });
  const promotedPolicy = Object.freeze({
    ...candidatePolicy,
    workflow: Object.freeze({
      ...candidatePolicy.workflow,
      sha256: WORKFLOW_CANDIDATE_SHA256,
      candidate_sha256: null,
    }),
  });
  const verifySources = async ({
    baseSource,
    headSource,
    policy = candidatePolicy,
    ticket = strictProtectedPushTicket(),
  }) => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictProtectedPushFetch({
        baseSource,
        headSource,
        ticket,
      }),
      requiredChecksPolicyResolver: async () => policy,
      now: () => Date.parse(VERIFIED_AT),
    });
    return verifier({ ticket, target_commit: HEAD });
  };

  await t.test("A/A is accepted with exact remote-base and checks-head evidence", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_SOURCE,
      headSource: WORKFLOW_SOURCE,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => ({
        role: source.role,
        commit: source.commit,
        sha256: source.sha256,
      })),
      [
        { role: "base", commit: BASE, sha256: WORKFLOW_SHA256 },
        { role: "head", commit: HEAD, sha256: WORKFLOW_SHA256 },
      ],
    );
  });

  await t.test("A-to-B is accepted only when B is the staged candidate", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_SOURCE,
      headSource: WORKFLOW_CANDIDATE_SOURCE,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_SHA256, WORKFLOW_CANDIDATE_SHA256],
    );
  });

  await t.test("B/B is accepted during the current-A candidate-B window", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_CANDIDATE_SOURCE,
      headSource: WORKFLOW_CANDIDATE_SOURCE,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_CANDIDATE_SHA256, WORKFLOW_CANDIDATE_SHA256],
    );
  });

  await t.test("B/B is accepted after B is promoted and candidate is null", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_CANDIDATE_SOURCE,
      headSource: WORKFLOW_CANDIDATE_SOURCE,
      policy: promotedPolicy,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_CANDIDATE_SHA256, WORKFLOW_CANDIDATE_SHA256],
    );
  });

  await t.test("B-to-A rollback is rejected", async () => {
    await assert.rejects(
      verifySources({
        baseSource: WORKFLOW_CANDIDATE_SOURCE,
        headSource: WORKFLOW_SOURCE,
      }),
      /workflow_source_rotation_mismatch/,
    );
  });

  await t.test("unknown head digest is rejected", async () => {
    await assert.rejects(
      verifySources({
        baseSource: WORKFLOW_SOURCE,
        headSource: WORKFLOW_UNKNOWN_SOURCE,
      }),
      /workflow_source_mismatch/,
    );
  });

  await t.test("checks commit and protected source commit must be identical", async () => {
    const ticket = strictProtectedPushTicket();
    ticket.action.source_commit = ALTERNATE;
    await assert.rejects(
      verifySources({
        baseSource: WORKFLOW_SOURCE,
        headSource: WORKFLOW_SOURCE,
        ticket,
      }),
      /workflow_source_commit_mismatch/,
    );
  });
});

test("strict attestation binds the workflow run to the exact pull request and base", async (t) => {
  const cases = [
    ["number", { number: 999 }],
    ["URL repository", { url: "https://api.github.com/repos/attacker/repo/pulls/42" }],
    ["head ref", { head: { ref: "other-head", sha: HEAD } }],
    ["head commit", { head: { ref: "agent/release", sha: ALTERNATE } }],
    ["base ref", { base: { ref: "weak-base", sha: BASE } }],
    ["base commit", { base: { ref: "main", sha: ALTERNATE } }],
  ];
  for (const [name, mutation] of cases) {
    await t.test(name, async () => {
      const valid = strictWorkflow().pull_requests[0];
      const workflow = strictWorkflow({
        pull_requests: [{
          ...valid,
          ...mutation,
          head: mutation.head || valid.head,
          base: mutation.base || valid.base,
        }],
      });
      const verifier = createHostNativeExternalReadbackVerifier({
        fetchImpl: strictFetch({
          workflowById: new Map([[700, workflow]]),
        }),
        requiredChecksPolicyResolver: async () => STRICT_POLICY,
      });
      await assert.rejects(
        verifier({ ticket: strictTicket(), target_commit: TARGET }),
        /workflow_pull_request_mismatch/,
      );
    });
  }
});

test("strict attestation rejects a workflow file whose exact source is not policy-pinned", async () => {
  const verifier = createHostNativeExternalReadbackVerifier({
    fetchImpl: async (url, init) => {
      const root = "https://api.github.com/repos/owner/repo";
      if (
        url === `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${HEAD}`
      ) {
        return jsonResponse({
          type: "file",
          path: ".github/workflows/nyra-core-intelligence.yml",
          encoding: "base64",
          content: Buffer.from("name: attacker-controlled\n").toString("base64"),
        });
      }
      return strictFetch()(url, init);
    },
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
  });
  await assert.rejects(
    verifier({ ticket: strictTicket(), target_commit: TARGET }),
    /workflow_source_mismatch/,
  );
});

test("strict attestation rejects subset/superset, same-name foreign app, and mixed workflow runs", async () => {
  const subsetTicket = strictTicket();
  subsetTicket.release_manifest_binding.verification.required_checks =
    STRICT_POLICY.required_checks.slice(0, 2);
  const subsetVerifier = createHostNativeExternalReadbackVerifier({
    fetchImpl: strictFetch(),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
  });
  await assert.rejects(
    subsetVerifier({ ticket: subsetTicket, target_commit: TARGET }),
    /required_checks_policy_mismatch/,
  );

  const supersetTicket = strictTicket();
  supersetTicket.release_manifest_binding.verification.required_checks.push("spoof");
  await assert.rejects(
    subsetVerifier({ ticket: supersetTicket, target_commit: TARGET }),
    /required_checks_policy_mismatch/,
  );

  const foreignAppVerifier = createHostNativeExternalReadbackVerifier({
    fetchImpl: strictFetch({ checks: strictChecks({ wrongApp: true }) }),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
  });
  await assert.rejects(
    foreignAppVerifier({ ticket: strictTicket(), target_commit: TARGET }),
    /check_app_mismatch/,
  );

  const mixed = strictChecks();
  mixed.check_runs[2].details_url =
    "https://github.com/owner/repo/actions/runs/701/job/801";
  const mixedVerifier = createHostNativeExternalReadbackVerifier({
    fetchImpl: strictFetch({
      checks: mixed,
      workflowById: new Map([
        [700, strictWorkflow()],
        [701, strictWorkflow({ id: 701 })],
      ]),
    }),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
  });
  await assert.rejects(
    mixedVerifier({ ticket: strictTicket(), target_commit: TARGET }),
    /workflow_run_mixed/,
  );
});

test("strict attestation rejects details URL and workflow repo/path/id/head mismatches", async () => {
  const badDetails = strictChecks();
  badDetails.check_runs[0].details_url =
    "https://github.com/attacker/repo/actions/runs/700/job/800";
  const detailVerifier = createHostNativeExternalReadbackVerifier({
    fetchImpl: strictFetch({ checks: badDetails }),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
  });
  await assert.rejects(
    detailVerifier({ ticket: strictTicket(), target_commit: TARGET }),
    /details_url_invalid/,
  );

  for (const override of [
    { repository: { full_name: "attacker/repo" } },
    { path: ".github/workflows/spoof.yml" },
    { workflow_id: 9 },
    { head_sha: ALTERNATE },
  ]) {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictFetch({
        workflowById: new Map([[700, strictWorkflow(override)]]),
      }),
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
    });
    await assert.rejects(
      verifier({ ticket: strictTicket(), target_commit: TARGET }),
      /workflow_run_mismatch/,
    );
  }
});

function successFetch({
  ticket = mergeTicket(),
  calls = [],
  checkRuns = successfulChecks(),
  pull = pullRequest(ticket.repository),
  target = { sha: TARGET },
  rollback = { sha: BASE },
  healthByOrigin = new Map(),
} = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    const repositoryRoot = `https://api.github.com/repos/${ticket.repository}`;
    if (url === `${repositoryRoot}/commits/${HEAD}/check-runs?per_page=100`) {
      return jsonResponse(checkRuns);
    }
    if (url === `${repositoryRoot}/pulls/42`) return jsonResponse(pull);
    if (url === `${repositoryRoot}/git/ref/heads/release/v1`) {
      return jsonResponse({ object: { sha: TARGET } });
    }
    if (url === `${repositoryRoot}/git/commits/${TARGET}`) return jsonResponse(target);
    if (url === `${repositoryRoot}/git/commits/${BASE}`) return jsonResponse(rollback);
    if (url.endsWith("/healthz")) {
      const origin = url.slice(0, -"/healthz".length);
      const service = ticket.release_manifest_binding.services.find(
        (candidate) => candidate.origin === origin,
      );
      if (!service) throw new Error(`unexpected health URL: ${url}`);
      return jsonResponse(
        healthByOrigin.get(origin) || serviceHealth(service.service_id),
      );
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

test("external readback is tenant-scoped, uses fixed provider URLs, and proves every service", async () => {
  const ticket = mergeTicket({
    services: [
      {
        service_id: "service-b",
        environment: "production",
        origin: "https://service-b.onrender.com",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      },
      {
        service_id: "service-a",
        environment: "production",
        origin: "https://service-a.onrender.com",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      },
    ],
  });
  const calls = [];
  const credentialRequests = [];
  const verify = createHostNativeExternalReadbackVerifier({
    fetchImpl: successFetch({ ticket, calls }),
    githubTokenResolver: async (request) => {
      credentialRequests.push(request);
      return "tenant-a-private-token";
    },
    now: () => Date.parse(VERIFIED_AT),
  });

  const readback = await verify({ ticket, target_commit: TARGET });

  assert.deepEqual(credentialRequests, [{
    tenant_id: "tenant-a",
    repository: "owner/repo",
  }]);
  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map((call) => call.url), [
    `https://api.github.com/repos/owner/repo/commits/${HEAD}/check-runs?per_page=100`,
    "https://api.github.com/repos/owner/repo/pulls/42",
    `https://api.github.com/repos/owner/repo/git/commits/${TARGET}`,
    `https://api.github.com/repos/owner/repo/git/commits/${BASE}`,
    "https://service-b.onrender.com/healthz",
    "https://service-a.onrender.com/healthz",
  ]);
  for (const call of calls) {
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.redirect, "error");
    assert.ok(call.init.signal instanceof AbortSignal);
    if (call.url.startsWith("https://api.github.com/")) {
      assert.equal(call.init.headers.authorization, "Bearer tenant-a-private-token");
      assert.equal(call.init.headers["x-github-api-version"], "2022-11-28");
      assert.equal(
        call.init.headers["user-agent"],
        "skinharmony-universal-core-host-native-readback",
      );
    } else {
      assert.equal(call.init.headers.authorization, undefined);
      assert.equal(call.init.headers.accept, "application/json");
    }
  }

  assert.equal(readback.schema_version, "host_native_external_readback_v1");
  assert.equal(readback.trusted, true);
  assert.equal(readback.verified_at, VERIFIED_AT);
  assert.deepEqual(readback.services.map((service) => service.service_id), [
    "service-a",
    "service-b",
  ]);
  for (const service of readback.services) {
    assert.equal(service.live_commit, TARGET);
    assert.equal(service.rollback_commit, BASE);
    assert.equal(service.rollback_status, "previous_live_attested");
    const unsigned = { ...service };
    delete unsigned.readback_digest;
    assert.equal(service.readback_digest, hostNativeDigest(unsigned));
  }
  assert.equal(readback.github.head_branch, "agent/release");
  assert.equal(readback.github.base_branch, "main");
  assert.equal(readback.github.head_commit, HEAD);
  assert.equal(readback.github.expected_base_commit, BASE);
  assert.equal(readback.github.merge_commit, TARGET);
  assert.equal(readback.github.target_commit, TARGET);
  assert.equal(readback.github.rollback_commit, BASE);
  assert.deepEqual(readback.github.required_checks, [
    "deployment-parity",
    "unit-tests",
  ]);
  const unsignedGithub = { ...readback.github };
  delete unsignedGithub.readback_digest;
  assert.equal(readback.github.readback_digest, hostNativeDigest(unsignedGithub));
});

test("merge-only verification proves GitHub and checks without reading or claiming Render health", async () => {
  const ticket = mergeTicket({
    services: [{
      service_id: "service-a",
      environment: "production",
      origin: "https://service-a.onrender.com",
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    }],
  });
  const calls = [];
  const verify = createHostNativeExternalReadbackVerifier({
    fetchImpl: successFetch({ ticket, calls }),
    now: () => Date.parse(VERIFIED_AT),
  });
  const readback = await verify({
    ticket,
    target_commit: TARGET,
    verification_scope: "github_merge_and_checks_only",
  });

  assert.equal(readback.verification_scope, "github_merge_and_checks_only");
  assert.deepEqual(readback.services, []);
  assert.equal(readback.github.merged, true);
  assert.equal(readback.github.merge_commit, TARGET);
  assert.equal(calls.some(({ url }) => url.endsWith("/healthz")), false);
});

test("merge-only verification scope is rejected for non-merge actions", async () => {
  const ticket = branchTicket();
  const verify = createHostNativeExternalReadbackVerifier({
    fetchImpl: successFetch({ ticket }),
  });
  await assert.rejects(verify({
    ticket,
    target_commit: TARGET,
    verification_scope: "github_merge_and_checks_only",
  }), /trusted_readback_verification_scope_invalid/);
});

test("external readback binds previous-live evidence from the persisted action ticket", async (t) => {
  const persistedTicket = mergeTicket();
  assert.equal(persistedTicket.release_manifest_binding.join_resolution, undefined);
  assert.equal(
    persistedTicket.release_join_resolution_digest,
    hostNativeDigest(persistedTicket.release_join_resolution),
  );

  const readback = await createHostNativeExternalReadbackVerifier({
    fetchImpl: successFetch({ ticket: persistedTicket }),
  })({
    ticket: persistedTicket,
    target_commit: TARGET,
  });
  assert.equal(readback.services[0].rollback_commit, BASE);
  assert.equal(readback.services[0].rollback_status, "previous_live_attested");

  await t.test("missing persisted resolution fails closed", async () => {
    const ticket = mergeTicket();
    delete ticket.release_join_resolution;
    delete ticket.release_join_resolution_digest;
    await assert.rejects(
      createHostNativeExternalReadbackVerifier({
        fetchImpl: successFetch({ ticket }),
      })({ ticket, target_commit: TARGET }),
      /trusted_readback_render_health_mismatch/,
    );
  });

  await t.test("legacy manifest-binding evidence cannot substitute", async () => {
    const ticket = mergeTicket();
    ticket.release_manifest_binding.join_resolution = {
      previous_live_attestations:
        ticket.release_join_resolution.previous_live_attestations,
    };
    delete ticket.release_join_resolution;
    delete ticket.release_join_resolution_digest;
    await assert.rejects(
      createHostNativeExternalReadbackVerifier({
        fetchImpl: successFetch({ ticket }),
      })({ ticket, target_commit: TARGET }),
      /trusted_readback_render_health_mismatch/,
    );
  });

  for (const [name, mutate] of [
    ["wrong prior commit", (entry) => { entry.live_commit = ALTERNATE; }],
    ["wrong service identity", (entry) => { entry.service_id = "other-service"; }],
    ["wrong environment", (entry) => { entry.environment = "staging"; }],
    ["wrong origin", (entry) => { entry.origin = "https://other-service.onrender.com"; }],
  ]) {
    await t.test(name, async () => {
      const ticket = mergeTicket();
      mutate(ticket.release_join_resolution.previous_live_attestations[0]);
      ticket.release_join_resolution_digest = hostNativeDigest(ticket.release_join_resolution);
      await assert.rejects(
        createHostNativeExternalReadbackVerifier({
          fetchImpl: successFetch({ ticket }),
        })({ ticket, target_commit: TARGET }),
        /trusted_readback_render_health_mismatch/,
      );
    });
  }
});

test("production deploy readback keeps a non-selected service at its exact manifest target", async () => {
  const ticket = strictProductionDeployTicket();
  const verify = createHostNativeExternalReadbackVerifier({
    fetchImpl: strictProductionDeployFetch({ ticket }),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
  });
  const readback = await verify({ ticket, target_commit: HEAD });
  assert.equal(readback.github.target_commit, HEAD);
  assert.equal(readback.github.rollback_commit, BASE);
  assert.deepEqual(
    readback.services.map((service) => ({
      service_id: service.service_id,
      live_commit: service.live_commit,
      previous_live_commit: service.previous_live_commit,
      rollback_commit: service.rollback_commit,
    })),
    [
      {
        service_id: "service-a",
        live_commit: HEAD,
        previous_live_commit: BASE,
        rollback_commit: BASE,
      },
      {
        service_id: "service-b",
        live_commit: ALTERNATE,
        previous_live_commit: ALTERNATE,
        rollback_commit: BASE,
      },
    ],
  );
});

test("production deploy readback rejects a null target for any non-selected service", async () => {
  const ticket = strictProductionDeployTicket();
  ticket.release_manifest_binding.services.find((service) =>
    service.service_id === "service-b").target_commit = null;
  await assert.rejects(
    createHostNativeExternalReadbackVerifier({
      fetchImpl: strictProductionDeployFetch({ ticket }),
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
    })({ ticket, target_commit: HEAD }),
    /trusted_readback_services_invalid/,
  );
});

test("production deploy final readback requires the exact ReleaseJoin policy", async (t) => {
  await t.test("missing policy resolver", async () => {
    const ticket = strictProductionDeployTicket();
    await assert.rejects(
      createHostNativeExternalReadbackVerifier({
        fetchImpl: strictProductionDeployFetch({ ticket }),
      })({ ticket, target_commit: HEAD }),
      /trusted_readback_required_checks_policy_unavailable/,
    );
  });
  await t.test("substituted persisted digest", async () => {
    const ticket = strictProductionDeployTicket();
    ticket.release_join_resolution.required_checks_policy_digest = "0".repeat(64);
    ticket.release_join_resolution_digest = hostNativeDigest(ticket.release_join_resolution);
    await assert.rejects(
      createHostNativeExternalReadbackVerifier({
        fetchImpl: strictProductionDeployFetch({ ticket }),
        requiredChecksPolicyResolver: async () => STRICT_POLICY,
      })({ ticket, target_commit: HEAD }),
      /trusted_readback_required_checks_policy_mismatch/,
    );
  });
});

test("post-action compact commit identity readback remains size-bounded", async (t) => {
  const ticket = mergeTicket();
  const repositoryRoot = "https://api.github.com/repos/owner/repo";
  const targetUrl = `${repositoryRoot}/git/commits/${TARGET}`;
  const rollbackUrl = `${repositoryRoot}/git/commits/${BASE}`;

  await t.test("rejects an oversized declared target response", async () => {
    const calls = [];
    const fallback = successFetch({ ticket, calls });
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: async (url, init) => {
        if (url === targetUrl) {
          calls.push({ url, init });
          return jsonResponse({}, { headers: { "content-length": "256001" } });
        }
        return fallback(url, init);
      },
    });
    await assert.rejects(
      verifier({ ticket, target_commit: TARGET }),
      /trusted_readback_response_too_large/,
    );
    assert.equal(calls.at(-1)?.url, targetUrl);
  });

  await t.test("rejects an oversized streamed rollback response", async () => {
    const calls = [];
    const fallback = successFetch({ ticket, calls });
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: async (url, init) => {
        if (url === rollbackUrl) {
          calls.push({ url, init });
          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(200_000));
              controller.enqueue(new Uint8Array(60_001));
              controller.close();
            },
          });
          return new Response(body, {
            headers: { "content-type": "application/json" },
          });
        }
        return fallback(url, init);
      },
    });
    await assert.rejects(
      verifier({ ticket, target_commit: TARGET }),
      /trusted_readback_response_too_large/,
    );
    assert.deepEqual(calls.slice(-2).map((call) => call.url), [
      targetUrl,
      rollbackUrl,
    ]);
  });
});

test("private GitHub credentials remain isolated by tenant and never reach Render", async () => {
  const cases = [
    {
      ticket: mergeTicket({
        tenantId: "tenant-a",
        repository: "owner-a/repo-a",
        services: [{
          service_id: "tenant-a-service",
          environment: "production",
          origin: "https://tenant-a-service.onrender.com",
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        }],
      }),
      token: "token-a",
    },
    {
      ticket: mergeTicket({
        tenantId: "tenant-b",
        repository: "owner-b/repo-b",
        services: [{
          service_id: "tenant-b-service",
          environment: "production",
          origin: "https://tenant-b-service.onrender.com",
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        }],
      }),
      token: "token-b",
    },
  ];
  const credentialRequests = [];
  const calls = [];
  const verifier = createHostNativeExternalReadbackVerifier({
    githubTokenResolver: async (request) => {
      credentialRequests.push(request);
      const match = cases.find((candidate) =>
        candidate.ticket.tenant_id === request.tenant_id &&
        candidate.ticket.repository === request.repository);
      if (!match) throw new Error("cross-tenant credential request");
      return match.token;
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const match = cases.find((candidate) =>
        url.includes(`/repos/${candidate.ticket.repository}/`) ||
        url.startsWith(candidate.ticket.release_manifest_binding.services[0].origin));
      if (!match) throw new Error(`unexpected URL: ${url}`);
      return successFetch({ ticket: match.ticket })(url, init);
    },
  });

  await Promise.all(cases.map(({ ticket }) => verifier({
    ticket,
    target_commit: TARGET,
  })));

  assert.deepEqual(
    credentialRequests.sort((left, right) => left.tenant_id.localeCompare(right.tenant_id)),
    [
      { tenant_id: "tenant-a", repository: "owner-a/repo-a" },
      { tenant_id: "tenant-b", repository: "owner-b/repo-b" },
    ],
  );
  for (const { ticket, token } of cases) {
    const providerCalls = calls.filter((call) =>
      call.url.includes(`/repos/${ticket.repository}/`));
    assert.ok(providerCalls.length > 0);
    assert.ok(providerCalls.every((call) =>
      call.init.headers.authorization === `Bearer ${token}`));
    const healthCalls = calls.filter((call) =>
      call.url.startsWith(ticket.release_manifest_binding.services[0].origin));
    assert.equal(healthCalls.length, 1);
    assert.equal(healthCalls[0].init.headers.authorization, undefined);
  }
});

test("external readback rejects untrusted Render origins before contacting them", async (t) => {
  const invalidOrigins = [
    "http://service-a.onrender.com",
    "https://service-a.onrender.com/path",
    "https://service-a.onrender.com:443",
    "https://user:secret@service-a.onrender.com",
    "https://service-a.onrender.com?tenant=b",
    "https://service-a.onrender.com#fragment",
    "https://onrender.com",
    "https://service-a.example.com",
    "https://nested.service-a.onrender.com",
  ];
  for (const origin of invalidOrigins) {
    await t.test(origin, async () => {
      const ticket = mergeTicket({
        services: [{
          service_id: "service-a",
          environment: "production",
          origin,
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        }],
      });
      const calls = [];
      const verify = createHostNativeExternalReadbackVerifier({
        fetchImpl: successFetch({ ticket, calls }),
      });
      await assert.rejects(
        verify({ ticket, target_commit: TARGET }),
        /trusted_readback_render_origin_invalid/,
      );
      assert.equal(calls.length, 4);
      assert.ok(calls.every((call) => call.url.startsWith("https://api.github.com/")));
    });
  }
});

test("external readback enforces redirect, content type, size, stream, and timeout boundaries", async (t) => {
  const ticket = mergeTicket();
  const verifyWith = (fetchImpl, timeoutMs = 5_000) =>
    createHostNativeExternalReadbackVerifier({ fetchImpl, timeoutMs })({
      ticket,
      target_commit: TARGET,
    });

  await t.test("network failure", async () => {
    await assert.rejects(
      verifyWith(async () => {
        throw new Error("socket reset");
      }),
      /trusted_readback_unavailable/,
    );
  });

  await t.test("redirect response", async () => {
    let options;
    await assert.rejects(
      verifyWith(async (_url, init) => {
        options = init;
        return jsonResponse({}, { status: 302 });
      }),
      /trusted_readback_unavailable/,
    );
    assert.equal(options.redirect, "error");
  });

  await t.test("non-JSON response", async () => {
    await assert.rejects(
      verifyWith(async () => new Response("{}", {
        headers: { "content-type": "text/plain" },
      })),
      /trusted_readback_response_invalid/,
    );
  });

  await t.test("invalid JSON response", async () => {
    await assert.rejects(
      verifyWith(async () => new Response("{", {
        headers: { "content-type": "application/json" },
      })),
      /trusted_readback_response_invalid/,
    );
  });

  await t.test("declared oversized response", async () => {
    await assert.rejects(
      verifyWith(async () => jsonResponse({}, {
        headers: { "content-length": "256001" },
      })),
      /trusted_readback_response_too_large/,
    );
  });

  await t.test("streamed oversized response", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(200_000));
        controller.enqueue(new Uint8Array(60_001));
        controller.close();
      },
    });
    await assert.rejects(
      verifyWith(async () => new Response(body, {
        headers: { "content-type": "application/json" },
      })),
      /trusted_readback_response_too_large/,
    );
  });

  await t.test("body read remains covered by timeout", async () => {
    await assert.rejects(
      verifyWith(async (_url, init) => ({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        body: {
          getReader() {
            return {
              read() {
                return new Promise((_resolve, reject) => {
                  init.signal.addEventListener(
                    "abort",
                    () => reject(new Error("body aborted")),
                    { once: true },
                  );
                });
              },
              releaseLock() {},
            };
          },
        },
      }), 250),
      /trusted_readback_unavailable/,
    );
  });
});

test("required GitHub checks must match the exact commit and conclude success", async (t) => {
  const ticket = mergeTicket();
  const cases = [
    {
      name: "missing check",
      mutate: (payload) => ({
        ...payload,
        check_runs: payload.check_runs.filter((run) => run.name !== "unit-tests"),
      }),
    },
    {
      name: "wrong commit",
      mutate: (payload) => ({
        ...payload,
        check_runs: payload.check_runs.map((run) =>
          run.name === "unit-tests" ? { ...run, head_sha: ALTERNATE } : run),
      }),
    },
    {
      name: "not completed",
      mutate: (payload) => ({
        ...payload,
        check_runs: payload.check_runs.map((run) =>
          run.name === "unit-tests" ? { ...run, status: "in_progress" } : run),
      }),
    },
    ...["failure", "neutral", "skipped"].map((conclusion) => ({
      name: `conclusion ${conclusion}`,
      mutate: (payload) => ({
        ...payload,
        check_runs: payload.check_runs.map((run) =>
          run.name === "unit-tests" ? { ...run, conclusion } : run),
      }),
    })),
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const verify = createHostNativeExternalReadbackVerifier({
        fetchImpl: successFetch({
          ticket,
          checkRuns: scenario.mutate(successfulChecks()),
        }),
      });
      await assert.rejects(
        verify({ ticket, target_commit: TARGET }),
        /trusted_readback_checks_not_ready/,
      );
    });
  }
});

test("merge readback binds exact PR commits, refs, repository, and merge commit", async (t) => {
  const ticket = mergeTicket();
  const cases = [
    ["not merged", { merged: false }],
    ["merge commit", { merge_commit_sha: ALTERNATE }],
    ["head commit", { head: { ...pullRequest().head, sha: ALTERNATE } }],
    ["base commit", { base: { ...pullRequest().base, sha: ALTERNATE } }],
    ["head ref", { head: { ...pullRequest().head, ref: "attacker/head" } }],
    ["base ref", { base: { ...pullRequest().base, ref: "attacker/base" } }],
    ["head repository", {
      head: { ...pullRequest().head, repo: { full_name: "attacker/repo" } },
    }],
    ["base repository", {
      base: { ...pullRequest().base, repo: { full_name: "attacker/repo" } },
    }],
  ];
  for (const [name, mutation] of cases) {
    await t.test(name, async () => {
      const verify = createHostNativeExternalReadbackVerifier({
        fetchImpl: successFetch({
          ticket,
          pull: pullRequest(ticket.repository, mutation),
        }),
      });
      await assert.rejects(
        verify({ ticket, target_commit: TARGET }),
        /trusted_readback_github_merge_mismatch/,
      );
    });
  }
});

test("branch, target, rollback, and all Render health bindings are exact", async (t) => {
  const ticket = branchTicket();
  const calls = [];
  const verify = createHostNativeExternalReadbackVerifier({
    fetchImpl: successFetch({ ticket, calls }),
  });
  const readback = await verify({ ticket, target_commit: TARGET });
  assert.ok(calls.some((call) =>
    call.url === "https://api.github.com/repos/owner/repo/git/ref/heads/release/v1"));
  assert.ok(calls.some((call) =>
    call.url === `https://api.github.com/repos/owner/repo/git/commits/${TARGET}`));
  assert.ok(calls.some((call) =>
    call.url === `https://api.github.com/repos/owner/repo/git/commits/${BASE}`));
  assert.equal(readback.github.branch, "release/v1");
  assert.equal(readback.github.branch_commit, TARGET);

  await t.test("branch mismatch", async () => {
    const fetchImpl = async (url, init) => {
      if (url.endsWith("/git/ref/heads/release/v1")) {
        return jsonResponse({ object: { sha: ALTERNATE } });
      }
      return successFetch({ ticket })(url, init);
    };
    await assert.rejects(
      createHostNativeExternalReadbackVerifier({ fetchImpl })({
        ticket,
        target_commit: TARGET,
      }),
      /trusted_readback_branch_commit_mismatch/,
    );
  });

  await t.test("target commit mismatch", async () => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: successFetch({ ticket, target: { sha: ALTERNATE } }),
    });
    await assert.rejects(
      verifier({ ticket, target_commit: TARGET }),
      /trusted_readback_target_commit_mismatch/,
    );
  });

  await t.test("rollback commit mismatch", async () => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: successFetch({ ticket, rollback: { sha: ALTERNATE } }),
    });
    await assert.rejects(
      verifier({ ticket, target_commit: TARGET }),
      /trusted_readback_rollback_unavailable/,
    );
  });

  const healthCases = [
    ["ok", { ok: false }],
    ["render readiness", { render_ready: false }],
    ["commit verifiability", {
      build: {
        ...serviceHealth("service-a").build,
        commit_verifiable: false,
      },
    }],
    ["live commit", {
      build: {
        ...serviceHealth("service-a").build,
        commit_sha: ALTERNATE,
      },
    }],
    ["contract version", { health_contract_version: "other_contract" }],
    ["contract digest", { health_contract_digest: "f".repeat(64) }],
  ];
  for (const [name, mutation] of healthCases) {
    await t.test(`health ${name}`, async () => {
      const origin = ticket.release_manifest_binding.services[0].origin;
      const verifier = createHostNativeExternalReadbackVerifier({
        fetchImpl: successFetch({
          ticket,
          healthByOrigin: new Map([[
            origin,
            serviceHealth("service-a", mutation),
          ]]),
        }),
      });
      await assert.rejects(
        verifier({ ticket, target_commit: TARGET }),
        /trusted_readback_render_health_mismatch/,
      );
    });
  }
});

test("credential resolver failures fail closed before any provider request", async () => {
  let fetchCalls = 0;
  const verify = createHostNativeExternalReadbackVerifier({
    githubTokenResolver: async () => {
      throw new Error("tenant connector unavailable");
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({});
    },
  });
  await assert.rejects(
    verify({ ticket: mergeTicket(), target_commit: TARGET }),
    /trusted_readback_github_credential_unavailable/,
  );
  assert.equal(fetchCalls, 0);
});

function releaseJoinRequest(overrides = {}) {
  const sourceEvidence = {
    base_commit: BASE,
    head_commit: HEAD,
    tree_sha: TREE,
    changed_files: RELEASE_CHANGED_FILES,
  };
  sourceEvidence.diff_digest = hostNativeGithubDiffDigest({
    repository: "owner/repo",
    ...sourceEvidence,
  });
  return {
    core_join_verified: true,
    core_join_issued_at: "2026-07-29T11:59:00.000Z",
    verdict_id: "hnj_test",
    tenant_id: "tenant-a",
    work_id: "work-a",
    intent_anchor_digest: "a".repeat(64),
    repository: "owner/repo",
    checks_commit: HEAD,
    required_checks: ["deployment-parity", "unit-tests"],
    evidence_digest: "b".repeat(64),
    source_evidence: sourceEvidence,
    delivery_services: [{
      service_id: "service-a",
      environment: "production",
      origin: "https://service-a.onrender.com",
      expected_previous_commit: BASE,
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    }],
    rollback: {
      target_commit: BASE,
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      mode: "forward_revert",
      ready: true,
    },
    action: {
      kind: "github.merge",
      pull_request: 42,
      head_branch: "agent/release",
      base_branch: "main",
      head_commit: HEAD,
      expected_base_commit: BASE,
    },
    ...overrides,
  };
}

function releaseJoinFetch({
  treeSha = TREE,
  files = [{
    filename: RELEASE_CHANGED_FILES[0],
    status: "modified",
  }],
  healthOverrides = {},
} = {}) {
  return async (url) => {
    if (url.endsWith(`/git/commits/${HEAD}`)) {
      return jsonResponse({ sha: HEAD, tree: { sha: treeSha } });
    }
    if (url.endsWith(`/commits/${HEAD}/check-runs?per_page=100`)) {
      return jsonResponse(successfulChecks());
    }
    if (url.endsWith("/pulls/42")) {
      return jsonResponse(pullRequest("owner/repo", { merged: false }));
    }
    if (url.endsWith("/pulls/42/files?per_page=10&page=1")) {
      return jsonResponse(files);
    }
    if (url === "https://service-a.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-a", {
        build: {
          build_id: "previous-service-a",
          commit_sha: BASE,
          commit_verifiable: true,
        },
        ...healthOverrides,
      }));
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

function manualMergeJoinRequest(overrides = {}) {
  const githubUnsigned = {
    schema_version: "host_native_owner_manual_merge_github_readback_v1",
    trusted: true,
    source: "universal_core_github_readback",
    tenant_id: "tenant-a",
    repository: "owner/repo",
    pull_request: 42,
    merged: true,
    merged_at: VERIFIED_AT,
    head_branch: "agent/release",
    base_branch: "main",
    base_commit: BASE,
    head_commit: HEAD,
    merge_commit: TARGET,
    main_head_commit: TARGET,
    checks_commit: HEAD,
    checks_passed: true,
    required_checks: [...STRICT_POLICY.required_checks].sort(),
    observed_checks: [],
    required_checks_policy_digest: STRICT_POLICY_DIGEST,
    checks_attestation_digest: "8".repeat(64),
    workflow_sources: [],
    verified_at: VERIFIED_AT,
    external_side_effect: false,
    provider_execution: false,
  };
  const githubReadback = {
    ...githubUnsigned,
    readback_digest: hostNativeDigest(githubUnsigned),
  };
  const receiptUnsigned = {
    schema_version: "host_native_owner_manual_merge_readback_v1",
    receipt_id: `hnmmr_${"1".repeat(40)}`,
    tenant_id: "tenant-a",
    work_id: "work-a",
    intent_anchor_digest: "a".repeat(64),
    repository: "owner/repo",
    core_join_verdict_id: "hnj_test",
    core_join_record_digest: "2".repeat(64),
    pull_request: 42,
    github_readback: githubReadback,
    predecessor: { predecessor_type: "owner_manual_github_merge_readback" },
    owner_subject_fingerprint: `osf_${"3".repeat(64)}`,
    authority: "evidence_only",
    evidence_only: true,
    ticket_issued: false,
    retrospective_ticket_issued: false,
    action_authorized: false,
    execution_authorized: false,
    host_policy_override: false,
    provider_execution: false,
    recorded_at: VERIFIED_AT,
  };
  const receipt = {
    ...receiptUnsigned,
    receipt_digest: hostNativeDigest(receiptUnsigned),
    signature: "hnmmr_test_signature",
  };
  return releaseJoinRequest({
    required_checks: [...STRICT_POLICY.required_checks],
    required_checks_policy_digest: STRICT_POLICY_DIGEST,
    evidence_digest: receipt.receipt_digest,
    action: {
      kind: "render.observe",
      repository: "owner/repo",
      branch: "main",
      service_id: "service-a",
      environment: "production",
      target_commit: TARGET,
      release_manifest_digest: "4".repeat(64),
      provider_execution: false,
    },
    manual_merge_readback: receipt,
    ...overrides,
  });
}

function manualMergeJoinFetch({ mainHead = TARGET } = {}) {
  const fallback = strictFetch();
  return async (url, init) => {
    const root = "https://api.github.com/repos/owner/repo";
    if (url === `${root}/git/commits/${HEAD}`) {
      return jsonResponse({ sha: HEAD, tree: { sha: TREE } });
    }
    if (url === `${root}/pulls/42`) return jsonResponse(pullRequest());
    if (url === `${root}/pulls/42/files?per_page=10&page=1`) {
      return jsonResponse([{ filename: RELEASE_CHANGED_FILES[0], status: "modified" }]);
    }
    if (url === `${root}/git/ref/heads/main`) {
      return jsonResponse({ object: { sha: mainHead } });
    }
    if (url === "https://service-a.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-a", {
        build: {
          build_id: "previous-service-a",
          commit_sha: BASE,
          commit_verifiable: true,
        },
      }));
    }
    return fallback(url, init);
  };
}

function standingMergeJoinRequest(overrides = {}) {
  return releaseJoinRequest({
    required_checks: [...STRICT_POLICY.required_checks],
    required_checks_policy_digest: STRICT_POLICY_DIGEST,
    action: {
      ...releaseJoinRequest().action,
      merge_method: "merge",
    },
    ...overrides,
  });
}

function standingMergeJoinFetch({
  protection = {},
  protectionStatus = 200,
  rules = [],
  branchReadback = { name: "main", protected: true, commit: { sha: BASE } },
  comments = [],
  commentsStatus = 200,
  commits = [attributedPullCommit(HEAD, BASE)],
  commitPages = null,
  commitsStatus = 200,
  calls = null,
  reviews = [{
    id: 501,
    state: "APPROVED",
    commit_id: HEAD,
    submitted_at: VERIFIED_AT,
    user: { login: "reviewer-a" },
  }],
} = {}) {
  return async (url) => {
    calls?.push(url);
    const root = "https://api.github.com/repos/owner/repo";
    if (url === `${root}/git/commits/${HEAD}`) {
      return jsonResponse({ sha: HEAD, tree: { sha: TREE } });
    }
    if (url === `${root}/commits/${HEAD}/check-runs?per_page=100`) {
      return jsonResponse(strictChecks());
    }
    if (url === `${root}/actions/runs/700`) return jsonResponse(strictWorkflow());
    if ([
      `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${BASE}`,
      `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${HEAD}`,
    ].includes(url)) {
      return jsonResponse({
        type: "file",
        path: STRICT_POLICY.workflow.path,
        encoding: "base64",
        content: Buffer.from(WORKFLOW_SOURCE).toString("base64"),
      });
    }
    if (url === `${root}/pulls/42`) {
      return jsonResponse(pullRequest("owner/repo", {
        merged: false,
        state: "open",
        draft: false,
        user: { login: "author-a" },
      }));
    }
    if (url === `${root}/branches/main`) {
      return jsonResponse(branchReadback);
    }
    if (url === `${root}/branches/main/protection`) {
      return jsonResponse({
        required_status_checks: {
          strict: true,
          checks: STRICT_POLICY.required_checks.map((context) => ({
            context,
            app_id: STRICT_POLICY.check_app.id,
          })),
        },
        enforce_admins: { enabled: true },
        required_pull_request_reviews: {
          required_approving_review_count: 1,
          bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
        },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
        ...protection,
      }, { status: protectionStatus });
    }
    if (url === `${root}/rules/branches/main?per_page=100&page=1`) {
      return jsonResponse(rules);
    }
    if (url === `${root}/pulls/42/reviews?per_page=100&page=1`) {
      return jsonResponse(reviews);
    }
    if (url === `${root}/pulls/42/comments?per_page=100&page=1`) {
      return jsonResponse(comments, { status: commentsStatus });
    }
    if (url.startsWith(`${root}/pulls/42/commits?per_page=100&page=`)) {
      const page = Number(new URL(url).searchParams.get("page"));
      const payload = commitPages ? (commitPages[page - 1] || []) : (page === 1 ? commits : []);
      return jsonResponse(payload, { status: commitsStatus });
    }
    if (url === `${root}/pulls/42/files?per_page=10&page=1`) {
      return jsonResponse([{ filename: RELEASE_CHANGED_FILES[0], status: "modified" }]);
    }
    if (url === "https://service-a.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-a", {
        build: {
          build_id: "previous-service-a",
          commit_sha: BASE,
          commit_verifiable: true,
        },
      }));
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

function productionDeployJoinRequest(overrides = {}) {
  const serviceA = {
    service_id: "service-a",
    environment: "production",
    origin: "https://service-a.onrender.com",
    expected_previous_commit: BASE,
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  };
  const serviceB = {
    service_id: "service-b",
    environment: "production",
    origin: "https://service-b.onrender.com",
    expected_previous_commit: ALTERNATE,
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  };
  return releaseJoinRequest({
    required_checks: [...STRICT_POLICY.required_checks],
    required_checks_policy_digest: STRICT_POLICY_DIGEST,
    delivery_services: [serviceA, serviceB],
    action: {
      kind: "render.deploy",
      repository: "owner/repo",
      branch: "main",
      base_branch: "main",
      service_id: "service-a",
      environment: "production",
      source_commit: HEAD,
      target_commit: HEAD,
      expected_base_commit: BASE,
      expected_live_commit: BASE,
      provider_execution: false,
    },
    ...overrides,
  });
}

function productionDeployJoinFetch({
  refSha = HEAD,
  treeSha = TREE,
  compareFiles = [{ filename: RELEASE_CHANGED_FILES[0], status: "modified" }],
  workflow = strictWorkflow({
    event: "push",
    head_branch: "main",
    pull_requests: [],
  }),
} = {}) {
  return async (url) => {
    const root = "https://api.github.com/repos/owner/repo";
    if (url === `${root}/git/commits/${HEAD}`) {
      return jsonResponse({ sha: HEAD, tree: { sha: treeSha } });
    }
    if (url === `${root}/commits/${HEAD}/check-runs?per_page=100`) {
      return jsonResponse(strictChecks());
    }
    if (url === `${root}/actions/runs/700`) return jsonResponse(workflow);
    if ([
      `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${BASE}`,
      `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${HEAD}`,
    ].includes(url)) {
      return jsonResponse({
        type: "file",
        path: ".github/workflows/nyra-core-intelligence.yml",
        encoding: "base64",
        content: Buffer.from(WORKFLOW_SOURCE).toString("base64"),
      });
    }
    if (url === `${root}/git/ref/heads/main`) {
      return jsonResponse({ object: { sha: refSha } });
    }
    if (url === `${root}/compare/${BASE}...${HEAD}?per_page=10&page=1`) {
      return jsonResponse({
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        base_commit: { sha: BASE },
        merge_base_commit: { sha: BASE },
        head_commit: { sha: HEAD, commit: { tree: { sha: treeSha } } },
        commits: [{ sha: HEAD }],
        files: compareFiles,
      });
    }
    if (url === "https://service-a.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-a", {
        build: { build_id: "previous-service-a", commit_sha: BASE, commit_verifiable: true },
      }));
    }
    if (url === "https://service-b.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-b", {
        build: { build_id: "previous-service-b", commit_sha: ALTERNATE, commit_verifiable: true },
      }));
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

test("release-join resolver independently proves exact pre-merge GitHub state", async () => {
  const calls = [];
  const credentialRequests = [];
  const request = releaseJoinRequest();
  const resolver = createHostNativeReleaseJoinVerdictResolver({
    githubTokenResolver: async (scope) => {
      credentialRequests.push(scope);
      return "join-token";
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith(`/git/commits/${HEAD}`)) {
        return jsonResponse({ sha: HEAD, tree: { sha: TREE } });
      }
      if (url.endsWith(`/commits/${HEAD}/check-runs?per_page=100`)) {
        return jsonResponse(successfulChecks());
      }
      if (url.endsWith("/pulls/42")) {
        return jsonResponse(pullRequest("owner/repo", { merged: false }));
      }
      if (url.endsWith("/pulls/42/files?per_page=10&page=1")) {
        return jsonResponse([{
          filename: RELEASE_CHANGED_FILES[0],
          status: "modified",
        }]);
      }
      if (url === "https://service-a.onrender.com/healthz") {
        return jsonResponse(serviceHealth("service-a", {
          build: {
            build_id: "previous-service-a",
            commit_sha: BASE,
            commit_verifiable: true,
          },
        }));
      }
      throw new Error(`unexpected URL: ${url}`);
    },
    now: () => Date.parse(VERIFIED_AT),
  });

  const resolution = await resolver(request);

  assert.deepEqual(credentialRequests, [{
    tenant_id: "tenant-a",
    repository: "owner/repo",
  }]);
  assert.deepEqual(calls.map((call) => call.url), [
    `https://api.github.com/repos/owner/repo/git/commits/${HEAD}`,
    `https://api.github.com/repos/owner/repo/commits/${HEAD}/check-runs?per_page=100`,
    "https://api.github.com/repos/owner/repo/pulls/42",
    "https://api.github.com/repos/owner/repo/pulls/42/files?per_page=10&page=1",
    "https://service-a.onrender.com/healthz",
  ]);
  assert.ok(calls
    .filter((call) => call.url.startsWith("https://api.github.com/"))
    .every((call) => call.init.headers.authorization === "Bearer join-token"));
  assert.equal(
    calls.find((call) => call.url === "https://service-a.onrender.com/healthz")
      .init.headers.authorization,
    undefined,
  );
  assert.deepEqual(resolution, {
    schema_version: "host_native_release_join_resolution_v1",
    trusted: true,
    authority: "universal_core",
    allowed: true,
    verdict_id: "hnj_test",
    tenant_id: "tenant-a",
    work_id: "work-a",
    intent_anchor_digest: "a".repeat(64),
    repository: "owner/repo",
    checks_commit: HEAD,
    evidence_digest: "b".repeat(64),
    issued_at: "2026-07-29T11:59:00.000Z",
    resolved_at: VERIFIED_AT,
    source_attestation: resolution.source_attestation,
    previous_live_attestations: resolution.previous_live_attestations,
    pre_action_readback_digest: resolution.pre_action_readback_digest,
    provider_execution: false,
  });
});

test("standing merge readback is fresh and fails closed on protection or review drift", async (t) => {
  const resolve = (fetchImpl) => createHostNativeReleaseJoinVerdictResolver({
    fetchImpl,
    githubTokenResolver: async () => "standing-merge-token",
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
    now: () => Date.parse(VERIFIED_AT),
  })(standingMergeJoinRequest());

  const verified = await resolve(standingMergeJoinFetch());
  assert.equal(verified.pre_merge_readback.trusted, true);
  assert.equal(verified.pre_merge_readback.head_commit, HEAD);
  assert.equal(verified.pre_merge_readback.approved_reviews.length, 1);
  assert.equal(verified.required_checks_policy_digest, STRICT_POLICY_DIGEST);

  await t.test("protection drift", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protection: { enforce_admins: { enabled: false } },
    })),
    /release_join_verdict_pre_merge_protection_drift/,
  ));
  await t.test("review drift", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      reviews: [{
        id: 501,
        state: "APPROVED",
        commit_id: ALTERNATE,
        submitted_at: VERIFIED_AT,
        user: { login: "reviewer-a" },
      }],
    })),
    /release_join_verdict_pre_merge_review_not_approved/,
  ));
  await t.test("review ordering uses the latest authoritative state", async () => {
    const resolution = await resolve(standingMergeJoinFetch({
      reviews: [{
        id: 502,
        state: "APPROVED",
        commit_id: HEAD,
        submitted_at: VERIFIED_AT,
        user: { login: "reviewer-a" },
      }, {
        id: 501,
        state: "CHANGES_REQUESTED",
        commit_id: HEAD,
        submitted_at: "2026-07-29T11:59:00.000Z",
        user: { login: "reviewer-a" },
      }],
    }));
    assert.equal(resolution.pre_merge_readback.approved_reviews[0].review_id, 502);
  });
});

test("standing merge readback supports ruleset-only protection without weakening gates", async (t) => {
  const resolve = (fetchImpl) => createHostNativeReleaseJoinVerdictResolver({
    fetchImpl,
    githubTokenResolver: async () => "standing-merge-token",
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
    now: () => Date.parse(VERIFIED_AT),
  })(standingMergeJoinRequest());

  const verified = await resolve(standingMergeJoinFetch({
    protectionStatus: 404,
    rules: RULESET_ONLY_RULES,
  }));
  assert.equal(verified.pre_merge_readback.trusted, true);
  assert.equal(verified.pre_merge_readback.base_commit, BASE);
  assert.equal(verified.pre_merge_readback.approving_reviews_required, 1);
  assert.equal(verified.pre_merge_readback.thread_resolution_required, false);
  assert.equal(verified.pre_merge_readback.review_comment_count, null);
  assert.deepEqual(verified.pre_merge_readback.required_checks, STRICT_POLICY.required_checks);

  await t.test("missing ruleset checks", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: RULESET_ONLY_RULES.filter((rule) => rule.type !== "required_status_checks"),
    })),
    /release_join_verdict_pre_merge_ruleset_drift/,
  ));
  await t.test("missing ruleset review", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: RULESET_ONLY_RULES.filter((rule) => rule.type !== "pull_request"),
    })),
    /release_join_verdict_pre_merge_ruleset_drift/,
  ));
  await t.test("missing non-fast-forward protection", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: RULESET_ONLY_RULES.filter((rule) => rule.type !== "non_fast_forward"),
    })),
    /release_join_verdict_pre_merge_ruleset_drift/,
  ));
  await t.test("merge method must be admitted by the ruleset", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: RULESET_ONLY_RULES.map((rule) => rule.type === "pull_request" ? {
        ...rule,
        parameters: { ...rule.parameters, allowed_merge_methods: ["squash"] },
      } : rule),
    })),
    /release_join_verdict_pre_merge_ruleset_unsupported/,
  ));
  await t.test("wrong ruleset check app", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: RULESET_ONLY_RULES.map((rule) => rule.type === "required_status_checks" ? {
        ...rule,
        parameters: {
          ...rule.parameters,
          required_status_checks: rule.parameters.required_status_checks.map((check, index) =>
            index === 0 ? { ...check, integration_id: 999 } : check),
        },
      } : rule),
    })),
    /release_join_verdict_pre_merge_ruleset_drift/,
  ));
  await t.test("wrong ruleset checks", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: RULESET_ONLY_RULES.map((rule) => rule.type === "required_status_checks" ? {
        ...rule,
        parameters: {
          ...rule.parameters,
          required_status_checks: rule.parameters.required_status_checks.slice(1),
        },
      } : rule),
    })),
    /release_join_verdict_pre_merge_ruleset_drift/,
  ));
  await t.test("unsupported active rule", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: [...RULESET_ONLY_RULES, { ruleset_id: 901, type: "merge_queue" }],
    })),
    /release_join_verdict_pre_merge_ruleset_unsupported/,
  ));
  await t.test("unknown pull request parameter", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: RULESET_ONLY_RULES.map((rule) => rule.type === "pull_request" ? {
        ...rule,
        parameters: { ...rule.parameters, unknown_future_parameter: true },
      } : rule),
    })),
    /release_join_verdict_pre_merge_ruleset_unsupported/,
  ));
  await t.test("branch identity remains exact", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: RULESET_ONLY_RULES,
      branchReadback: { name: "main", protected: true, commit: { sha: ALTERNATE } },
    })),
    /release_join_verdict_pre_merge_protection_drift/,
  ));
  for (const status of [401, 403]) {
    await t.test(`classic protection ${status} remains unavailable`, async () => assert.rejects(
      resolve(standingMergeJoinFetch({ protectionStatus: status, rules: RULESET_ONLY_RULES })),
      /trusted_readback_unavailable/,
    ));
  }
});

test("ruleset-only zero-review policy proves thread resolution conservatively", async (t) => {
  const resolve = (fetchImpl) => createHostNativeReleaseJoinVerdictResolver({
    fetchImpl,
    githubTokenResolver: async () => "standing-merge-token",
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
    now: () => Date.parse(VERIFIED_AT),
  })(standingMergeJoinRequest());

  const verified = await resolve(standingMergeJoinFetch({
    protectionStatus: 404,
    rules: REAL_RULESET_ONLY_RULES,
    reviews: [],
    comments: [],
  }));
  assert.equal(verified.pre_merge_readback.approving_reviews_required, 0);
  assert.deepEqual(verified.pre_merge_readback.approved_reviews, []);
  assert.equal(verified.pre_merge_readback.thread_resolution_required, true);
  assert.equal(verified.pre_merge_readback.review_comment_count, 0);
  assert.equal(verified.pre_merge_readback.extra_approval_for_unattributed_changes_required, true);
  assert.equal(verified.pre_merge_readback.commit_count, 1);
  assert.equal(verified.pre_merge_readback.unattributed_commit_count, 0);

  await t.test("one review comment leaves thread resolution unproven", async () =>
    assert.rejects(resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: REAL_RULESET_ONLY_RULES,
      reviews: [],
      comments: [{ id: 7001, body: "unresolved or resolution state unavailable" }],
    })), /release_join_verdict_pre_merge_thread_resolution_unproven/));

  for (const status of [401, 403, 503]) {
    await t.test(`review comment readback ${status} remains unavailable`, async () =>
      assert.rejects(resolve(standingMergeJoinFetch({
        protectionStatus: 404,
        rules: REAL_RULESET_ONLY_RULES,
        reviews: [],
        commentsStatus: status,
      })), /trusted_readback_unavailable/));
  }

  await t.test("pull request rule remains mandatory", async () =>
    assert.rejects(resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: REAL_RULESET_ONLY_RULES.filter((rule) => rule.type !== "pull_request"),
      reviews: [],
    })), /release_join_verdict_pre_merge_ruleset_drift/));

  for (const identity of ["author", "committer"]) {
    await t.test(`null ${identity} remains unattributed`, async () => {
      const commit = attributedPullCommit(HEAD, BASE, { [identity]: null });
      await assert.rejects(resolve(standingMergeJoinFetch({
        protectionStatus: 404,
        rules: REAL_RULESET_ONLY_RULES,
        reviews: [],
        commits: [commit],
      })), /release_join_verdict_pre_merge_unattributed_changes_unproven/);
    });
  }

  await t.test("malformed verification object is unproven", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: REAL_RULESET_ONLY_RULES,
      reviews: [],
      commits: [attributedPullCommit(HEAD, BASE, { commit: { verification: null } })],
    })),
    /release_join_verdict_pre_merge_unattributed_changes_unproven/,
  ));

  await t.test("commit list must terminate at the PR head", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: REAL_RULESET_ONLY_RULES,
      reviews: [],
      commits: [attributedPullCommit(ALTERNATE, BASE)],
    })),
    /release_join_verdict_pre_merge_unattributed_changes_unproven/,
  ));

  await t.test("empty commit list is unproven", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: REAL_RULESET_ONLY_RULES,
      reviews: [],
      commits: [],
    })),
    /release_join_verdict_pre_merge_unattributed_changes_unproven/,
  ));

  await t.test("commit readback is complete across pages", async () => {
    const chain = attributedCommitChain(101);
    const resolution = await resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: REAL_RULESET_ONLY_RULES,
      reviews: [],
      commitPages: [chain.slice(0, 100), chain.slice(100)],
    }));
    assert.equal(resolution.pre_merge_readback.commit_count, 101);
    assert.equal(resolution.pre_merge_readback.unattributed_commit_count, 0);
  });

  await t.test("commit fetch error remains unproven", async () => assert.rejects(
    resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: REAL_RULESET_ONLY_RULES,
      reviews: [],
      commitsStatus: 503,
    })),
    /release_join_verdict_pre_merge_unattributed_changes_unproven/,
  ));

  await t.test("flag false performs no commit readback", async () => {
    const calls = [];
    const resolution = await resolve(standingMergeJoinFetch({
      protectionStatus: 404,
      rules: RULESET_ONLY_RULES,
      calls,
    }));
    assert.equal(
      calls.some((url) => url.includes("/pulls/42/commits?")),
      false,
    );
    assert.equal(
      resolution.pre_merge_readback.extra_approval_for_unattributed_changes_required,
      false,
    );
    assert.equal(resolution.pre_merge_readback.commit_count, null);
    assert.equal(resolution.pre_merge_readback.unattributed_commit_count, null);
  });
});

test("production deploy release-join proves exact push source and mixed previous-live state", async () => {
  const resolver = createHostNativeReleaseJoinVerdictResolver({
    fetchImpl: productionDeployJoinFetch(),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
    now: () => Date.parse(VERIFIED_AT),
  });
  const resolution = await resolver(productionDeployJoinRequest());
  assert.match(resolution.required_checks_policy_digest, /^[a-f0-9]{64}$/);
  assert.equal(resolution.source_attestation.evidence_kind, "github_compare_files");
  assert.equal(resolution.source_attestation.pull_request, null);
  assert.equal(resolution.source_attestation.base_commit, BASE);
  assert.equal(resolution.source_attestation.head_commit, HEAD);
  assert.equal(resolution.source_attestation.tree_sha, TREE);
  assert.deepEqual(
    resolution.previous_live_attestations.map(({ service_id, live_commit }) => ({
      service_id,
      live_commit,
    })),
    [
      { service_id: "service-a", live_commit: BASE },
      { service_id: "service-b", live_commit: ALTERNATE },
    ],
  );
});

test("manual merge observation release-join reattests persisted evidence and current main", async () => {
  const resolver = createHostNativeReleaseJoinVerdictResolver({
    fetchImpl: manualMergeJoinFetch(),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
    now: () => Date.parse(VERIFIED_AT),
  });
  const resolution = await resolver(manualMergeJoinRequest());
  assert.equal(resolution.source_attestation.evidence_kind,
    "github_manual_merge_readback");
  assert.equal(resolution.source_attestation.pull_request, 42);
  assert.equal(resolution.required_checks_policy_digest, STRICT_POLICY_DIGEST);
  assert.equal(resolution.trusted, true);
});

test("manual merge observation release-join rejects receipt tampering and current-main drift", async (t) => {
  await t.test("receipt", async () => {
    const request = manualMergeJoinRequest();
    request.manual_merge_readback.github_readback.merge_commit = ALTERNATE;
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: manualMergeJoinFetch(),
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
    });
    await assert.rejects(resolver(request),
      /release_join_verdict_manual_merge_readback_invalid/);
  });
  await t.test("main", async () => {
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: manualMergeJoinFetch({ mainHead: ALTERNATE }),
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
    });
    await assert.rejects(resolver(manualMergeJoinRequest()),
      /release_join_verdict_source_attestation_mismatch/);
  });
});

test("production deploy release-join fails closed on source, compare, or workflow drift", async (t) => {
  const resolve = (request, fetchImpl) => createHostNativeReleaseJoinVerdictResolver({
    fetchImpl,
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
  })(request);
  await t.test("missing required-check policy resolver", async () => assert.rejects(
    createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: productionDeployJoinFetch(),
    })(productionDeployJoinRequest()),
    /required_checks_policy_unavailable/,
  ));
  await t.test("Core-bound required-check policy digest", async () => assert.rejects(
    resolve(productionDeployJoinRequest({
      required_checks_policy_digest: "0".repeat(64),
    }), productionDeployJoinFetch()),
    /required_checks_policy_mismatch/,
  ));
  await t.test("main ref", async () => assert.rejects(
    resolve(productionDeployJoinRequest(), productionDeployJoinFetch({ refSha: ALTERNATE })),
    /release_join_verdict_source_attestation_mismatch/,
  ));
  await t.test("compare file set", async () => assert.rejects(
    resolve(productionDeployJoinRequest(), productionDeployJoinFetch({
      compareFiles: [{ filename: "forbidden/hidden.js", status: "added" }],
    })),
    /release_join_verdict_changed_files_mismatch/,
  ));
  await t.test("workflow event", async () => assert.rejects(
    resolve(productionDeployJoinRequest(), productionDeployJoinFetch({
      workflow: strictWorkflow(),
    })),
    /workflow_run_mismatch/,
  ));
  await t.test("source commit", async () => assert.rejects(
    resolve(productionDeployJoinRequest({
      action: { ...productionDeployJoinRequest().action, source_commit: ALTERNATE },
    }), productionDeployJoinFetch()),
    /workflow_source_commit_mismatch|release_join_verdict_action_invalid/,
  ));
});

test("release-join compact commit readback preserves fail-closed boundaries", async (t) => {
  const compactCommitUrl =
    `https://api.github.com/repos/owner/repo/git/commits/${HEAD}`;
  const resolverFor = (responseFactory, calls) =>
    createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return responseFactory();
      },
    });

  await t.test("rejects the legacy repository-commit tree shape", async () => {
    const calls = [];
    const resolver = resolverFor(
      () => jsonResponse({ sha: HEAD, commit: { tree: { sha: TREE } } }),
      calls,
    );
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /release_join_verdict_source_attestation_mismatch/,
    );
    assert.deepEqual(calls.map((call) => call.url), [compactCommitUrl]);
  });

  await t.test("rejects an oversized declared compact response", async () => {
    const calls = [];
    const resolver = resolverFor(
      () => jsonResponse({}, { headers: { "content-length": "256001" } }),
      calls,
    );
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /trusted_readback_response_too_large/,
    );
    assert.deepEqual(calls.map((call) => call.url), [compactCommitUrl]);
  });

  await t.test("rejects an oversized streamed compact response", async () => {
    const calls = [];
    const resolver = resolverFor(() => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(200_000));
          controller.enqueue(new Uint8Array(60_001));
          controller.close();
        },
      });
      return new Response(body, {
        headers: { "content-type": "application/json" },
      });
    }, calls);
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /trusted_readback_response_too_large/,
    );
    assert.deepEqual(calls.map((call) => call.url), [compactCommitUrl]);
  });
});

test("release-join source scope and previous-live evidence fail closed", async (t) => {
  await t.test("commit tree mismatch", async () => {
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: releaseJoinFetch({ treeSha: ALTERNATE }),
    });
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /release_join_verdict_source_attestation_mismatch/,
    );
  });

  await t.test("caller-hidden forbidden file", async () => {
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: releaseJoinFetch({
        files: [
          { filename: RELEASE_CHANGED_FILES[0], status: "modified" },
          { filename: ".github/workflows/hidden.yml", status: "added" },
        ],
      }),
    });
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /release_join_verdict_changed_files_mismatch/,
    );
  });

  await t.test("rename binds both source and destination paths", async () => {
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: releaseJoinFetch({
        files: [{
          filename: RELEASE_CHANGED_FILES[0],
          previous_filename: "forbidden/secret.js",
          status: "renamed",
        }],
      }),
    });
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /release_join_verdict_changed_files_mismatch/,
    );
  });

  await t.test("PR file pagination cannot hide a later path", async () => {
    const firstPage = [
      { filename: RELEASE_CHANGED_FILES[0], status: "modified" },
      ...Array.from({ length: 9 }, (_, index) => ({
        filename: `services/generated/file-${index}.js`,
        status: "added",
      })),
    ];
    const baseFetch = releaseJoinFetch();
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: async (url, init) => {
        if (url.endsWith("/pulls/42/files?per_page=10&page=1")) {
          return jsonResponse(firstPage);
        }
        if (url.endsWith("/pulls/42/files?per_page=10&page=2")) {
          return jsonResponse([{
            filename: ".github/workflows/later-hidden.yml",
            status: "added",
          }]);
        }
        return baseFetch(url, init);
      },
    });
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /release_join_verdict_changed_files_mismatch/,
    );
  });

  for (const [name, healthOverrides] of [
    ["wrong previous live commit", {
      build: {
        build_id: "wrong-previous",
        commit_sha: ALTERNATE,
        commit_verifiable: true,
      },
    }],
    ["unhealthy previous deployment", { ok: false }],
  ]) {
    await t.test(name, async () => {
      const resolver = createHostNativeReleaseJoinVerdictResolver({
        fetchImpl: releaseJoinFetch({ healthOverrides }),
      });
      await assert.rejects(
        resolver(releaseJoinRequest()),
        /release_join_verdict_previous_live_mismatch/,
      );
    });
  }
});

test("release-join resolver rejects untrusted, failed-check, or mismatched PR evidence", async (t) => {
  await t.test("untrusted Core join", async () => {
    let fetchCalls = 0;
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: async () => {
        fetchCalls += 1;
        return jsonResponse({});
      },
    });
    await assert.rejects(
      resolver(releaseJoinRequest({ core_join_verified: false })),
      /release_join_verdict_untrusted/,
    );
    assert.equal(fetchCalls, 0);
  });

  await t.test("failed required check", async () => {
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: async (url) => {
        if (url.endsWith(`/git/commits/${HEAD}`)) {
          return jsonResponse({ sha: HEAD, tree: { sha: TREE } });
        }
        if (url.includes("/check-runs")) {
          const checks = successfulChecks();
          checks.check_runs[0].conclusion = "failure";
          return jsonResponse(checks);
        }
        throw new Error(`unexpected URL: ${url}`);
      },
    });
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /trusted_readback_checks_not_ready/,
    );
  });

  const mismatches = [
    ["already merged", { merged: true }],
    ["head SHA", { head: { ...pullRequest().head, sha: ALTERNATE } }],
    ["base SHA", { base: { ...pullRequest().base, sha: ALTERNATE } }],
    ["head ref", { head: { ...pullRequest().head, ref: "attacker/head" } }],
    ["base ref", { base: { ...pullRequest().base, ref: "attacker/base" } }],
    ["head repository", {
      head: { ...pullRequest().head, repo: { full_name: "attacker/repo" } },
    }],
    ["base repository", {
      base: { ...pullRequest().base, repo: { full_name: "attacker/repo" } },
    }],
  ];
  for (const [name, mutation] of mismatches) {
    await t.test(name, async () => {
      const resolver = createHostNativeReleaseJoinVerdictResolver({
        fetchImpl: async (url) => {
          if (url.endsWith(`/git/commits/${HEAD}`)) {
            return jsonResponse({ sha: HEAD, tree: { sha: TREE } });
          }
          if (url.includes("/check-runs")) return jsonResponse(successfulChecks());
          if (url.endsWith("/pulls/42")) {
            return jsonResponse(pullRequest("owner/repo", {
              merged: false,
              ...mutation,
            }));
          }
          throw new Error(`unexpected URL: ${url}`);
        },
      });
      await assert.rejects(
        resolver(releaseJoinRequest()),
        /release_join_verdict_pull_request_mismatch/,
      );
    });
  }
});
