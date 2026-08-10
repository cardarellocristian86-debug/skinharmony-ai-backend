import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  buildHostReleaseManifestV2,
  createFileHostNativeGovernanceStore,
  createHostNativeGovernance,
  createInMemoryHostNativeGovernanceStore,
  deriveHostReleaseIntentV1,
  hostNativeDigest,
  hostNativeGithubDiffDigest,
} from "../src/hostNativeGovernance.js";

const H = (value) => String(value).repeat(64);
const G = (value) => String(value).repeat(40);
const OWNER = `osf_${H("a")}`;
const START = Date.parse("2026-07-29T10:00:00.000Z");
const fixtureSigningMaterial = (label) => crypto
  .createHash("sha256")
  .update(`public-test-fixture:${label}`)
  .digest("hex");
const SIGNING_SECRET = fixtureSigningMaterial("governance-signing");
const CLOSURE_ATTESTATION_SECRET = fixtureSigningMaterial("closure-attestation");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().flatMap((key) =>
      value[key] === undefined ? [] : [[key, stable(value[key])]]),
  );
}

function delegationInput(clock, overrides = {}) {
  return {
    tenant_id: "tenant-a",
    work_id: "work-a",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    owner_confirmation: {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: OWNER,
      consent_nonce: "adversarial-owner-consent-0001",
      confirmation_reference: "owner confirmed bounded native work",
    },
    audience: ["codex_native"],
    allowed_branches: ["agent/*", "main"],
    protected_branches: ["main"],
    allowed_path_prefixes: ["services/universal-core-service"],
    allowed_actions: ["github.merge"],
    budget: {
      max_agents: 2,
      max_parallel: 2,
      max_commits: 1,
      max_pushes: 2,
      max_deploys: 2,
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
    expires_at: new Date(clock + 60 * 60_000).toISOString(),
    idempotency_key: "adversarial-delegation",
    ...overrides,
  };
}

function mergeAction() {
  return {
    kind: "github.merge",
    repository: "owner/repo",
    head_branch: "agent/release",
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
  };
}

function pendingManifest() {
  return buildHostReleaseManifestV2({
    schema_version: "host_release_manifest_v2",
    manifest_id: "manifest-adversarial",
    tenant_id: "tenant-a",
    work_id: "work-a",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    base_branch: "main",
    delivery_branch: "main",
    base_commit: G("1"),
    head_commit: G("3"),
    tree_sha: G("6"),
    diff_digest: hostNativeGithubDiffDigest({
      repository: "owner/repo",
      base_commit: G("1"),
      head_commit: G("3"),
      tree_sha: G("6"),
      changed_files: [
        "services/universal-core-service/src/hostNativeGovernance.js",
      ],
    }),
    changed_files: ["services/universal-core-service/src/hostNativeGovernance.js"],
    verification: {
      builder_agent_id: "builder-a",
      verifier_agent_ids: ["verifier-a"],
      required_checks: ["unit-tests"],
      checks_commit: G("3"),
      checks_digest: H("5"),
      evidence_digest: H("6"),
      core_join_verdict_id: "hnj_pending",
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

function coreJoinInput(manifest, idempotencyKey) {
  const input = {
    tenant_id: manifest.tenant_id,
    work_id: manifest.work_id,
    intent_anchor_digest: manifest.intent_anchor_digest,
    repository: manifest.repository,
    core_plan_id: `hnp_${H("a").slice(0, 40)}`,
    core_plan_digest: H("a"),
    local_plan_id: "local-plan-adversarial",
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
    verifier_reports: [{
      agent_id: manifest.verification.verifier_agent_ids[0],
      report_digest: H("e"),
      reviewed_commit: manifest.verification.checks_commit,
      approved: true,
    }],
    checks: {
      commit: manifest.verification.checks_commit,
      required_checks: [...manifest.verification.required_checks],
      checks_digest: manifest.verification.checks_digest,
      evidence_digest: H("f"),
    },
    release_intent: deriveHostReleaseIntentV1(manifest),
    provider_execution: false,
    idempotency_key: idempotencyKey,
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
      {
        task_id: "build",
        agent_id: input.builder_report.agent_id,
        task_kind: "builder",
        report_digest: input.builder_report.report_digest,
        native_session_fingerprint: "1".repeat(32),
        native_presence_signature: `ags_${"1".repeat(32)}`,
      },
      {
        task_id: "verify",
        agent_id: input.verifier_reports[0].agent_id,
        task_kind: "verifier",
        report_digest: input.verifier_reports[0].report_digest,
        native_session_fingerprint: "2".repeat(32),
        native_presence_signature: `ags_${"2".repeat(32)}`,
      },
    ],
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
  return input;
}

function bindJoin(manifest, verdictId) {
  const { manifest_digest: _digest, ...unsigned } = manifest;
  return buildHostReleaseManifestV2({
    ...unsigned,
    verification: {
      ...unsigned.verification,
      core_join_verdict_id: verdictId,
    },
  });
}

function joinResolution(request, clock) {
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
    issued_at: request.core_join_issued_at,
    resolved_at: new Date(clock()).toISOString(),
    source_attestation: sourceAttestation,
    previous_live_attestations: previousLiveAttestations,
    pre_action_readback_digest: hostNativeDigest({
      source_attestation: sourceAttestation,
      previous_live_attestations: previousLiveAttestations,
    }),
    provider_execution: false,
  };
}

function trustedExternalReadback(ticket, targetCommit, clock, verificationScope = "full_release") {
  const binding = ticket.release_manifest_binding;
  const action = ticket.action;
  const requiredChecks = [...binding.verification.required_checks];
  const observedChecks = requiredChecks.map((name) => ({
    name,
    head_commit: binding.verification.checks_commit,
    status: "completed",
    conclusion: "success",
  }));
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
    rollback_commit: binding.rollback.target_commit,
    rollback_commit_available: true,
  };
  const services = (verificationScope === "github_merge_and_checks_only"
    ? []
    : binding.services).map((expected) => {
    const unsigned = {
      service_id: expected.service_id,
      environment: expected.environment,
      origin: expected.origin,
      health_path: "/healthz",
      deployment_id: `deployment-${expected.service_id}`,
      live_commit: targetCommit,
      version: "adversarial-1.0.0",
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
    verification_scope: verificationScope,
    verified_at: new Date(clock()).toISOString(),
    github: {
      ...githubUnsigned,
      readback_digest: hostNativeDigest(githubUnsigned),
    },
    services,
    external_side_effect: false,
    provider_execution: false,
  };
}

function governanceFactory({
  store,
  clock,
  idFactory,
  reservationLeaseMs = 120_000,
  externalReadbackCalls = null,
  externalReadbackScopeOverride = null,
  renderResolverCalls = null,
} = {}) {
  return createHostNativeGovernance({
    store: store || createInMemoryHostNativeGovernanceStore(),
    signingSecret: SIGNING_SECRET,
    closureAttestationSigningSecret: CLOSURE_ATTESTATION_SECRET,
    now: clock,
    idFactory,
    reservationLeaseMs,
    releaseJoinVerdictResolver: async (request) => joinResolution(request, clock),
    externalReadbackVerifier: async ({ ticket, target_commit, verification_scope }) => {
      if (externalReadbackCalls) externalReadbackCalls.push({
        ticket_id: ticket.ticket_id,
        verification_scope,
      });
      return trustedExternalReadback(
        ticket,
        target_commit,
        clock,
        externalReadbackScopeOverride || verification_scope,
      );
    },
    renderServiceOriginResolver: async (scope) => {
      if (renderResolverCalls) renderResolverCalls.push(scope);
      return `https://${scope.service_id}.onrender.com`;
    },
  });
}

async function issueReleaseTicket(governance, {
  delegationId,
  manifest,
  session,
  idempotencyKey,
}) {
  return governance.issueActionTicket({
    tenant_id: "tenant-a",
    delegation_id: delegationId,
    work_id: "work-a",
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: session,
    action: mergeAction(),
    evidence_digest: H("6"),
    release_manifest: manifest,
    idempotency_key: idempotencyKey,
  });
}

test("file-backed HNJ is deterministic across restart and consumed once across concurrent instances", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hnj-adversarial-"));
  let sequence = 0;
  let clockValue = START;
  const clock = () => clockValue;
  const renderResolverCalls = [];
  const makeGovernance = () => governanceFactory({
    store: createFileHostNativeGovernanceStore({ root }),
    clock,
    idFactory: () => `adversarial-${++sequence}`,
    renderResolverCalls,
  });
  try {
    const issuer = makeGovernance();
    const delegation = await issuer.issueDelegation(delegationInput(clockValue));
    const pending = pendingManifest();

    const joinResults = await Promise.all([
      makeGovernance().issueCoreJoinVerdict(
        coreJoinInput(pending, "join-concurrent-a"),
      ),
      makeGovernance().issueCoreJoinVerdict(
        coreJoinInput(pending, "join-concurrent-b"),
      ),
    ]);
    assert.deepEqual(joinResults[0], joinResults[1]);
    assert.equal(
      joinResults[0].verdict.verdict_id,
      `hnj_${joinResults[0].claim_digest.slice(0, 40)}`,
    );

    const afterRestart = makeGovernance();
    const duplicate = await afterRestart.issueCoreJoinVerdict(
      coreJoinInput(pending, "join-after-restart"),
    );
    assert.deepEqual(duplicate, joinResults[0]);
    const manifest = bindJoin(pending, duplicate.verdict.verdict_id);

    const raced = await Promise.allSettled([
      issueReleaseTicket(makeGovernance(), {
        delegationId: delegation.delegation_id,
        manifest,
        session: "release-session-a",
        idempotencyKey: "release-race-a",
      }),
      issueReleaseTicket(makeGovernance(), {
        delegationId: delegation.delegation_id,
        manifest,
        session: "release-session-b",
        idempotencyKey: "release-race-b",
      }),
    ]);
    assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(raced.filter((result) => result.status === "rejected").length, 1);
    const winningTicket = raced.find((result) => result.status === "fulfilled").value;
    await makeGovernance().reserveActionTicket({
      tenant_id: "tenant-a",
      ticket_id: winningTicket.ticket.ticket_id,
      host_session_fingerprint: winningTicket.ticket.host_session_fingerprint,
      idempotency_key: "release-race-reserve-winner",
    });

    const restored = makeGovernance();
    const join = await restored.readCoreJoinVerdict({
      tenant_id: "tenant-a",
      verdict_id: duplicate.verdict.verdict_id,
    });
    const storedDelegation = await restored.readDelegation({
      tenant_id: "tenant-a",
      delegation_id: delegation.delegation_id,
    });
    assert.equal(join.state, "consumed");
    assert.equal(join.uses, 1);
    assert.match(join.consumed_by_ticket_id, /^hnt_/);
    assert.equal(storedDelegation.usage.total_actions, 1);
    assert.equal(storedDelegation.usage.pushes, 1);
    assert.equal(storedDelegation.usage.deploys, 1);
    assert.ok(renderResolverCalls.length >= 2);
    assert.ok(renderResolverCalls.every((scope) =>
      scope.tenant_id === "tenant-a" &&
      scope.repository === "owner/repo" &&
      scope.service_id === "srv-core" &&
      scope.environment === "production"));

    await assert.rejects(restored.readCoreJoinVerdict({
      tenant_id: "tenant-b",
      verdict_id: duplicate.verdict.verdict_id,
    }), /cross_tenant_core_join_verdict_denied/);

    // Keep the clock variable live so this test also proves no wall-clock
    // dependency was smuggled into deterministic persistent issuance.
    clockValue += 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("expired observation lease rejects all closure paths without mutating authority state", async () => {
  let clockValue = START;
  let sequence = 0;
  const clock = () => clockValue;
  const governance = governanceFactory({
    clock,
    idFactory: () => `lease-${++sequence}`,
    reservationLeaseMs: 60_000,
  });
  const delegation = await governance.issueDelegation(delegationInput(clockValue));
  const pending = pendingManifest();
  const join = await governance.issueCoreJoinVerdict(
    coreJoinInput(pending, "lease-join"),
  );
  const issued = await issueReleaseTicket(governance, {
    delegationId: delegation.delegation_id,
    manifest: bindJoin(pending, join.verdict.verdict_id),
    session: "lease-session",
    idempotencyKey: "lease-ticket",
  });
  const reserved = await governance.reserveActionTicket({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    idempotency_key: "lease-reserve",
  });
  const before = {
    ticket: await governance.readActionTicket({
      tenant_id: "tenant-a",
      ticket_id: issued.ticket.ticket_id,
    }),
    delegation: await governance.readDelegation({
      tenant_id: "tenant-a",
      delegation_id: delegation.delegation_id,
    }),
    join: await governance.readCoreJoinVerdict({
      tenant_id: "tenant-a",
      verdict_id: join.verdict.verdict_id,
    }),
  };

  clockValue += 60_001;
  await assert.rejects(governance.completeActionTicket({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("7"),
    result_commit: G("4"),
    readback_digest: H("8"),
    idempotency_key: "lease-complete-expired",
  }), /action_ticket_reservation_expired/);
  await assert.rejects(governance.reconcileActionTicket({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    observed_outcome: "success",
    observed_commit: G("4"),
    readback_digest: H("9"),
    idempotency_key: "lease-reconcile-expired",
  }), /action_ticket_reservation_expired/);
  await assert.rejects(governance.authorizeFinalize({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  }), /action_ticket_reservation_expired/);

  const after = {
    ticket: await governance.readActionTicket({
      tenant_id: "tenant-a",
      ticket_id: issued.ticket.ticket_id,
    }),
    delegation: await governance.readDelegation({
      tenant_id: "tenant-a",
      delegation_id: delegation.delegation_id,
    }),
    join: await governance.readCoreJoinVerdict({
      tenant_id: "tenant-a",
      verdict_id: join.verdict.verdict_id,
    }),
  };
  assert.deepEqual(after, before);
});

test("final receipt replays while fresh and expired evidence is retained on re-attestation", async () => {
  let clockValue = START;
  let sequence = 0;
  const clock = () => clockValue;
  const externalReadbackCalls = [];
  const governance = governanceFactory({
    clock,
    idFactory: () => `receipt-${++sequence}`,
    reservationLeaseMs: 60_000,
    externalReadbackCalls,
  });
  const delegation = await governance.issueDelegation(delegationInput(clockValue));
  const pending = pendingManifest();
  const join = await governance.issueCoreJoinVerdict(
    coreJoinInput(pending, "receipt-join"),
  );
  const issued = await issueReleaseTicket(governance, {
    delegationId: delegation.delegation_id,
    manifest: bindJoin(pending, join.verdict.verdict_id),
    session: "receipt-session",
    idempotencyKey: "receipt-ticket",
  });
  const reserved = await governance.reserveActionTicket({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    idempotency_key: "receipt-reserve",
  });
  await governance.completeActionTicket({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("7"),
    result_commit: G("4"),
    readback_digest: H("8"),
    idempotency_key: "receipt-complete",
  });

  const receipt = await governance.authorizeFinalize({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  const replay = await governance.authorizeFinalize({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  assert.deepEqual(replay, receipt);
  assert.equal(externalReadbackCalls.length, 1);
  assert.equal(
    externalReadbackCalls[0].verification_scope,
    "github_merge_and_checks_only",
  );
  assert.equal(receipt.verification_scope, "github_merge_and_checks_only");
  assert.equal(receipt.services_verified, false);
  assert.deepEqual(receipt.live_services, []);
  assert.equal(receipt.expires_at, reserved.reservation_expires_at);

  clockValue = Date.parse(receipt.expires_at) + 1;
  const successor = await governance.authorizeFinalize({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  });
  assert.notEqual(successor.authorization_digest, receipt.authorization_digest);
  assert.equal(successor.previous_authorization_digest, receipt.authorization_digest);
  assert.equal(externalReadbackCalls.length, 2);

  const stored = await governance.readActionTicket({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
  });
  assert.deepEqual(stored.finalize_authorization, successor);
  assert.deepEqual(stored.finalize_authorization_history, [{
    authorization_digest: receipt.authorization_digest,
    external_readback_digest: receipt.external_readback_digest,
    issued_at: receipt.issued_at,
    expires_at: receipt.expires_at,
  }]);
});

test("merge finalization rejects a verifier that returns the wrong scope", async () => {
  let clockValue = START;
  let sequence = 0;
  const governance = governanceFactory({
    clock: () => clockValue,
    idFactory: () => `scope-${++sequence}`,
    externalReadbackScopeOverride: "full_release",
  });
  const delegation = await governance.issueDelegation(delegationInput(clockValue));
  const pending = pendingManifest();
  const join = await governance.issueCoreJoinVerdict(coreJoinInput(pending, "scope-join"));
  const issued = await issueReleaseTicket(governance, {
    delegationId: delegation.delegation_id,
    manifest: bindJoin(pending, join.verdict.verdict_id),
    session: "scope-session",
    idempotencyKey: "scope-ticket",
  });
  const reserved = await governance.reserveActionTicket({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    idempotency_key: "scope-reserve",
  });
  await governance.completeActionTicket({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
    outcome: "success",
    result_digest: H("7"),
    result_commit: G("4"),
    readback_digest: H("8"),
    idempotency_key: "scope-complete",
  });
  await assert.rejects(governance.authorizeFinalize({
    tenant_id: "tenant-a",
    ticket_id: issued.ticket.ticket_id,
    host_session_fingerprint: issued.ticket.host_session_fingerprint,
  }), /trusted_readback_github_mismatch/);
});
