import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";
import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  buildHostReleaseManifestV2,
  createHostNativeGovernance,
  createInMemoryHostNativeGovernanceStore,
  hostNativeDigest,
  hostNativeGithubDiffDigest,
} from "../src/hostNativeGovernance.js";

const H = (value) => String(value).repeat(64);
const G = (value) => String(value).repeat(40);
const OWNER = `osf_${H("a")}`;
const MCP_TENANT_GATEWAY_KEY = "host-native-api-mcp-tenant-gateway-key";
const MCP_TENANT_CONTEXT_SECRET = "host-native-api-tenant-context-secret-0123456789";
const OWNER_CONTEXT_SIGNING_SECRET =
  "host-native-api-owner-context-secret-0123456789";
const CLOSURE_ATTESTATION_SECRET =
  "host-native-api-closure-attestation-secret-0123456789";
const API_REQUIRED_CHECKS_POLICY = Object.freeze({
  schema_version: "host_native_required_checks_policy_v1",
  tenant_id: "tenant-host-native",
  repository: "owner/repo",
  base_branch: "main",
  required_checks: ["unit-tests"],
  check_app: { id: 15368, slug: "github-actions", owner: "github" },
  workflow: {
    id: 312527659,
    name: "Nyra Core Intelligence",
    path: ".github/workflows/nyra-core-intelligence.yml",
    sha256: H("7"),
  },
  allowed_events: ["pull_request", "push"],
});

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function signedOwnerContext(key, tenantId, body, purpose) {
  const { owner_context: _ownerContext, ...payload } = body;
  const context = {
    assertion_version: "owner_context_assertion_v1",
    audience: "nira_core_bridge",
    tenant_id: tenantId,
    access_mode: "god_mode",
    role: "owner_root",
    delegated_actor: "host_native_api_test",
    owner_verified: true,
    owner_subject_fingerprint: OWNER,
    issued_at: new Date().toISOString(),
    binding_version: "owner_request_binding_v1",
    binding_hash: crypto.createHash("sha256")
      .update(`${purpose}\u0000${JSON.stringify(stableCanonical(payload))}`)
      .digest("hex"),
  };
  const canonical = JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
    owner_subject_fingerprint: context.owner_subject_fingerprint,
    issued_at: context.issued_at,
    binding_version: context.binding_version,
    binding_hash: context.binding_hash,
  });
  return {
    ...context,
    assertion: `ocs_${crypto.createHmac("sha256", key)
      .update(`owner-context\u0000${canonical}`)
      .digest("hex")}`,
  };
}

function signedTenantContext(secret, tenantId, overrides = {}) {
  const context = {
    version: "mcp_tenant_context_v1",
    tenant_id: tenantId,
    issued_at: new Date().toISOString(),
    ...overrides,
  };
  const canonical = JSON.stringify({
    version: context.version,
    tenant_id: context.tenant_id,
    issued_at: context.issued_at,
  });
  return Buffer.from(JSON.stringify({
    ...context,
    assertion: `mtc_${crypto.createHmac("sha256", secret)
      .update(`mcp-tenant-context\u0000${canonical}`)
      .digest("hex")}`,
  })).toString("base64url");
}

async function fixture(options, run) {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "host-native-api-admin";
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "host-native-api-"));
  const { app } = createUniversalCoreService({ storageRoot, ...options });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (
    method,
    pathname,
    body,
    key = "host-native-api-admin",
    additionalHeaders = {},
  ) => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...additionalHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };
  try {
    await run(request, { storageRoot });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(storageRoot, { recursive: true, force: true });
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
}

function delegationBody() {
  return {
    idempotency_key: "api-delegation-issue-1",
    tenant_id: "tenant-host-native",
    work_id: "work-api-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    audience: ["codex_native"],
    allowed_branches: ["agent/*", "main"],
    protected_branches: ["main"],
    allowed_path_prefixes: ["services/universal-core-service"],
    allowed_actions: ["git.commit", "github.merge"],
    budget: {
      max_agents: 3,
      max_parallel: 2,
      max_commits: 1,
      max_pushes: 1,
      max_deploys: 1,
      max_total_actions: 2,
    },
    release_policy: {
      manifest_required_for_protected_push: true,
      manifest_required_for_induced_deploy: true,
      manifest_required_for_deploy: true,
      independent_verifier_required: true,
      rollback_required: true,
      required_checks: ["unit-tests"],
    },
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    owner_confirmed: true,
    confirmation_reference: "owner approved bounded host-native API work",
  };
}

test("host-native execution consumers reject a Nyra pre-Core decision as a credential", async () => {
  await fixture({}, async (request) => {
    const response = await request("POST", "/v1/host-native/actions/authorize", {
      credential: { schema_version: "nyra_precore_decision_v1", authority_scope: "ADVISORY_NON_EXECUTABLE",
        execution_authorized: false, decision_id: "decision-a" },
    });
    assert.equal(response.status, 422);
    assert.equal(response.json.error.code, "nyra_precore_execution_credential_forbidden");
  });
});

function releaseManifest(coreJoinVerdictId = "join-api-1") {
  const changedFiles = ["services/universal-core-service/src/app.js"];
  return buildHostReleaseManifestV2({
    schema_version: "host_release_manifest_v2",
    manifest_id: "manifest-api-1",
    tenant_id: "tenant-host-native",
    work_id: "work-api-1",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    base_branch: "main",
    delivery_branch: "main",
    base_commit: G("1"),
    head_commit: G("4"),
    tree_sha: G("5"),
    diff_digest: hostNativeGithubDiffDigest({
      repository: "owner/repo",
      base_commit: G("1"),
      head_commit: G("4"),
      tree_sha: G("5"),
      changed_files: changedFiles,
    }),
    changed_files: changedFiles,
    verification: {
      builder_agent_id: "builder",
      verifier_agent_ids: ["verifier"],
      required_checks: ["unit-tests"],
      checks_commit: G("4"),
      checks_digest: H("5"),
      evidence_digest: H("6"),
      core_join_verdict_id: coreJoinVerdictId,
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
    rollback: {
      mode: "forward_revert",
      target_commit: G("1"),
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      ready: true,
    },
  });
}

function trustedReleaseJoinResolution(request) {
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
    issued_at: new Date().toISOString(),
    resolved_at: new Date().toISOString(),
    required_checks_policy_digest: request.required_checks_policy_digest,
    checks_attestation_digest: H("8"),
    source_attestation: sourceAttestation,
    previous_live_attestations: previousLiveAttestations,
    pre_action_readback_digest: hostNativeDigest({
      source_attestation: sourceAttestation,
      previous_live_attestations: previousLiveAttestations,
    }),
    provider_execution: false,
  };
}

function signedClosureAttestation(body) {
  const unsigned = {
    schema_version: "host_native_closure_attestation_v1",
    tenant_id: "tenant-host-native",
    work_id: body.work_id,
    repository: body.repository,
    core_plan_id: body.core_plan_id,
    core_plan_digest: body.core_plan_digest,
    local_plan_id: body.local_plan_id,
    local_plan_digest: body.local_plan_digest,
    evaluation_digest: body.evaluation_digest,
    target_commit: body.checks.commit,
    checks_digest: body.checks.checks_digest,
    acceptance_criteria: body.acceptance_criteria,
    report_bindings: [
      {
        task_id: "build",
        agent_id: body.builder_report.agent_id,
        task_kind: "builder",
        report_digest: body.builder_report.report_digest,
        native_session_fingerprint: "1".repeat(32),
        native_presence_signature: `ags_${"1".repeat(32)}`,
      },
      {
        task_id: "verify",
        agent_id: body.verifier_reports[0].agent_id,
        task_kind: "verifier",
        report_digest: body.verifier_reports[0].report_digest,
        native_session_fingerprint: "2".repeat(32),
        native_presence_signature: `ags_${"2".repeat(32)}`,
      },
    ],
    provider_execution: false,
    ...(body.core_join_renewal
      ? { core_join_renewal: body.core_join_renewal }
      : {}),
  };
  return {
    ...unsigned,
    signature: `hnca_${crypto.createHmac("sha256", CLOSURE_ATTESTATION_SECRET)
      .update(
        `host-native-closure-attestation-v1\u0000` +
        JSON.stringify(stableCanonical(unsigned)),
      )
      .digest("hex")}`,
  };
}

function trustedExternalReadback(ticket, targetCommit, verificationScope = "full_release") {
  const binding = ticket.release_manifest_binding;
  const action = ticket.action;
  const requiredChecks = [...binding.verification.required_checks];
  const workflowSources = binding.required_checks_policy_digest ? [
    {
      role: "base",
      path: API_REQUIRED_CHECKS_POLICY.workflow.path,
      commit: action.expected_base_commit,
      sha256: API_REQUIRED_CHECKS_POLICY.workflow.sha256,
    },
    {
      role: "head",
      path: API_REQUIRED_CHECKS_POLICY.workflow.path,
      commit: binding.verification.checks_commit,
      sha256: API_REQUIRED_CHECKS_POLICY.workflow.sha256,
    },
  ] : null;
  const workflowPullRequest = binding.required_checks_policy_digest ? {
    number: action.pull_request,
    url: `https://api.github.com/repos/${ticket.repository}/pulls/${action.pull_request}`,
    head_ref: action.head_branch,
    head_sha: action.head_commit,
    base_ref: action.base_branch,
    base_sha: action.expected_base_commit,
  } : null;
  const workflowSourcesDigest = binding.required_checks_policy_digest
    ? hostNativeDigest(
      workflowSources.map(({ role, commit, sha256 }) => ({ role, commit, sha256 })),
    )
    : null;
  const observedChecks = requiredChecks.map((name) => ({
    name,
    ...(binding.required_checks_policy_digest ? {
      check_run_id: 101,
      details_url: "https://github.com/owner/repo/actions/runs/700/job/800",
      app_id: 15368,
      app_slug: "github-actions",
      app_owner: "github",
      workflow_run_id: 700,
      workflow_run_attempt: 1,
      workflow_id: 312527659,
      workflow_name: "Nyra Core Intelligence",
      workflow_path: ".github/workflows/nyra-core-intelligence.yml",
      workflow_event: "pull_request",
      workflow_head_sha: binding.verification.checks_commit,
      workflow_repository: ticket.repository,
      workflow_source_sha256: workflowSourcesDigest,
      workflow_source_commits: workflowSources.map((source) => source.commit),
      workflow_pull_request: workflowPullRequest,
    } : {}),
    head_commit: binding.verification.checks_commit,
    status: "completed",
    conclusion: "success",
  }));
  const checksAttestationDigest = binding.required_checks_policy_digest
    ? hostNativeDigest({
      repository: ticket.repository,
      base_branch: binding.base_branch,
      checks_commit: binding.verification.checks_commit,
      required_checks_policy_digest: binding.required_checks_policy_digest,
      workflow_sources: workflowSources,
      workflow_pull_request: workflowPullRequest,
      observed_checks: observedChecks,
    })
    : null;
  const githubUnsigned = {
    api_origin: "https://api.github.com",
    repository: ticket.repository,
    action_kind: action.kind,
    head_branch: action.head_branch,
    base_branch: action.base_branch,
    pull_request: action.pull_request,
    merged: true,
    head_commit: action.head_commit,
    expected_base_commit: action.expected_base_commit,
    merge_commit: targetCommit,
    target_commit: targetCommit,
    branch: action.base_branch,
    branch_commit: null,
    checks_commit: binding.verification.checks_commit,
    checks_passed: true,
    required_checks: requiredChecks,
    observed_checks: observedChecks,
    ...(binding.required_checks_policy_digest ? {
      required_checks_policy_digest: binding.required_checks_policy_digest,
      checks_attestation_digest: checksAttestationDigest,
      workflow_sources: workflowSources,
      workflow_pull_request: workflowPullRequest,
    } : {}),
    rollback_commit: binding.rollback.target_commit,
    rollback_commit_available: true,
  };
  const services = (verificationScope === "github_merge_and_checks_only"
    ? []
    : binding.services).map((service) => {
    const unsigned = {
      service_id: service.service_id,
      environment: service.environment,
      origin: service.origin,
      health_path: "/healthz",
      deployment_id: "dep-api-1",
      live_commit: targetCommit,
      version: "api-test-1.0.0",
      health_status: "healthy",
      health_contract_digest: service.health_contract_digest,
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
    verified_at: new Date().toISOString(),
    github: { ...githubUnsigned, readback_digest: hostNativeDigest(githubUnsigned) },
    services,
    external_side_effect: false,
    provider_execution: false,
  };
}

test("host-native governance is fail-closed by default while planning remains provider-free", async () => {
  await fixture({}, async (request) => {
    const key = await request("POST", "/v1/keys/generate", {
      tenant_id: "tenant-host-native",
      key_type: "automation",
      allowed_scopes: ["read:decision", "automation:codex"],
    });
    const status = await request("GET", "/v1/host-native/status", undefined, key.json.key);
    assert.equal(status.status, 200);
    assert.equal(status.json.enabled, false);
    assert.equal(status.json.configured, false);
    assert.equal(status.json.restart_durable, false);
    const plan = await request("POST", "/v1/host-native/work-plans", {
      tenant_id: "tenant-host-native",
      work_id: "work-api-1",
      intent_anchor_digest: H("1"),
      repository: "owner/repo",
      objective: "Plan two host-native specialists.",
      required_checks: ["unit-tests"],
      max_parallel: 2,
      agents: [
        { agent_id: "builder", role: "builder", task: "Build.", depends_on: [], capabilities: [] },
        { agent_id: "verifier", role: "verifier", task: "Verify.", depends_on: ["builder"], capabilities: [] },
      ],
    }, key.json.key);
    assert.equal(plan.status, 201, JSON.stringify(plan.json));
    assert.equal(plan.json.plan.tenant_id, "tenant-host-native");
    assert.equal(plan.json.plan.provider_execution, false);
    assert.equal(plan.json.plan.provider_api_key_required, false);
    const unavailable = await request("POST", "/v1/host-native/actions/authorize", {}, key.json.key);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.json.error, "host_native_governance_unavailable");
  });
});

test("invalid server resolver registry disables host-native governance and readiness", async () => {
  await fixture({
    hostNativeGovernanceEnabled: true,
    hostNativeSigningSecret: "host-native-api-signing-secret-at-least-32-bytes",
    hostNativeRequiredChecksPolicyResolver: async () =>
      API_REQUIRED_CHECKS_POLICY,
    hostNativeResolverConfigurationValid: false,
    hostNativeResolverConfigurationError: "host_native_github_registry_invalid",
  }, async (request) => {
    const key = await request("POST", "/v1/keys/generate", {
      tenant_id: "tenant-host-native",
      key_type: "automation",
      allowed_scopes: ["read:decision", "automation:codex"],
    });
    const status = await request(
      "GET",
      "/v1/host-native/status",
      undefined,
      key.json.key,
    );
    assert.equal(status.status, 200);
    assert.equal(status.json.state, "resolver_configuration_invalid");
    assert.equal(status.json.configured, false);
    assert.equal(status.json.resolver_configuration_valid, false);
    const health = await request("GET", "/healthz");
    assert.equal(health.status, 503);
    assert.equal(health.json.render_ready, false);
    assert.equal(
      health.json.host_native_governance.state,
      "resolver_configuration_invalid",
    );
  });
});

test("enabled governance without a required-check registry is non-ready and blocks planning", async () => {
  await fixture({
    hostNativeGovernanceEnabled: true,
    hostNativeSigningSecret: "host-native-api-signing-secret-at-least-32-bytes",
  }, async (request) => {
    const key = await request("POST", "/v1/keys/generate", {
      tenant_id: "tenant-host-native",
      key_type: "automation",
      allowed_scopes: ["read:decision"],
    });
    const status = await request("GET", "/v1/host-native/status", undefined, key.json.key);
    assert.equal(status.json.state, "required_checks_policy_unavailable");
    assert.equal(status.json.configured, false);
    assert.equal((await request("GET", "/healthz")).status, 503);
    const plan = await request("POST", "/v1/host-native/work-plans", {
      work_id: "blocked",
    }, key.json.key);
    assert.equal(plan.status, 503);
  });
});

test("host-native routes use persistent state, one-shot owner proof and exact action tickets", async () => {
  await fixture({
    hostNativeGovernanceEnabled: true,
    hostNativeSigningSecret: "host-native-api-signing-secret-at-least-32-bytes",
    mcpTenantGatewayKey: MCP_TENANT_GATEWAY_KEY,
    tenantContextSigningSecret: MCP_TENANT_CONTEXT_SECRET,
    ownerContextSigningSecret: OWNER_CONTEXT_SIGNING_SECRET,
    dttAgentIdentitySigningSecret: CLOSURE_ATTESTATION_SECRET,
    hostNativeRequiredChecksPolicyResolver: async () =>
      API_REQUIRED_CHECKS_POLICY,
    // Server-side exact binding: release manifests are no longer permitted to
    // supply or synthesize their own Render origin.
    hostNativeRenderServiceOriginResolver: async ({
      tenant_id, repository, service_id, environment,
    }) => {
      if (
        tenant_id !== "tenant-host-native" || repository !== "owner/repo" ||
        service_id !== "srv-core" || environment !== "production"
      ) throw new Error("origin_not_bound");
      return "https://srv-core.onrender.com";
    },
    hostNativeExternalReadbackVerifier: async ({
      ticket, target_commit, verification_scope,
    }) => trustedExternalReadback(ticket, target_commit, verification_scope),
    hostNativeReleaseJoinVerdictResolver: async (request) =>
      trustedReleaseJoinResolution(request),
  }, async (request) => {
    const ownerKey = await request("POST", "/v1/keys/generate", {
      tenant_id: "tenant-host-native",
      key_type: "connector",
      allowed_scopes: ["read:decision", "owner:assertion"],
    });
    const automationKey = await request("POST", "/v1/keys/generate", {
      tenant_id: "tenant-host-native",
      key_type: "automation",
      allowed_scopes: ["read:decision", "automation:codex"],
    });
    const planInput = {
      work_id: "work-api-1",
      intent_anchor_digest: H("1"),
      repository: "owner/repo",
      base_branch: "main",
      objective: "Build and independently verify the bounded release.",
      required_checks: ["unit-tests"],
      max_parallel: 2,
      agents: [
        { agent_id: "builder", role: "builder", task: "Build.", depends_on: [], capabilities: [] },
        { agent_id: "verifier", role: "verifier", task: "Verify.", depends_on: ["builder"], capabilities: [] },
      ],
    };
    const planned = await request(
      "POST",
      "/v1/host-native/work-plans",
      planInput,
      automationKey.json.key,
    );
    assert.equal(planned.status, 201, JSON.stringify(planned.json));
    assert.match(planned.json.plan.required_checks_policy_digest, /^[a-f0-9]{64}$/);
    const rejectedPlan = await request(
      "POST",
      "/v1/host-native/work-plans",
      { ...planInput, required_checks: ["lint-only"] },
      automationKey.json.key,
    );
    assert.equal(rejectedPlan.status, 400);
    assert.equal(rejectedPlan.json.error, "required_checks_policy_mismatch");
    const body = delegationBody();
    const bearerSignedOwnerContext = signedOwnerContext(
      ownerKey.json.key,
      "tenant-host-native",
      body,
      "host_native_delegation_issue",
    );
    const bearerSignedOwnerDenied = await request(
      "POST",
      "/v1/host-native/delegations",
      {
        ...body,
        owner_context: bearerSignedOwnerContext,
      },
      ownerKey.json.key,
    );
    assert.equal(bearerSignedOwnerDenied.status, 400);
    assert.equal(
      bearerSignedOwnerDenied.json.error,
      "verified_owner_confirmation_required",
    );
    const ownerContext = signedOwnerContext(
      OWNER_CONTEXT_SIGNING_SECRET,
      "tenant-host-native",
      body,
      "host_native_delegation_issue",
    );
    const issued = await request("POST", "/v1/host-native/delegations", {
      ...body,
      owner_context: ownerContext,
    }, ownerKey.json.key);
    assert.equal(issued.status, 201, JSON.stringify(issued.json));
    assert.equal(issued.json.delegation.tenant_id, "tenant-host-native");
    assert.equal(issued.json.delegation.grant.provider_execution, false);

    const replay = await request("POST", "/v1/host-native/delegations", {
      ...body,
      owner_context: ownerContext,
    }, ownerKey.json.key);
    assert.equal(replay.status, 201);
    assert.equal(replay.json.delegation.delegation_id, issued.json.delegation.delegation_id);

    const ticket = await request("POST", "/v1/host-native/actions/authorize", {
      idempotency_key: "api-action-commit-1",
      delegation_id: issued.json.delegation.delegation_id,
      work_id: "work-api-1",
      intent_anchor_digest: H("1"),
      repository: "owner/repo",
      host_kind: "codex_native",
      host_session_fingerprint: "codex-api-session-1",
      action: {
        kind: "git.commit",
        repository: "owner/repo",
        branch: "agent/api-work",
        parent_commit: G("1"),
        tree_sha: G("2"),
        diff_digest: H("2"),
        changed_files: ["services/universal-core-service/src/app.js"],
        message_digest: H("3"),
        builder_agent_id: "builder",
        provider_execution: false,
      },
      evidence_digest: H("9"),
    }, automationKey.json.key);
    assert.equal(ticket.status, 201);
    assert.equal(ticket.json.action_ticket.ticket.max_uses, 1);
    const ticketId = ticket.json.action_ticket.ticket.ticket_id;
    const reserved = await request("POST", `/v1/host-native/actions/${ticketId}/reserve`, {
      idempotency_key: "api-reserve-commit-1",
      host_session_fingerprint: "codex-api-session-1",
    }, automationKey.json.key);
    assert.equal(reserved.status, 200);
    assert.equal(reserved.json.action_ticket.state, "reserved");
    const reserveReplay = await request("POST", `/v1/host-native/actions/${ticketId}/reserve`, {
      idempotency_key: "api-reserve-commit-1",
      host_session_fingerprint: "codex-api-session-1",
    }, automationKey.json.key);
    assert.equal(reserveReplay.status, 200);
    assert.equal(
      reserveReplay.json.action_ticket.reservation_id,
      reserved.json.action_ticket.reservation_id,
    );
    const reserveDifferentKey = await request("POST", `/v1/host-native/actions/${ticketId}/reserve`, {
      idempotency_key: "api-reserve-commit-2",
      host_session_fingerprint: "codex-api-session-1",
    }, automationKey.json.key);
    assert.equal(reserveDifferentKey.status, 409);

    const pendingManifest = releaseManifest();
    const {
      manifest_digest: _pendingManifestDigest,
      schema_version: _pendingManifestVersion,
      manifest_id: _pendingManifestId,
      verification: pendingVerification,
      ...pendingReleaseFields
    } = pendingManifest;
    const {
      core_join_verdict_id: _pendingCoreJoinVerdictId,
      ...pendingReleaseVerification
    } = pendingVerification;
    const releaseIntent = await request("POST", "/v1/host-native/release-intents", {
      ...pendingReleaseFields,
      verification: pendingReleaseVerification,
    }, automationKey.json.key);
    assert.equal(releaseIntent.status, 201, JSON.stringify(releaseIntent.json));
    assert.match(releaseIntent.json.release_intent.release_intent_digest, /^[a-f0-9]{64}$/);

    const coreJoinBody = {
      idempotency_key: "api-core-join-1",
      work_id: "work-api-1",
      intent_anchor_digest: H("1"),
      repository: "owner/repo",
      core_plan_id: `hnp_${H("a").slice(0, 40)}`,
      core_plan_digest: H("a"),
      local_plan_id: "local-plan-api-1",
      local_plan_digest: H("b"),
      evaluation_digest: H("6"),
      acceptance_criteria: [{
        criterion_id: "api-tests-green",
        evidence_digest: H("c"),
        proven: true,
      }],
      builder_report: {
        agent_id: "builder",
        report_digest: H("d"),
        target_commit: G("4"),
      },
      verifier_reports: [{
        agent_id: "verifier",
        report_digest: H("e"),
        reviewed_commit: G("4"),
        approved: true,
      }],
      checks: {
        commit: G("4"),
        required_checks: ["unit-tests"],
        checks_digest: H("5"),
        evidence_digest: H("f"),
      },
      release_intent: releaseIntent.json.release_intent,
      provider_execution: false,
    };
    coreJoinBody.closure_attestation = signedClosureAttestation(coreJoinBody);
    const arbitraryAutomationJoin = await request(
      "POST",
      "/v1/host-native/core-join-verdicts",
      coreJoinBody,
      automationKey.json.key,
    );
    assert.equal(arbitraryAutomationJoin.status, 403);
    assert.equal(
      arbitraryAutomationJoin.json.error,
      "core_join_mcp_gateway_required",
    );
    const missingTenantContextJoin = await request(
      "POST",
      "/v1/host-native/core-join-verdicts",
      coreJoinBody,
      MCP_TENANT_GATEWAY_KEY,
      { "x-sh-tenant-id": "tenant-host-native" },
    );
    assert.equal(missingTenantContextJoin.status, 403);
    assert.equal(missingTenantContextJoin.json.error, "tenant_scope_denied");
    const wrongTenantContextJoin = await request(
      "POST",
      "/v1/host-native/core-join-verdicts",
      coreJoinBody,
      MCP_TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": "tenant-host-native",
        "x-sh-tenant-context": signedTenantContext(
          MCP_TENANT_CONTEXT_SECRET,
          "tenant-other",
        ),
      },
    );
    assert.equal(wrongTenantContextJoin.status, 403);
    assert.equal(wrongTenantContextJoin.json.error, "tenant_scope_denied");
    const ownerSecretTenantContextJoin = await request(
      "POST",
      "/v1/host-native/core-join-verdicts",
      coreJoinBody,
      MCP_TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": "tenant-host-native",
        "x-sh-tenant-context": signedTenantContext(
          OWNER_CONTEXT_SIGNING_SECRET,
          "tenant-host-native",
        ),
      },
    );
    assert.equal(ownerSecretTenantContextJoin.status, 403);
    assert.equal(ownerSecretTenantContextJoin.json.error, "tenant_scope_denied");
    const gatewayHeaders = {
      "x-sh-tenant-id": "tenant-host-native",
      "x-sh-tenant-context": signedTenantContext(
        MCP_TENANT_CONTEXT_SECRET,
        "tenant-host-native",
      ),
    };
    const renewalMarker = {
      schema_version: "continuity_core_join_renewal_v1",
      predecessor_verdict_id: `hnj_${H("9").slice(0, 40)}`,
      predecessor_claim_digest: H("8"),
      predecessor_release_intent_digest:
        releaseIntent.json.release_intent.release_intent_digest,
      predecessor_record_digest: H("7"),
      generation: 1,
    };
    const renewalBody = {
      ...coreJoinBody,
      idempotency_key: "api-core-join-renewal-route",
      core_join_renewal: renewalMarker,
    };
    renewalBody.closure_attestation = signedClosureAttestation(renewalBody);
    const renewalOnOrdinaryRoute = await request(
      "POST",
      "/v1/host-native/core-join-verdicts",
      renewalBody,
      MCP_TENANT_GATEWAY_KEY,
      gatewayHeaders,
    );
    assert.equal(renewalOnOrdinaryRoute.status, 400);
    assert.equal(
      renewalOnOrdinaryRoute.json.error,
      "core_join_renewal_route_required",
    );
    const callerInjectedRenewal = await request(
      "POST",
      `/v1/host-native/core-join-verdicts/${renewalMarker.predecessor_verdict_id}/renew`,
      renewalBody,
      MCP_TENANT_GATEWAY_KEY,
      gatewayHeaders,
    );
    assert.equal(callerInjectedRenewal.status, 400);
    assert.equal(
      callerInjectedRenewal.json.error,
      "core_join_renewal_caller_field_denied",
    );
    const mismatchedRenewalRoute = await request(
      "POST",
      `/v1/host-native/core-join-verdicts/hnj_${H("6").slice(0, 40)}/renew`,
      {
        ...renewalBody,
        core_join_renewal: undefined,
      },
      MCP_TENANT_GATEWAY_KEY,
      gatewayHeaders,
    );
    assert.equal(mismatchedRenewalRoute.status, 400);
    assert.equal(
      mismatchedRenewalRoute.json.error,
      "core_join_renewal_route_mismatch",
    );
    const mismatchedBodyTenantJoin = await request(
      "POST",
      "/v1/host-native/core-join-verdicts",
      { ...coreJoinBody, tenant_id: "tenant-other" },
      MCP_TENANT_GATEWAY_KEY,
      gatewayHeaders,
    );
    assert.equal(mismatchedBodyTenantJoin.status, 403);
    assert.equal(mismatchedBodyTenantJoin.json.error, "tenant_scope_denied");
    const tamperedClosureJoin = await request(
      "POST",
      "/v1/host-native/core-join-verdicts",
      {
        ...coreJoinBody,
        idempotency_key: "api-core-join-tampered-closure",
        closure_attestation: {
          ...coreJoinBody.closure_attestation,
          report_bindings: coreJoinBody.closure_attestation.report_bindings.map(
            (binding, index) => index === 0
              ? { ...binding, native_session_fingerprint: "f".repeat(32) }
              : binding,
          ),
        },
      },
      MCP_TENANT_GATEWAY_KEY,
      gatewayHeaders,
    );
    assert.equal(
      tamperedClosureJoin.status,
      403,
      JSON.stringify(tamperedClosureJoin.json),
    );
    assert.equal(
      tamperedClosureJoin.json.error,
      "core_join_closure_attestation_signature_invalid",
    );
    const coreJoin = await request(
      "POST",
      "/v1/host-native/core-join-verdicts",
      coreJoinBody,
      MCP_TENANT_GATEWAY_KEY,
      gatewayHeaders,
    );
    assert.equal(coreJoin.status, 201, JSON.stringify(coreJoin.json));
    const coreJoinVerdictId = coreJoin.json.core_join_verdict.verdict.verdict_id;
    const coreJoinReplay = await request(
      "POST",
      "/v1/host-native/core-join-verdicts",
      coreJoinBody,
      MCP_TENANT_GATEWAY_KEY,
      gatewayHeaders,
    );
    assert.equal(coreJoinReplay.status, 201);
    assert.equal(
      coreJoinReplay.json.core_join_verdict.verdict.verdict_id,
      coreJoinVerdictId,
    );
    const coreJoinConflict = await request(
      "POST",
      "/v1/host-native/core-join-verdicts",
      { ...coreJoinBody, evaluation_digest: H("5") },
      MCP_TENANT_GATEWAY_KEY,
      gatewayHeaders,
    );
    assert.equal(coreJoinConflict.status, 409);
    assert.equal(coreJoinConflict.json.error, "idempotency_key_conflict");

    const mergeTicket = await request("POST", "/v1/host-native/actions/authorize", {
      idempotency_key: "api-action-merge-1",
      delegation_id: issued.json.delegation.delegation_id,
      work_id: "work-api-1",
      intent_anchor_digest: H("1"),
      repository: "owner/repo",
      host_kind: "codex_native",
      host_session_fingerprint: "codex-api-session-merge",
      action: {
        kind: "github.merge",
        repository: "owner/repo",
        head_branch: "agent/api-work",
        base_branch: "main",
        pull_request: 42,
        head_commit: G("4"),
        expected_base_commit: G("1"),
        merge_method: "merge",
        checks_verified: true,
        checks_commit: G("4"),
        force: false,
        delete_ref: false,
        tags: false,
        induced_effects: [{
          service_id: "srv-core",
          environment: "production",
          trigger: "github_auto_deploy",
        }],
        provider_execution: false,
      },
      evidence_digest: H("6"),
      release_manifest: releaseManifest(coreJoinVerdictId),
    }, automationKey.json.key);
    assert.equal(mergeTicket.status, 201, JSON.stringify(mergeTicket.json));
    const mergeTicketId = mergeTicket.json.action_ticket.ticket.ticket_id;
    const consumedJoin = await request(
      "GET",
      `/v1/host-native/core-join-verdicts/${coreJoinVerdictId}`,
      undefined,
      automationKey.json.key,
    );
    assert.equal(consumedJoin.status, 200);
    assert.equal(consumedJoin.json.core_join_verdict.state, "active");
    assert.equal(consumedJoin.json.core_join_verdict.uses, 0);
    const mergeReservation = await request(
      "POST",
      `/v1/host-native/actions/${mergeTicketId}/reserve`,
      {
        idempotency_key: "api-reserve-merge-1",
        host_session_fingerprint: "codex-api-session-merge",
      },
      automationKey.json.key,
    );
    assert.equal(mergeReservation.status, 200);
    const reservedJoin = await request(
      "GET",
      `/v1/host-native/core-join-verdicts/${coreJoinVerdictId}`,
      undefined,
      automationKey.json.key,
    );
    assert.equal(reservedJoin.status, 200);
    assert.equal(reservedJoin.json.core_join_verdict.state, "consumed");
    assert.equal(reservedJoin.json.core_join_verdict.uses, 1);
    assert.equal(
      reservedJoin.json.core_join_verdict.consumed_by_ticket_id,
      mergeTicketId,
    );
    const mergeReadbackDigest = H("c");
    const mergeCompletion = await request(
      "POST",
      `/v1/host-native/actions/${mergeTicketId}/complete`,
      {
        idempotency_key: "api-complete-merge-1",
        reservation_id: mergeReservation.json.action_ticket.reservation_id,
        host_session_fingerprint: "codex-api-session-merge",
        outcome: "success",
        result_digest: H("b"),
        result_commit: G("9"),
        readback_digest: mergeReadbackDigest,
      },
      automationKey.json.key,
    );
    assert.equal(mergeCompletion.status, 200, JSON.stringify(mergeCompletion.json));
    assert.equal(mergeCompletion.json.action_ticket.result_commit_verified, false);
    const finalize = await request(
      "POST",
      `/v1/host-native/actions/${mergeTicketId}/authorize-finalize`,
      { host_session_fingerprint: "codex-api-session-merge" },
      automationKey.json.key,
    );
    assert.equal(finalize.status, 200, JSON.stringify(finalize.json));
    assert.equal(finalize.json.finalize_authorization.allowed, true);
    assert.equal(finalize.json.finalize_authorization.target_commit, G("9"));
    assert.equal(finalize.json.finalize_authorization.action_ticket_id, mergeTicketId);
    assert.equal(finalize.json.finalize_authorization.result_commit_verified, true);
    assert.equal(
      finalize.json.finalize_authorization.verification_scope,
      "github_merge_and_checks_only",
    );
    assert.equal(finalize.json.finalize_authorization.services_verified, false);
    assert.deepEqual(finalize.json.finalize_authorization.live_services, []);
    assert.match(
      finalize.json.finalize_authorization.external_readback_digest,
      /^[a-f0-9]{64}$/,
    );

    const health = await request("GET", "/healthz");
    assert.equal(health.json.host_native_governance.route_ready, true);
    assert.equal(health.json.host_native_governance.store_backend, "file_atomic");
    assert.equal(health.json.host_native_governance.restart_durable, true);
    assert.equal(health.json.host_native_governance.trusted_readback_configured, true);
    assert.equal(
      health.json.host_native_governance.release_join_verdict_resolver_configured,
      true,
    );
    assert.equal(
      health.json.host_native_governance.render_service_origin_resolver_configured,
      true,
    );
    assert.equal(
      health.json.host_native_governance.render_origin_resolver_state,
      "exact_registry_only",
    );
    assert.equal(health.json.host_native_governance.caller_supplied_github_token_allowed, false);
    assert.equal(health.json.host_native_governance.provider_execution, false);
  });
});

test("release check rejects legacy signed booleans and prefers canonical v2 integrity", async () => {
  await fixture({}, async (request) => {
    const key = await request("POST", "/v1/keys/generate", {
      tenant_id: "tenant-host-native",
      key_type: "automation",
      allowed_scopes: ["read:decision", "policy:check"],
    });
    const legacy = await request("POST", "/v1/releases/manifest/check", {
      version: "1.0.0",
      channel: "stable",
      package_url: "https://example.invalid/release.zip",
      checksum_sha256: H("a"),
      rollback_url: "https://example.invalid/rollback.zip",
      signed: true,
    }, key.json.key);
    assert.equal(legacy.status, 200, JSON.stringify(legacy.json));
    assert.equal(legacy.json.result.status, "review_required");
    assert.equal(legacy.json.result.manifest.signed, false);
    assert.equal(legacy.json.result.manifest.signature_verified, false);
    assert(legacy.json.result.issues.some((issue) => issue.code === "manifest_signature_unverified"));

    const current = await request("POST", "/v1/releases/manifest/check", {
      manifest: releaseManifest(),
    }, key.json.key);
    assert.equal(current.status, 200);
    assert.equal(current.json.result.status, "ready");
    assert.equal(current.json.result.execution_allowed, false);
    assert.equal(current.json.result.manifest.integrity_verified, true);
  });
});

test("expired Core join renews through the dedicated tenant-gateway route", async () => {
  let nowValue = Date.parse("2026-08-31T12:00:00.000Z");
  const governance = createHostNativeGovernance({
    store: createInMemoryHostNativeGovernanceStore(),
    signingSecret: "host-native-api-signing-secret-at-least-32-bytes",
    closureAttestationSigningSecret: CLOSURE_ATTESTATION_SECRET,
    requiredChecksPolicyResolver: async () => API_REQUIRED_CHECKS_POLICY,
    now: () => nowValue,
    coreJoinTtlMs: 1_000,
  });

  await fixture({
    hostNativeGovernanceEnabled: true,
    hostNativeGovernance: governance,
    mcpTenantGatewayKey: MCP_TENANT_GATEWAY_KEY,
    tenantContextSigningSecret: MCP_TENANT_CONTEXT_SECRET,
  }, async (request) => {
    const automationKey = await request("POST", "/v1/keys/generate", {
      tenant_id: "tenant-host-native",
      key_type: "automation",
      allowed_scopes: ["read:decision", "automation:codex"],
    });
    const pendingManifest = releaseManifest();
    const {
      manifest_digest: _manifestDigest,
      schema_version: _manifestVersion,
      manifest_id: _manifestId,
      verification,
      ...releaseFields
    } = pendingManifest;
    const {
      core_join_verdict_id: _pendingVerdictId,
      ...releaseVerification
    } = verification;
    const releaseIntent = await request("POST", "/v1/host-native/release-intents", {
      ...releaseFields,
      verification: releaseVerification,
    }, automationKey.json.key);
    assert.equal(releaseIntent.status, 201, JSON.stringify(releaseIntent.json));

    const initialBody = {
      idempotency_key: "api-core-join-renewal-positive-initial",
      work_id: "work-api-1",
      intent_anchor_digest: H("1"),
      repository: "owner/repo",
      core_plan_id: `hnp_${H("a").slice(0, 40)}`,
      core_plan_digest: H("a"),
      local_plan_id: "local-plan-api-renewal",
      local_plan_digest: H("b"),
      evaluation_digest: H("6"),
      acceptance_criteria: [{
        criterion_id: "api-renewal-tests-green",
        evidence_digest: H("c"),
        proven: true,
      }],
      builder_report: {
        agent_id: "builder",
        report_digest: H("d"),
        target_commit: G("4"),
      },
      verifier_reports: [{
        agent_id: "verifier",
        report_digest: H("e"),
        reviewed_commit: G("4"),
        approved: true,
      }],
      checks: {
        commit: G("4"),
        required_checks: ["unit-tests"],
        checks_digest: H("5"),
        evidence_digest: H("f"),
      },
      release_intent: releaseIntent.json.release_intent,
      provider_execution: false,
    };
    initialBody.closure_attestation = signedClosureAttestation(initialBody);
    const gatewayHeaders = {
      "x-sh-tenant-id": "tenant-host-native",
      "x-sh-tenant-context": signedTenantContext(
        MCP_TENANT_CONTEXT_SECRET,
        "tenant-host-native",
      ),
    };
    const initialResponse = await request(
      "POST",
      "/v1/host-native/core-join-verdicts",
      initialBody,
      MCP_TENANT_GATEWAY_KEY,
      gatewayHeaders,
    );
    assert.equal(initialResponse.status, 201, JSON.stringify(initialResponse.json));
    const initial = initialResponse.json.core_join_verdict;

    nowValue += 1_001;
    const marker = {
      schema_version: "continuity_core_join_renewal_v1",
      predecessor_verdict_id: initial.verdict_id,
      predecessor_claim_digest: initial.claim_digest,
      predecessor_release_intent_digest: initial.claim.release_intent_digest,
      predecessor_record_digest: hostNativeDigest(initial),
      generation: 1,
    };
    const signedRenewalBody = {
      ...initialBody,
      idempotency_key: "api-core-join-renewal-positive-generation-1",
      core_join_renewal: marker,
    };
    signedRenewalBody.closure_attestation = signedClosureAttestation(signedRenewalBody);
    const {
      core_join_renewal: _serverDerivedRenewal,
      ...renewalBody
    } = signedRenewalBody;
    const renewalPath =
      `/v1/host-native/core-join-verdicts/${initial.verdict_id}/renew`;
    const renewedResponse = await request(
      "POST",
      renewalPath,
      renewalBody,
      MCP_TENANT_GATEWAY_KEY,
      gatewayHeaders,
    );
    assert.equal(renewedResponse.status, 201, JSON.stringify(renewedResponse.json));
    const renewed = renewedResponse.json.core_join_verdict;
    assert.notEqual(renewed.verdict_id, initial.verdict_id);
    assert.equal(renewed.claim.release_intent_digest, initial.claim.release_intent_digest);
    assert.deepEqual(renewed.claim.core_join_renewal, marker);
    assert.equal(governance.verifyCoreJoinVerdict(renewed), true);

    const replay = await request(
      "POST",
      renewalPath,
      renewalBody,
      MCP_TENANT_GATEWAY_KEY,
      gatewayHeaders,
    );
    assert.equal(replay.status, 201, JSON.stringify(replay.json));
    assert.equal(replay.json.core_join_verdict.verdict_id, renewed.verdict_id);
    assert.equal(replay.json.core_join_verdict.claim_digest, renewed.claim_digest);
  });
});
