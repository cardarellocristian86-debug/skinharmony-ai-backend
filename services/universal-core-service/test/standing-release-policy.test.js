import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentPresence } from "../../skinharmony-core-mcp/src/agent-presence.js";
import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  createFileHostNativeGovernanceStore,
  createHostNativeGovernance,
  createInMemoryHostNativeGovernanceStore,
} from "../src/hostNativeGovernance.js";
import {
  normalizeStandingReleaseMandate,
  standingReleaseBindingActive,
} from "../src/standingReleasePolicy.js";

const H = (value) => String(value).repeat(64);
const G = (value) => String(value).repeat(40);
const OWNER = `osf_${H("a")}`;
const AUTHORIZATION_WORK_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_WORK_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_RELEASE_WORK_ID = "33333333-3333-4333-8333-333333333333";
const STANDING_SIGNING_SECRET =
  "standing-release-test-signing-secret-at-least-32-bytes";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stable(value[key]);
    return result;
  }, {});
}

function objectDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function signed(prefix, value) {
  return `${prefix}_${crypto.createHmac("sha256", STANDING_SIGNING_SECRET)
    .update(JSON.stringify(stable(value))).digest("hex")}`;
}

function intentBinding({
  tenantId = "tenant-a",
  workId = RELEASE_WORK_ID,
  intentDigest = H("3"),
  verifiedAt = "2026-08-14T10:00:00.000Z",
  ...overrides
} = {}) {
  const unsigned = {
    schema_version: "standing_release_intent_binding_v1",
    source: "mcp_work_continuity_postgres",
    tenant_id: tenantId,
    work_id: workId,
    project_id: "project-standing-release",
    work_status: "active",
    current_version: 3,
    work_updated_at: "2026-08-14T09:59:00.000Z",
    intent_anchor_schema_version: "intent_anchor_v1",
    intent_anchor_immutable: true,
    intent_anchor_digest: intentDigest,
    intent_anchor_created_at: "2026-08-14T09:00:00.000Z",
    verified_at: verifiedAt,
    provider_execution: false,
    ...overrides,
  };
  return Object.freeze({ ...unsigned, binding_digest: objectDigest(unsigned) });
}

function ownerConfirmation(nonce, purpose = "host_native_standing_release_mandate_install") {
  return {
    verified: true,
    request_bound: true,
    owner_subject_fingerprint: OWNER,
    consent_nonce: nonce,
    confirmation_reference: `owner confirmed ${nonce}`,
    purpose,
    request_binding_hash: H("f"),
  };
}

function mandateInput(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    authorization_work_id: AUTHORIZATION_WORK_ID,
    authorization_intent_anchor_digest: H("1"),
    repository: "owner/repo",
    base_branch: "main",
    delivery_branch_prefix: "agent/",
    allowed_path_prefixes: ["services"],
    denied_path_prefixes: [],
    required_checks: ["core-mcp", "deployment-parity", "universal-core"],
    required_checks_policy_digest: H("2"),
    services: [
      {
        service_id: "srv-core",
        environment: "production",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      },
      {
        service_id: "srv-mcp",
        environment: "production",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      },
      {
        service_id: "srv-nyra",
        environment: "production",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      },
    ],
    repair_classes: [
      "deterministic_build",
      "deterministic_lint",
      "deterministic_test",
      "deterministic_typecheck",
      "transient_network",
      "transient_runner",
    ],
    limits: {
      max_pull_requests: 1,
      max_merges: 1,
      max_commits: 3,
      max_pushes: 3,
      max_repair_attempts: 2,
      max_deploys_per_service: 1,
      max_rollbacks: 1,
    },
    base_protection_required: true,
    expires_at: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

function derivationInput(mandateId, overrides = {}) {
  return {
    tenant_id: "tenant-a",
    mandate_id: mandateId,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    intent_binding: intentBinding(),
    dtt_request_binding_digest: H("b"),
    delivery_branch: "agent/release-1",
    changed_files: ["services/example/src/index.js"],
    builder_agent_id: "builder",
    verifier_agent_ids: ["verifier"],
    required_checks_policy_digest: H("2"),
    induced_services: mandateInput().services,
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    ttl_seconds: 3_600,
    idempotency_key: "derive-release-1",
    ...overrides,
  };
}

function harness({
  enabled = true,
  emergencyStop = () => false,
  protectionOverrides = {},
  suppliedStore = null,
  releaseJoinVerdictResolver = null,
} = {}) {
  let clock = Date.parse("2026-08-14T10:00:00.000Z");
  const store = suppliedStore || createInMemoryHostNativeGovernanceStore();
  const standingReleaseBaseProtectionResolver = async (request) => ({
    schema_version: "standing_release_base_protection_readback_v1",
    trusted: true,
    source: "universal_core_github_readback",
    tenant_id: request.tenant_id,
    repository: request.repository,
    branch: request.base_branch,
    base_commit: G("1"),
    protected: true,
    direct_push_allowed: false,
    force_push_allowed: false,
    deletion_allowed: false,
    pull_request_required: true,
    approving_reviews_required: 1,
    enforce_admins: true,
    bypass_allowance_count: 0,
    required_checks: request.required_checks,
    required_checks_policy_digest: request.required_checks_policy_digest,
    check_app_id: 15368,
    verified_at: new Date(clock).toISOString(),
    provider_execution: false,
    evidence_digest: H("4"),
    ...protectionOverrides,
  });
  Object.defineProperty(standingReleaseBaseProtectionResolver, "trusted", { value: true });
  const governance = createHostNativeGovernance({
    store,
    signingSecret: STANDING_SIGNING_SECRET,
    closureAttestationSigningSecret:
      "standing-release-test-closure-secret-at-least-32-bytes",
    standingReleaseAutomationEnabled: enabled,
    standingReleaseEmergencyStop: emergencyStop,
    standingReleaseBaseProtectionResolver,
    releaseJoinVerdictResolver,
    now: () => clock,
  });
  return {
    governance,
    store,
    advance(milliseconds) { clock += milliseconds; },
  };
}

async function install(governance, overrides = {}) {
  return governance.installStandingReleaseMandate({
    ...mandateInput(overrides),
    authorization_intent_binding: intentBinding({
      workId: AUTHORIZATION_WORK_ID,
      intentDigest: H("1"),
    }),
    authorization_dtt_request_binding_digest: H("a"),
    owner_confirmation: ownerConfirmation("install-1"),
    idempotency_key: "install-1",
  });
}

test("standing mandate is bounded, durable-state compatible and disabled fail-closed", async () => {
  const normalized = normalizeStandingReleaseMandate(mandateInput(), {
    now: Date.parse("2026-08-14T10:00:00.000Z"),
  });
  assert.equal(normalized.provider_execution, false);
  assert.equal(normalized.direct_main_push_allowed, false);
  assert.equal(normalized.force_push_allowed, false);
  assert.equal(normalized.workflow_change_allowed, false);
  assert.equal(normalized.limits.max_repair_attempts, 2);
  assert(normalized.denied_path_prefixes.includes(".github"));
  assert(normalized.denied_path_prefixes.includes("render"));
  assert(normalized.denied_path_prefixes.includes(
    "services/skinharmony-core-mcp/src/work-continuity-runtime.js",
  ));
  assert(normalized.denied_path_prefixes.includes(
    "services/shared/dtt-work-context.js",
  ));

  assert.throws(
    () => normalizeStandingReleaseMandate(mandateInput({
      expires_at: "2026-10-20T10:00:00.000Z",
    }), { now: Date.parse("2026-08-14T10:00:00.000Z") }),
    /standing_release_expiry_invalid/,
  );
  assert.throws(
    () => normalizeStandingReleaseMandate(mandateInput({
      repair_classes: ["security_policy_rewrite"],
    }), { now: Date.parse("2026-08-14T10:00:00.000Z") }),
    /standing_release_repair_classes_invalid/,
  );
  assert.throws(
    () => normalizeStandingReleaseMandate(mandateInput({
      authorization_work_id: "caller-controlled-work-name",
    }), { now: Date.parse("2026-08-14T10:00:00.000Z") }),
    /standing_release_work_invalid/,
  );

  const { governance } = harness({ enabled: false });
  await assert.rejects(
    governance.installStandingReleaseMandate({
      ...mandateInput(),
      owner_confirmation: ownerConfirmation("install-without-intent-binding"),
      idempotency_key: "install-without-intent-binding",
    }),
    /standing_release_intent_binding_invalid/,
  );
  const record = await install(governance);
  assert.equal(governance.verifyStandingReleaseMandate(record), true);
  const read = await governance.readStandingReleaseMandate({
    tenant_id: "tenant-a",
    mandate_id: record.mandate_id,
  });
  assert.equal(read.effective_state, "runtime_disabled");
  await assert.rejects(
    governance.deriveStandingReleaseDelegation(derivationInput(record.mandate_id)),
    /standing_release_runtime_disabled/,
  );
});

test("one owner mandate derives one exact signed release delegation without another prompt", async () => {
  const { governance, store } = harness();
  const mandate = await install(governance);
  assert.equal(
    mandate.authorization_intent_binding_digest,
    intentBinding({
      workId: AUTHORIZATION_WORK_ID,
      intentDigest: H("1"),
    }).binding_digest,
  );
  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  assert.equal(governance.verifyDelegation(delegation), true);
  assert.equal(delegation.grant.authorization_source, "owner_standing_release_mandate");
  assert.equal(delegation.grant.provider_execution, false);
  assert.equal(delegation.grant.allowed_branches[0], "agent/release-1");
  assert.equal(delegation.grant.protected_branches[0], "main");
  assert.equal(delegation.grant.standing_release_binding.mandate_id, mandate.mandate_id);
  assert.equal(
    delegation.grant.work_intent_binding_digest,
    derivationInput(mandate.mandate_id).intent_binding.binding_digest,
  );
  assert.deepEqual(
    delegation.grant.standing_release_binding.intent_binding,
    derivationInput(mandate.mandate_id).intent_binding,
  );
  assert.equal(standingReleaseBindingActive(store.readState(), delegation, {
    now: Date.parse("2026-08-14T10:00:00.000Z"),
    runtimeEnabled: true,
  }), true);

  const replay = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  assert.equal(replay.delegation_id, delegation.delegation_id);

  await assert.rejects(
    governance.deriveStandingReleaseDelegation(derivationInput(mandate.mandate_id, {
      work_id: OTHER_RELEASE_WORK_ID,
      intent_binding: intentBinding({ workId: OTHER_RELEASE_WORK_ID }),
      idempotency_key: "derive-release-2",
    })),
    /standing_release_lease_conflict/,
  );
  await assert.rejects(
    governance.deriveStandingReleaseDelegation(derivationInput(mandate.mandate_id, {
      idempotency_key: "",
    })),
    /standing_release_idempotency_key_required/,
  );
});

test("standing Intent bindings require canonical fields and persist an exact digest", async () => {
  const { governance } = harness();
  await assert.rejects(
    governance.installStandingReleaseMandate({
      ...mandateInput(),
      authorization_intent_binding: intentBinding({
        workId: AUTHORIZATION_WORK_ID,
        intentDigest: H("1"),
        current_version: "3",
      }),
      authorization_dtt_request_binding_digest: H("a"),
      owner_confirmation: ownerConfirmation("noncanonical-version"),
      idempotency_key: "noncanonical-version",
    }),
    /standing_release_intent_binding_invalid/,
  );
  await assert.rejects(
    governance.installStandingReleaseMandate({
      ...mandateInput(),
      authorization_intent_binding: intentBinding({
        workId: AUTHORIZATION_WORK_ID,
        intentDigest: H("1"),
        verifiedAt: "2026-08-14T12:00:00.000+02:00",
      }),
      authorization_dtt_request_binding_digest: H("b"),
      owner_confirmation: ownerConfirmation("noncanonical-timestamp"),
      idempotency_key: "noncanonical-timestamp",
    }),
    /standing_release_intent_binding_invalid/,
  );

  const mandate = await install(governance);
  const {
    binding_digest: authorizationBindingDigest,
    ...authorizationBindingUnsigned
  } = mandate.authorization_intent_binding;
  assert.equal(objectDigest(authorizationBindingUnsigned), authorizationBindingDigest);
  assert.equal(mandate.authorization_intent_binding_digest, authorizationBindingDigest);

  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  const persistedReleaseBinding = delegation.grant.standing_release_binding.intent_binding;
  const { binding_digest: releaseBindingDigest, ...releaseBindingUnsigned } =
    persistedReleaseBinding;
  assert.equal(objectDigest(releaseBindingUnsigned), releaseBindingDigest);
  assert.equal(delegation.grant.work_intent_binding_digest, releaseBindingDigest);
});

test("standing mandate and derivation retries ignore fresh proof envelopes but reject semantic drift", async () => {
  const { governance, advance } = harness();
  const authorizationBinding = intentBinding({
    workId: AUTHORIZATION_WORK_ID,
    intentDigest: H("1"),
  });
  const firstInstallInput = {
    ...mandateInput(),
    authorization_intent_binding: authorizationBinding,
    authorization_dtt_request_binding_digest: H("a"),
    owner_confirmation: ownerConfirmation("semantic-install-first"),
    idempotency_key: "semantic-install",
  };
  const installed = await governance.installStandingReleaseMandate(firstInstallInput);

  advance(1_000);
  const freshAuthorizationBinding = intentBinding({
    workId: AUTHORIZATION_WORK_ID,
    intentDigest: H("1"),
    verifiedAt: "2026-08-14T10:00:01.000Z",
    work_status: "verified",
    current_version: 4,
    work_updated_at: "2026-08-14T10:00:00.500Z",
  });
  const installReplay = await governance.installStandingReleaseMandate({
    ...firstInstallInput,
    required_checks: [...firstInstallInput.required_checks].reverse(),
    services: [...firstInstallInput.services].reverse(),
    repair_classes: [...firstInstallInput.repair_classes].reverse(),
    authorization_intent_binding: freshAuthorizationBinding,
    authorization_dtt_request_binding_digest: H("c"),
    owner_confirmation: ownerConfirmation("semantic-install-fresh-proof"),
  });
  assert.equal(installReplay.mandate_id, installed.mandate_id);
  assert.equal(
    installReplay.authorization_intent_binding_digest,
    authorizationBinding.binding_digest,
  );

  await assert.rejects(
    governance.installStandingReleaseMandate({
      ...firstInstallInput,
      allowed_path_prefixes: ["packages"],
      authorization_intent_binding: freshAuthorizationBinding,
      authorization_dtt_request_binding_digest: H("d"),
      owner_confirmation: ownerConfirmation("semantic-install-drift"),
    }),
    /idempotency_key_conflict/,
  );

  const firstDerivationInput = derivationInput(installed.mandate_id, {
    changed_files: [
      "services/example/src/index.js",
      "services/example/src/worker.js",
    ],
    verifier_agent_ids: ["verifier-one", "verifier-two"],
  });
  const delegated = await governance.deriveStandingReleaseDelegation(firstDerivationInput);
  advance(1_000);
  const freshReleaseBinding = intentBinding({
    verifiedAt: "2026-08-14T10:00:02.000Z",
    work_status: "release_ready",
    current_version: 5,
    work_updated_at: "2026-08-14T10:00:01.500Z",
  });
  const derivationReplay = await governance.deriveStandingReleaseDelegation({
    ...firstDerivationInput,
    changed_files: [...firstDerivationInput.changed_files].reverse(),
    verifier_agent_ids: [...firstDerivationInput.verifier_agent_ids].reverse(),
    induced_services: [...firstDerivationInput.induced_services].reverse(),
    intent_binding: freshReleaseBinding,
    dtt_request_binding_digest: H("e"),
  });
  assert.equal(derivationReplay.delegation_id, delegated.delegation_id);
  assert.equal(
    derivationReplay.grant.work_intent_binding_digest,
    firstDerivationInput.intent_binding.binding_digest,
  );

  await assert.rejects(
    governance.deriveStandingReleaseDelegation({
      ...firstDerivationInput,
      changed_files: ["services/example/src/other.js"],
      intent_binding: freshReleaseBinding,
      dtt_request_binding_digest: H("f"),
    }),
    /idempotency_key_conflict/,
  );
});

test("derivation rejects unprotected main, service drift, protected paths and self-review", async () => {
  const unprotected = harness({ protectionOverrides: { protected: false } });
  const unprotectedMandate = await install(unprotected.governance);
  await assert.rejects(
    unprotected.governance.deriveStandingReleaseDelegation(
      derivationInput(unprotectedMandate.mandate_id),
    ),
    /standing_release_base_protection_invalid/,
  );
  const { governance } = harness();
  const mandate = await install(governance);
  await assert.rejects(
    governance.deriveStandingReleaseDelegation(derivationInput(mandate.mandate_id, {
      induced_services: mandateInput().services.slice(0, 2),
    })),
    /standing_release_service_scope_drift/,
  );
  await assert.rejects(
    governance.deriveStandingReleaseDelegation(derivationInput(mandate.mandate_id, {
      changed_files: ["services/universal-core-service/src/hostNativeGovernance.js"],
    })),
    /standing_release_path_denied/,
  );
  await assert.rejects(
    governance.deriveStandingReleaseDelegation(derivationInput(mandate.mandate_id, {
      changed_files: ["services/shared/dtt-work-context.js"],
      idempotency_key: "protected-dtt-context",
    })),
    /standing_release_path_denied/,
  );
  await assert.rejects(
    governance.deriveStandingReleaseDelegation(derivationInput(mandate.mandate_id, {
      verifier_agent_ids: ["builder"],
    })),
    /standing_release_self_verification_denied/,
  );
});

test("standing release accepts the MCP v2 fingerprint and rejects the bounded v1 identity", async () => {
  const authenticatedHostPrincipal = {
    registered: true,
    registry_revision: H("a"),
    app_id: "chatgpt_prod",
    host_kind: "chatgpt_native",
    client_type: "chatgpt",
  };
  const presence = (version) => createAgentPresence({
    agentSignatureSecret: "standing-release-presence-secret".repeat(2),
    agentPresenceSignatureVersion: version,
  }, {
    tenantId: "tenant-a",
    kind: "oauth",
    subject: "auth0|standing-release-owner",
    authenticatedHostPrincipal,
  }, {
    agent_id: "standing-release-agent",
    client_type: "chatgpt",
    session_id: "standing-release-session",
  });
  const { governance } = harness();
  const mandate = await install(governance);
  const v1 = presence("v1");
  const v2 = presence("v2");

  assert.match(v1.session_fingerprint, /^[a-f0-9]{24}$/);
  await assert.rejects(
    governance.deriveStandingReleaseDelegation(derivationInput(mandate.mandate_id, {
      host_kind: "chatgpt_native",
      host_session_fingerprint: v1.session_fingerprint,
      idempotency_key: "derive-release-v1-fingerprint",
    })),
    /standing_release_host_session_invalid/,
  );
  assert.match(v2.session_fingerprint, /^[a-f0-9]{64}$/);
  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id, {
      host_kind: "chatgpt_native",
      host_session_fingerprint: v2.session_fingerprint,
      idempotency_key: "derive-release-v2-fingerprint",
    }),
  );
  assert.equal(
    delegation.grant.standing_release_binding.host_session_fingerprint,
    v2.session_fingerprint,
  );
});

test("derived authority cannot substitute its host session or exact change cone", async () => {
  const { governance } = harness();
  const mandate = await install(governance);
  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  const request = {
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    action: {
      kind: "git.commit",
      repository: "owner/repo",
      branch: "agent/release-1",
      parent_commit: G("1"),
      tree_sha: G("2"),
      diff_digest: H("5"),
      changed_files: ["services/other/src/index.js"],
      message_digest: H("6"),
      builder_agent_id: "builder",
      provider_execution: false,
    },
    evidence_digest: H("7"),
    idempotency_key: "change-cone-drift",
  };
  await assert.rejects(
    governance.issueActionTicket(request),
    /standing_release_change_cone_drift/,
  );
  await assert.rejects(
    governance.issueActionTicket({
      ...request,
      host_session_fingerprint: H("8"),
      idempotency_key: "host-session-drift",
    }),
    /standing_release_host_session_mismatch/,
  );
});

test("revocation and emergency stop invalidate derived authority before ticket issuance", async () => {
  let stopped = false;
  const { governance } = harness({ emergencyStop: () => stopped });
  const mandate = await install(governance);
  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  stopped = true;
  await assert.rejects(
    governance.issueActionTicket({
      tenant_id: "tenant-a",
      delegation_id: delegation.delegation_id,
      work_id: RELEASE_WORK_ID,
      intent_anchor_digest: H("3"),
      repository: "owner/repo",
      host_kind: "codex_native",
      host_session_fingerprint: "session-release-1",
      action: {
        kind: "git.commit",
        repository: "owner/repo",
        branch: "agent/release-1",
        parent_commit: G("1"),
        tree_sha: G("2"),
        diff_digest: H("5"),
        changed_files: ["services/example/src/index.js"],
        message_digest: H("6"),
        builder_agent_id: "builder",
        provider_execution: false,
      },
      evidence_digest: H("7"),
      idempotency_key: "ticket-after-stop",
    }),
    /standing_release_authority_inactive/,
  );
  stopped = false;
  const revoked = await governance.revokeStandingReleaseMandate({
    tenant_id: "tenant-a",
    mandate_id: mandate.mandate_id,
    owner_confirmation: ownerConfirmation(
      "revoke-1",
      "host_native_standing_release_mandate_revoke",
    ),
    reason_digest: H("8"),
    idempotency_key: "revoke-1",
  });
  assert.equal(revoked.state, "revoked");
  assert.equal(revoked.revocation_epoch, 2);
  assert.equal((await governance.readDelegation({
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
  })).effective_state, "revoked");
});

test("standing reservation replay fails after revocation and changed files cannot be omitted", async () => {
  const { governance } = harness();
  const mandate = await install(governance);
  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  const actionRequest = {
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    action: {
      kind: "git.commit",
      repository: "owner/repo",
      branch: "agent/release-1",
      parent_commit: G("1"),
      tree_sha: G("2"),
      diff_digest: H("5"),
      changed_files: ["services/example/src/index.js"],
      message_digest: H("6"),
      builder_agent_id: "builder",
      provider_execution: false,
    },
    evidence_digest: H("7"),
    idempotency_key: "standing-ticket-1",
  };
  await assert.rejects(
    governance.issueActionTicket({
      ...actionRequest,
      action: { ...actionRequest.action, changed_files: undefined },
      idempotency_key: "standing-ticket-no-files",
    }),
    /standing_release_changed_files_required/,
  );
  const ticket = await governance.issueActionTicket(actionRequest);
  const reservationInput = {
    tenant_id: "tenant-a",
    ticket_id: ticket.ticket.ticket_id,
    host_session_fingerprint: H("9"),
    idempotency_key: "standing-reserve-1",
  };
  const reserved = await governance.reserveActionTicket(reservationInput);
  assert.equal(reserved.state, "reserved");
  await governance.revokeStandingReleaseMandate({
    tenant_id: "tenant-a",
    mandate_id: mandate.mandate_id,
    owner_confirmation: ownerConfirmation(
      "revoke-replay",
      "host_native_standing_release_mandate_revoke",
    ),
    reason_digest: H("8"),
    idempotency_key: "revoke-replay",
  });
  await assert.rejects(
    governance.reserveActionTicket(reservationInput),
    /standing_release_authority_inactive/,
  );
});

test("direct delegation revocation invalidates a standing reservation replay", async () => {
  const { governance } = harness();
  const mandate = await install(governance);
  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  const ticket = await governance.issueActionTicket({
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    action: {
      kind: "git.commit",
      repository: "owner/repo",
      branch: "agent/release-1",
      parent_commit: G("1"),
      tree_sha: G("2"),
      diff_digest: H("5"),
      changed_files: ["services/example/src/index.js"],
      message_digest: H("6"),
      builder_agent_id: "builder",
      provider_execution: false,
    },
    evidence_digest: H("7"),
    idempotency_key: "direct-revoke-ticket",
  });
  const reservationInput = {
    tenant_id: "tenant-a",
    ticket_id: ticket.ticket.ticket_id,
    host_session_fingerprint: H("9"),
    idempotency_key: "direct-revoke-reservation",
  };
  await governance.reserveActionTicket(reservationInput);
  await governance.revokeDelegation({
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    owner_confirmation: ownerConfirmation("direct-delegation-revoke"),
    idempotency_key: "direct-delegation-revoke",
  });
  assert.equal((await governance.readActionTicket({
    tenant_id: "tenant-a",
    ticket_id: ticket.ticket.ticket_id,
  })).state, "reconciliation_required");
  await assert.rejects(
    governance.reserveActionTicket(reservationInput),
    /standing_release_authority_inactive/,
  );
});

test("standing repair commits require bounded CI evidence and never repair deployment parity", async () => {
  const { governance } = harness();
  const mandate = await install(governance);
  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  const common = {
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    evidence_digest: H("7"),
  };
  const first = await governance.issueActionTicket({
    ...common,
    action: {
      kind: "git.commit",
      repository: "owner/repo",
      branch: "agent/release-1",
      parent_commit: G("1"),
      tree_sha: G("2"),
      diff_digest: H("5"),
      changed_files: ["services/example/src/index.js"],
      message_digest: H("6"),
      builder_agent_id: "builder",
      provider_execution: false,
    },
    idempotency_key: "repair-first-issue",
  });
  const reserved = await governance.reserveActionTicket({
    tenant_id: "tenant-a",
    ticket_id: first.ticket.ticket_id,
    host_session_fingerprint: H("9"),
    idempotency_key: "repair-first-reserve",
  });
  await governance.completeActionTicket({
    tenant_id: "tenant-a",
    ticket_id: first.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: H("9"),
    outcome: "success",
    result_digest: H("a"),
    result_commit: G("2"),
    idempotency_key: "repair-first-complete",
  });
  const repairAction = {
    kind: "git.commit",
    repository: "owner/repo",
    branch: "agent/release-1",
    parent_commit: G("2"),
    tree_sha: G("3"),
    diff_digest: H("8"),
    changed_files: ["services/example/src/index.js"],
    message_digest: H("9"),
    builder_agent_id: "builder",
    repair_class: "deterministic_test",
    failed_check: "core-mcp",
    failure_evidence_digest: H("b"),
    provider_execution: false,
  };
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...repairAction, failure_evidence_digest: undefined },
    predecessor_ticket_id: first.ticket.ticket_id,
    idempotency_key: "repair-missing-evidence",
  }), /standing_release_repair_evidence_required/);
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...repairAction, failed_check: "deployment-parity" },
    predecessor_ticket_id: first.ticket.ticket_id,
    idempotency_key: "repair-parity-denied",
  }), /standing_release_repair_check_denied/);
  const repair = await governance.issueActionTicket({
    ...common,
    action: repairAction,
    predecessor_ticket_id: first.ticket.ticket_id,
    idempotency_key: "repair-valid-issue",
  });
  await governance.reserveActionTicket({
    tenant_id: "tenant-a",
    ticket_id: repair.ticket.ticket_id,
    host_session_fingerprint: H("9"),
    idempotency_key: "repair-valid-reserve",
  });
  const current = await governance.readDelegation({
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
  });
  assert.equal(current.standing_release_usage.repair_attempts, 1);
});

test("standing PR budget is enforced atomically at reservation", async () => {
  const { governance } = harness();
  const mandate = await install(governance);
  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  const common = {
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    evidence_digest: H("7"),
  };
  const issueReserveComplete = async (action, key, predecessor_ticket_id) => {
    const ticket = await governance.issueActionTicket({
      ...common,
      action,
      ...(predecessor_ticket_id ? { predecessor_ticket_id } : {}),
      idempotency_key: `issue-${key}`,
    });
    const reserved = await governance.reserveActionTicket({
      tenant_id: "tenant-a",
      ticket_id: ticket.ticket.ticket_id,
      host_session_fingerprint: H("9"),
      idempotency_key: `reserve-${key}`,
    });
    await governance.completeActionTicket({
      tenant_id: "tenant-a",
      ticket_id: ticket.ticket.ticket_id,
      reservation_id: reserved.reservation_id,
      host_session_fingerprint: H("9"),
      outcome: "success",
      result_digest: H("a"),
      result_commit: G("2"),
      ...(action.kind === "github.draft_pr" ? { result_pull_request: 42 } : {}),
      idempotency_key: `complete-${key}`,
    });
    return ticket;
  };
  const commitTicket = await issueReserveComplete({
    kind: "git.commit",
    repository: "owner/repo",
    branch: "agent/release-1",
    parent_commit: G("1"),
    tree_sha: G("2"),
    diff_digest: H("5"),
    changed_files: ["services/example/src/index.js"],
    message_digest: H("6"),
    builder_agent_id: "builder",
    provider_execution: false,
  }, "commit");
  const pushTicket = await issueReserveComplete({
    kind: "git.push.branch",
    repository: "owner/repo",
    branch: "agent/release-1",
    source_commit: G("2"),
    expected_remote_commit: G("1"),
    changed_files: ["services/example/src/index.js"],
    force: false,
    delete_ref: false,
    tags: false,
    induced_effects: [],
    provider_execution: false,
  }, "push", commitTicket.ticket.ticket_id);
  const draftAction = {
    kind: "github.draft_pr",
    repository: "owner/repo",
    head_branch: "agent/release-1",
    base_branch: "main",
    head_commit: G("2"),
    expected_base_commit: G("1"),
    changed_files: ["services/example/src/index.js"],
    title_digest: H("b"),
    body_digest: H("c"),
    draft: true,
    force: false,
    delete_ref: false,
    tags: false,
    provider_execution: false,
  };
  await issueReserveComplete(draftAction, "draft-1", pushTicket.ticket.ticket_id);
  const second = await governance.issueActionTicket({
    ...common,
    action: { ...draftAction, title_digest: H("d") },
    predecessor_ticket_id: pushTicket.ticket.ticket_id,
    idempotency_key: "issue-draft-2",
  });
  await assert.rejects(
    governance.reserveActionTicket({
      tenant_id: "tenant-a",
      ticket_id: second.ticket.ticket_id,
      host_session_fingerprint: H("9"),
      idempotency_key: "reserve-draft-2",
    }),
    /standing_release_action_budget_exhausted/,
  );
});

test("standing merges consume merge budget without consuming push budget, while legacy merges still consume pushes", async () => {
  let freshReadbacks = 0;
  const freshResolver = async (request) => {
    freshReadbacks += 1;
    const sourceUnsigned = {
      schema_version: "host_native_source_attestation_v1",
      repository: request.repository,
      evidence_kind: "github_pull_request_files",
      pull_request: request.action.pull_request,
      ...request.source_evidence,
    };
    const sourceAttestation = {
      ...sourceUnsigned,
      attestation_digest: objectDigest(sourceUnsigned),
    };
    const readbackUnsigned = {
      schema_version: "host_native_pre_merge_readback_v1",
      trusted: true,
      source: "universal_core_github_readback",
      repository: request.repository,
      base_branch: request.action.base_branch,
      base_commit: request.action.expected_base_commit,
      head_branch: request.action.head_branch,
      head_commit: request.action.head_commit,
      pull_request: request.action.pull_request,
      required_checks: request.required_checks,
      required_checks_policy_digest: request.required_checks_policy_digest,
      check_app_id: 15368,
      approving_reviews_required: 1,
      approved_reviews: [{
        review_id: 1,
        reviewer: "reviewer",
        reviewed_commit: request.action.head_commit,
      }],
      active_rules_digest: H("8"),
      verified_at: "2026-08-14T10:00:00.000Z",
      provider_execution: false,
    };
    const preMergeReadback = {
      ...readbackUnsigned,
      evidence_digest: objectDigest(readbackUnsigned),
    };
    return {
      trusted: true,
      allowed: true,
      provider_execution: false,
      verdict_id: request.verdict_id,
      tenant_id: request.tenant_id,
      work_id: request.work_id,
      intent_anchor_digest: request.intent_anchor_digest,
      repository: request.repository,
      checks_commit: request.checks_commit,
      required_checks_policy_digest: request.required_checks_policy_digest,
      source_attestation: sourceAttestation,
      pre_merge_readback: preMergeReadback,
      pre_merge_readback_digest: objectDigest(preMergeReadback),
    };
  };
  Object.defineProperties(freshResolver, {
    trusted: { value: true },
    standing_pre_merge_readback: { value: true },
  });
  const { governance, store } = harness({
    releaseJoinVerdictResolver: freshResolver,
  });
  const mandate = await install(governance, {
    limits: { ...mandateInput().limits, max_pushes: 1 },
  });
  const standing = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  const common = {
    tenant_id: "tenant-a",
    delegation_id: standing.delegation_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    evidence_digest: H("7"),
  };
  const commitTicket = await governance.issueActionTicket({
    ...common,
    action: {
      kind: "git.commit",
      repository: "owner/repo",
      branch: "agent/release-1",
      parent_commit: G("1"),
      tree_sha: G("2"),
      diff_digest: H("5"),
      changed_files: ["services/example/src/index.js"],
      message_digest: H("6"),
      builder_agent_id: "builder",
      provider_execution: false,
    },
    idempotency_key: "merge-accounting-commit-issue",
  });
  const commitReservation = await governance.reserveActionTicket({
    tenant_id: "tenant-a",
    ticket_id: commitTicket.ticket.ticket_id,
    host_session_fingerprint: H("9"),
    idempotency_key: "merge-accounting-commit-reserve",
  });
  await governance.completeActionTicket({
    tenant_id: "tenant-a",
    ticket_id: commitTicket.ticket.ticket_id,
    reservation_id: commitReservation.reservation_id,
    host_session_fingerprint: H("9"),
    outcome: "success",
    result_digest: H("a"),
    result_commit: G("2"),
    idempotency_key: "merge-accounting-commit-complete",
  });
  const pushTicket = await governance.issueActionTicket({
    ...common,
    predecessor_ticket_id: commitTicket.ticket.ticket_id,
    action: {
      kind: "git.push.branch",
      repository: "owner/repo",
      branch: "agent/release-1",
      source_commit: G("2"),
      expected_remote_commit: G("1"),
      changed_files: ["services/example/src/index.js"],
      force: false,
      delete_ref: false,
      tags: false,
      induced_effects: [],
      provider_execution: false,
    },
    idempotency_key: "merge-accounting-push-issue",
  });
  await governance.reserveActionTicket({
    tenant_id: "tenant-a",
    ticket_id: pushTicket.ticket.ticket_id,
    host_session_fingerprint: H("9"),
    idempotency_key: "merge-accounting-push-reserve",
  });

  const legacy = await governance.issueDelegation({
    tenant_id: "tenant-a",
    work_id: "legacy-work",
    intent_anchor_digest: H("e"),
    repository: "owner/repo",
    owner_confirmation: ownerConfirmation("legacy-merge-accounting", "legacy"),
    audience: ["codex_native"],
    allowed_branches: ["agent/*"],
    protected_branches: ["main"],
    allowed_path_prefixes: ["services"],
    allowed_actions: ["github.merge"],
    budget: {
      max_agents: 1,
      max_parallel: 1,
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
      required_checks: ["core-mcp"],
    },
    expires_at: "2026-08-14T11:00:00.000Z",
    idempotency_key: "legacy-merge-accounting-delegation",
  });

  const injectReservableMerge = ({ ticketId, delegationId, workId, intent, session }) => {
    store.mutate((state) => {
      const standingMerge = delegationId === standing.delegation_id;
      const action = {
        kind: "github.merge",
        repository: "owner/repo",
        head_branch: "agent/release-1",
        base_branch: "main",
        pull_request: 42,
        head_commit: G("2"),
        expected_base_commit: G("1"),
        merge_method: "merge",
        checks_commit: G("2"),
        induced_effects: [],
        provider_execution: false,
      };
      const sourceUnsigned = {
        schema_version: "host_native_source_attestation_v1",
        repository: "owner/repo",
        evidence_kind: "github_pull_request_files",
        pull_request: 42,
        base_commit: G("1"),
        head_commit: G("2"),
        tree_sha: G("3"),
        diff_digest: H("5"),
        changed_files: ["services/example/src/index.js"],
      };
      const sourceAttestation = {
        ...sourceUnsigned,
        attestation_digest: objectDigest(sourceUnsigned),
      };
      const resolution = {
        source_attestation: sourceAttestation,
      };
      const claim = {
        tenant_id: "tenant-a",
        work_id: workId,
        intent_anchor_digest: intent,
        repository: "owner/repo",
        release_intent_digest: H("d"),
        ...(standingMerge ? { required_checks_policy_digest: H("2") } : {}),
        provider_execution: false,
      };
      const claimDigest = objectDigest(claim);
      const joinId = `hnj_${claimDigest.slice(0, 40)}`;
      const ticketUnsigned = {
        schema_version: "host_native_action_ticket_v1",
        ticket_id: ticketId,
        delegation_id: delegationId,
        tenant_id: "tenant-a",
        work_id: workId,
        intent_anchor_digest: intent,
        repository: "owner/repo",
        host_kind: "codex_native",
        host_session_fingerprint: session,
        action,
        evidence_digest: H("7"),
        issued_at: "2026-08-14T10:00:00.000Z",
        expires_at: "2026-08-14T10:30:00.000Z",
        core_join_verdict_id: joinId,
        core_join_verdict_digest: claimDigest,
        release_intent_digest: H("d"),
        ...(standingMerge ? {
          release_manifest_binding: {
            verification: {
              checks_commit: G("2"),
              required_checks: mandateInput().required_checks,
            },
            delivery: {
              services: mandateInput().services.map((service) => ({
                ...service,
                origin: `https://${service.service_id}.onrender.com`,
                expected_previous_commit: G("1"),
              })),
            },
            rollback: { target_commit: G("1") },
          },
          release_join_resolution: resolution,
          release_join_resolution_digest: objectDigest(resolution),
        } : {}),
      };
      const ticket = {
        ...ticketUnsigned,
        signature: signed("hnt", ticketUnsigned),
      };
      state.tickets[ticketId] = {
        state: "issued",
        uses: 0,
        ticket,
      };
      const verdictUnsigned = {
        schema_version: "host_native_core_join_v2",
        verdict_id: joinId,
        claim_digest: claimDigest,
        tenant_id: "tenant-a",
        work_id: workId,
        intent_anchor_digest: intent,
        repository: "owner/repo",
        release_intent_digest: H("d"),
        ...(standingMerge ? { required_checks_policy_digest: H("2") } : {}),
        authority: "universal_core",
        allowed: true,
        provider_execution: false,
        issued_at: "2026-08-14T10:00:00.000Z",
        expires_at: "2026-08-14T10:30:00.000Z",
      };
      state.core_join_verdicts[joinId] = {
        schema_version: "host_native_core_join_record_v1",
        tenant_id: "tenant-a",
        verdict_id: joinId,
        state: "active",
        uses: 0,
        authorized_ticket_id: ticketId,
        claim_digest: claimDigest,
        claim,
        release_intent: { release_intent_digest: H("d") },
        verdict: standingMerge ? {
          ...verdictUnsigned,
          signature: signed("hnj", verdictUnsigned),
        } : {
          ...verdictUnsigned,
          signature: signed("hnj", verdictUnsigned),
        },
        issued_at: "2026-08-14T10:00:00.000Z",
        expires_at: "2026-08-14T10:30:00.000Z",
      };
    });
  };
  injectReservableMerge({
    ticketId: "hnt-standing-merge-accounting",
    delegationId: standing.delegation_id,
    workId: RELEASE_WORK_ID,
    intent: H("3"),
    session: H("9"),
  });
  injectReservableMerge({
    ticketId: "hnt-legacy-merge-accounting",
    delegationId: legacy.delegation_id,
    workId: "legacy-work",
    intent: H("e"),
    session: "legacy-session",
  });
  await governance.reserveActionTicket({
    tenant_id: "tenant-a",
    ticket_id: "hnt-standing-merge-accounting",
    host_session_fingerprint: H("9"),
    idempotency_key: "reserve-standing-merge-accounting",
  });
  await governance.reserveActionTicket({
    tenant_id: "tenant-a",
    ticket_id: "hnt-legacy-merge-accounting",
    host_session_fingerprint: "legacy-session",
    idempotency_key: "reserve-legacy-merge-accounting",
  });
  const standingAfter = await governance.readDelegation({
    tenant_id: "tenant-a",
    delegation_id: standing.delegation_id,
  });
  const legacyAfter = await governance.readDelegation({
    tenant_id: "tenant-a",
    delegation_id: legacy.delegation_id,
  });
  assert.equal(standingAfter.usage.pushes, 1);
  assert.equal(standingAfter.standing_release_usage.merges, 1);
  assert.equal(legacyAfter.usage.pushes, 1);
  assert.equal(freshReadbacks, 1);
  const reservedStanding = await governance.readActionTicket({
    tenant_id: "tenant-a",
    ticket_id: "hnt-standing-merge-accounting",
  });
  assert.match(reservedStanding.pre_merge_readback_digest, /^[a-f0-9]{64}$/);
});

test("standing draft, ready and merge stay bound to one exact PR and base", async () => {
  const { governance } = harness();
  const mandate = await install(governance);
  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  const common = {
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    evidence_digest: H("7"),
  };
  const complete = async (action, key, predecessor, extra = {}) => {
    const ticket = await governance.issueActionTicket({
      ...common,
      action,
      ...(predecessor ? { predecessor_ticket_id: predecessor.ticket.ticket_id } : {}),
      idempotency_key: `exact-pr-issue-${key}`,
    });
    const reserved = await governance.reserveActionTicket({
      tenant_id: "tenant-a",
      ticket_id: ticket.ticket.ticket_id,
      host_session_fingerprint: H("9"),
      idempotency_key: `exact-pr-reserve-${key}`,
    });
    await governance.completeActionTicket({
      tenant_id: "tenant-a",
      ticket_id: ticket.ticket.ticket_id,
      reservation_id: reserved.reservation_id,
      host_session_fingerprint: H("9"),
      outcome: "success",
      result_digest: H("a"),
      result_commit: G("2"),
      ...extra,
      idempotency_key: `exact-pr-complete-${key}`,
    });
    return ticket;
  };
  const commitTicket = await complete({
    kind: "git.commit",
    repository: "owner/repo",
    branch: "agent/release-1",
    parent_commit: G("1"),
    tree_sha: G("2"),
    diff_digest: H("5"),
    changed_files: ["services/example/src/index.js"],
    message_digest: H("6"),
    builder_agent_id: "builder",
    provider_execution: false,
  }, "commit");
  const pushTicket = await complete({
    kind: "git.push.branch",
    repository: "owner/repo",
    branch: "agent/release-1",
    source_commit: G("2"),
    expected_remote_commit: G("1"),
    changed_files: ["services/example/src/index.js"],
    force: false,
    delete_ref: false,
    tags: false,
    induced_effects: [],
    provider_execution: false,
  }, "push", commitTicket);
  const draftTicket = await complete({
    kind: "github.draft_pr",
    repository: "owner/repo",
    head_branch: "agent/release-1",
    base_branch: "main",
    head_commit: G("2"),
    expected_base_commit: G("1"),
    changed_files: ["services/example/src/index.js"],
    title_digest: H("b"),
    body_digest: H("c"),
    draft: true,
    force: false,
    delete_ref: false,
    tags: false,
    provider_execution: false,
  }, "draft", pushTicket, { result_pull_request: 42 });
  const readyAction = {
    kind: "github.ready",
    repository: "owner/repo",
    head_branch: "agent/release-1",
    base_branch: "main",
    pull_request: 42,
    head_commit: G("2"),
    draft_before: true,
    ready_for_review: true,
    force: false,
    delete_ref: false,
    tags: false,
    provider_execution: false,
  };
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...readyAction, pull_request: 43 },
    predecessor_ticket_id: draftTicket.ticket.ticket_id,
    idempotency_key: "exact-pr-wrong-ready-pr",
  }), /standing_release_predecessor_mismatch/);
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...readyAction, base_branch: "release" },
    predecessor_ticket_id: draftTicket.ticket.ticket_id,
    idempotency_key: "exact-pr-wrong-ready-base",
  }), /standing_release_base_branch_denied/);
  const readyTicket = await complete(readyAction, "ready", draftTicket);
  const mergeAction = {
    kind: "github.merge",
    repository: "owner/repo",
    head_branch: "agent/release-1",
    base_branch: "main",
    pull_request: 42,
    head_commit: G("2"),
    expected_base_commit: G("1"),
    merge_method: "merge",
    checks_verified: true,
    checks_commit: G("2"),
    force: false,
    delete_ref: false,
    tags: false,
    induced_effects: [],
    provider_execution: false,
  };
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...mergeAction, pull_request: 43 },
    predecessor_ticket_id: readyTicket.ticket.ticket_id,
    idempotency_key: "exact-pr-wrong-merge-pr",
  }), /standing_release_predecessor_mismatch/);
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...mergeAction, expected_base_commit: G("8") },
    predecessor_ticket_id: readyTicket.ticket.ticket_id,
    idempotency_key: "exact-pr-wrong-merge-base",
  }), /standing_release_base_commit_drift/);
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...mergeAction, origin_draft_ticket_id: "hnt_wrong-origin" },
    predecessor_ticket_id: readyTicket.ticket.ticket_id,
    idempotency_key: "exact-pr-unexpected-origin",
  }), /standing_release_origin_draft_mismatch/);
});

test("standing repair after a draft preserves the exact origin through ready and merge", async () => {
  const { governance } = harness();
  const mandate = await install(governance);
  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  const common = {
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    evidence_digest: H("7"),
  };
  const complete = async ({ action, key, predecessor, resultCommit, pullRequest }) => {
    const ticket = await governance.issueActionTicket({
      ...common,
      action,
      ...(predecessor ? { predecessor_ticket_id: predecessor.ticket.ticket_id } : {}),
      idempotency_key: `repair-chain-issue-${key}`,
    });
    const reservation = await governance.reserveActionTicket({
      tenant_id: "tenant-a",
      ticket_id: ticket.ticket.ticket_id,
      host_session_fingerprint: H("9"),
      idempotency_key: `repair-chain-reserve-${key}`,
    });
    await governance.completeActionTicket({
      tenant_id: "tenant-a",
      ticket_id: ticket.ticket.ticket_id,
      reservation_id: reservation.reservation_id,
      host_session_fingerprint: H("9"),
      outcome: "success",
      result_digest: H("a"),
      result_commit: resultCommit,
      ...(pullRequest ? { result_pull_request: pullRequest } : {}),
      idempotency_key: `repair-chain-complete-${key}`,
    });
    return ticket;
  };
  const initialCommit = await complete({
    key: "initial-commit",
    resultCommit: G("2"),
    action: {
      kind: "git.commit",
      repository: "owner/repo",
      branch: "agent/release-1",
      parent_commit: G("1"),
      tree_sha: G("2"),
      diff_digest: H("5"),
      changed_files: ["services/example/src/index.js"],
      message_digest: H("6"),
      builder_agent_id: "builder",
      provider_execution: false,
    },
  });
  const initialPush = await complete({
    key: "initial-push",
    predecessor: initialCommit,
    resultCommit: G("2"),
    action: {
      kind: "git.push.branch",
      repository: "owner/repo",
      branch: "agent/release-1",
      source_commit: G("2"),
      expected_remote_commit: G("1"),
      changed_files: ["services/example/src/index.js"],
      force: false,
      delete_ref: false,
      tags: false,
      induced_effects: [],
      provider_execution: false,
    },
  });
  const draft = await complete({
    key: "draft",
    predecessor: initialPush,
    resultCommit: G("2"),
    pullRequest: 42,
    action: {
      kind: "github.draft_pr",
      repository: "owner/repo",
      head_branch: "agent/release-1",
      base_branch: "main",
      head_commit: G("2"),
      expected_base_commit: G("1"),
      changed_files: ["services/example/src/index.js"],
      title_digest: H("b"),
      body_digest: H("c"),
      draft: true,
      force: false,
      delete_ref: false,
      tags: false,
      provider_execution: false,
    },
  });
  const repairCommit = await complete({
    key: "repair-commit",
    predecessor: draft,
    resultCommit: G("3"),
    action: {
      kind: "git.commit",
      repository: "owner/repo",
      branch: "agent/release-1",
      parent_commit: G("2"),
      tree_sha: G("3"),
      diff_digest: H("8"),
      changed_files: ["services/example/src/index.js"],
      message_digest: H("9"),
      builder_agent_id: "builder",
      repair_class: "deterministic_test",
      failed_check: "core-mcp",
      failure_evidence_digest: H("d"),
      provider_execution: false,
    },
  });
  const repairPush = await complete({
    key: "repair-push",
    predecessor: repairCommit,
    resultCommit: G("3"),
    action: {
      kind: "git.push.branch",
      repository: "owner/repo",
      branch: "agent/release-1",
      source_commit: G("3"),
      expected_remote_commit: G("2"),
      changed_files: ["services/example/src/index.js"],
      force: false,
      delete_ref: false,
      tags: false,
      induced_effects: [],
      provider_execution: false,
    },
  });
  const secondRepairCommit = await complete({
    key: "second-repair-commit",
    predecessor: repairPush,
    resultCommit: G("4"),
    action: {
      kind: "git.commit",
      repository: "owner/repo",
      branch: "agent/release-1",
      parent_commit: G("3"),
      tree_sha: G("4"),
      diff_digest: H("e"),
      changed_files: ["services/example/src/index.js"],
      message_digest: H("f"),
      builder_agent_id: "builder",
      repair_class: "deterministic_test",
      failed_check: "universal-core",
      failure_evidence_digest: H("e"),
      provider_execution: false,
    },
  });
  const secondRepairPush = await complete({
    key: "second-repair-push",
    predecessor: secondRepairCommit,
    resultCommit: G("4"),
    action: {
      kind: "git.push.branch",
      repository: "owner/repo",
      branch: "agent/release-1",
      source_commit: G("4"),
      expected_remote_commit: G("3"),
      changed_files: ["services/example/src/index.js"],
      force: false,
      delete_ref: false,
      tags: false,
      induced_effects: [],
      provider_execution: false,
    },
  });
  await assert.rejects(governance.issueActionTicket({
    ...common,
    predecessor_ticket_id: secondRepairPush.ticket.ticket_id,
    action: {
      kind: "git.commit",
      repository: "owner/repo",
      branch: "agent/release-1",
      parent_commit: G("4"),
      tree_sha: G("5"),
      diff_digest: H("1"),
      changed_files: ["services/example/src/index.js"],
      message_digest: H("2"),
      builder_agent_id: "builder",
      repair_class: "deterministic_test",
      failed_check: "core-mcp",
      failure_evidence_digest: H("3"),
      provider_execution: false,
    },
    idempotency_key: "repair-chain-third-repair-denied",
  }), /delegation_commits_budget_exhausted/);
  const readyAction = {
    kind: "github.ready",
    repository: "owner/repo",
    head_branch: "agent/release-1",
    base_branch: "main",
    pull_request: 42,
    head_commit: G("4"),
    expected_base_commit: G("1"),
    origin_draft_ticket_id: draft.ticket.ticket_id,
    draft_before: true,
    ready_for_review: true,
    force: false,
    delete_ref: false,
    tags: false,
    provider_execution: false,
  };
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...readyAction, origin_draft_ticket_id: undefined },
    predecessor_ticket_id: secondRepairPush.ticket.ticket_id,
    idempotency_key: "repair-chain-ready-missing-origin",
  }), /standing_release_origin_draft_required/);
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...readyAction, origin_draft_ticket_id: "hnt_wrong-origin" },
    predecessor_ticket_id: secondRepairPush.ticket.ticket_id,
    idempotency_key: "repair-chain-ready-wrong-origin",
  }), /standing_release_origin_draft_mismatch/);
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...readyAction, pull_request: 43 },
    predecessor_ticket_id: secondRepairPush.ticket.ticket_id,
    idempotency_key: "repair-chain-ready-wrong-pr",
  }), /standing_release_origin_draft_mismatch/);
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...readyAction, expected_base_commit: G("8") },
    predecessor_ticket_id: secondRepairPush.ticket.ticket_id,
    idempotency_key: "repair-chain-ready-wrong-base",
  }), /standing_release_origin_draft_mismatch/);
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...readyAction, head_commit: G("2") },
    predecessor_ticket_id: secondRepairPush.ticket.ticket_id,
    idempotency_key: "repair-chain-ready-old-head",
  }), /standing_release_origin_draft_mismatch/);
  const ready = await complete({
    key: "ready",
    predecessor: secondRepairPush,
    resultCommit: G("4"),
    action: readyAction,
  });
  const mergeAction = {
    kind: "github.merge",
    repository: "owner/repo",
    head_branch: "agent/release-1",
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
    induced_effects: [],
    provider_execution: false,
  };
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...mergeAction, head_commit: G("3"), checks_commit: G("3") },
    predecessor_ticket_id: ready.ticket.ticket_id,
    idempotency_key: "repair-chain-merge-old-head",
  }), /standing_release_predecessor_mismatch/);
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: { ...mergeAction, origin_draft_ticket_id: "hnt_wrong-origin" },
    predecessor_ticket_id: ready.ticket.ticket_id,
    idempotency_key: "repair-chain-merge-wrong-origin",
  }), /standing_release_origin_draft_mismatch/);
  await assert.rejects(governance.issueActionTicket({
    ...common,
    action: mergeAction,
    predecessor_ticket_id: ready.ticket.ticket_id,
    idempotency_key: "repair-chain-merge-valid-predecessor",
  }), /release_manifest_required/);
});

test("durable horizontal runner binds fresh DTT transitions to authoritative Core tickets", async () => {
  const { governance, store } = harness();
  const mandate = await install(governance);
  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  const startInput = {
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    intent_binding: intentBinding(),
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    dtt_session_fingerprint: H("9"),
    dtt_request_binding_digest: H("c"),
    idempotency_key: "horizontal-run-start",
  };
  const started = await governance.startStandingReleaseRun(startInput);
  assert.equal(governance.verifyStandingReleaseRunRecord(started), true);
  assert.equal(started.run.coordination_model, "horizontal_peer_adapters_v1");
  assert.deepEqual(started.run.adapter_lanes.map((lane) => lane.relationship), [
    "peer", "peer", "peer",
  ]);
  assert.equal(started.run.state, "COMMIT_PENDING");
  assert.equal(started.transition, "start");
  assert.equal(started.dtt_request_binding_digest, H("c"));

  const ticket = await governance.issueActionTicket({
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    action: {
      kind: "git.commit",
      repository: "owner/repo",
      branch: "agent/release-1",
      parent_commit: G("1"),
      tree_sha: G("2"),
      diff_digest: H("5"),
      changed_files: ["services/example/src/index.js"],
      message_digest: H("6"),
      builder_agent_id: "builder",
      provider_execution: false,
    },
    evidence_digest: H("7"),
    idempotency_key: "horizontal-run-ticket",
  });
  await assert.rejects(governance.reserveActionTicket({
    tenant_id: "tenant-a",
    ticket_id: ticket.ticket.ticket_id,
    host_session_fingerprint: H("9"),
    idempotency_key: "horizontal-run-reserve-before-bind",
  }), /standing_release_run_ticket_not_bound/);
  const bound = await governance.bindStandingReleaseRunTicket({
    tenant_id: "tenant-a",
    run_id: started.run_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    intent_binding: intentBinding(),
    ticket_id: ticket.ticket.ticket_id,
    expected_version: 1,
    dtt_session_fingerprint: H("9"),
    dtt_request_binding_digest: H("d"),
    idempotency_key: "horizontal-run-bind",
  });
  assert.equal(bound.run.state, "ACTION_IN_PROGRESS");
  assert.equal(bound.run.active_action.adapter_lane, "git");
  assert.equal(bound.transition, "bind_ticket");

  const reserved = await governance.reserveStandingReleaseRunTicket({
    tenant_id: "tenant-a",
    run_id: started.run_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    intent_binding: intentBinding(),
    ticket_id: ticket.ticket.ticket_id,
    expected_version: 2,
    host_session_fingerprint: H("9"),
    dtt_session_fingerprint: H("9"),
    dtt_request_binding_digest: H("2"),
    idempotency_key: "horizontal-run-reserve",
  });
  await governance.completeStandingReleaseRunTicket({
    tenant_id: "tenant-a",
    run_id: started.run_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    intent_binding: intentBinding(),
    ticket_id: ticket.ticket.ticket_id,
    expected_version: 2,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: H("9"),
    dtt_session_fingerprint: H("9"),
    dtt_request_binding_digest: H("4"),
    outcome: "success",
    result_digest: H("e"),
    result_commit: G("2"),
    idempotency_key: "horizontal-run-complete",
  });
  const advanceInput = {
    tenant_id: "tenant-a",
    run_id: started.run_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    intent_binding: intentBinding(),
    ticket_id: ticket.ticket.ticket_id,
    expected_version: 2,
    dtt_session_fingerprint: H("9"),
    dtt_request_binding_digest: H("e"),
    idempotency_key: "horizontal-run-advance",
  };
  store.mutate((state) => {
    state.tickets[ticket.ticket.ticket_id].outcome = "failure";
  });
  await assert.rejects(
    governance.advanceStandingReleaseRun(advanceInput),
    /action_ticket_lifecycle_invalid/,
  );
  store.mutate((state) => {
    state.tickets[ticket.ticket.ticket_id].outcome = "success";
  });
  const advanced = await governance.advanceStandingReleaseRun(advanceInput);
  assert.equal(advanced.run.state, "PUSH_PENDING");
  assert.equal(advanced.run.version, 3);
  assert.equal(advanced.run.current_head_commit, G("2"));

  const replay = await governance.startStandingReleaseRun({
    ...startInput,
    dtt_request_binding_digest: H("f"),
  });
  assert.equal(replay.run.version, 3);
  assert.equal(replay.transition, "advance");
  await assert.rejects(
    governance.readStandingReleaseRun({
      tenant_id: "tenant-b",
      run_id: started.run_id,
    }),
    /standing_release_run_cross_tenant_denied/,
  );

  const cancelled = await governance.cancelStandingReleaseRun({
    tenant_id: "tenant-a",
    run_id: started.run_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    intent_binding: intentBinding(),
    reason_digest: H("a"),
    expected_version: 3,
    dtt_session_fingerprint: H("9"),
    dtt_request_binding_digest: H("1"),
    idempotency_key: "horizontal-run-cancel",
  });
  assert.equal(cancelled.run.state, "CANCELLED");
  assert.equal(cancelled.run.provider_execution, false);
  assert.equal(cancelled.run.background_execution, false);
});

test("expired horizontal reservations quarantine atomically without retry or budget refund", async () => {
  const subject = harness();
  const { governance, advance, store } = subject;
  const mandate = await install(governance);
  const delegation = await governance.deriveStandingReleaseDelegation(
    derivationInput(mandate.mandate_id),
  );
  const started = await governance.startStandingReleaseRun({
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    intent_binding: intentBinding(),
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    dtt_session_fingerprint: H("9"),
    dtt_request_binding_digest: H("a"),
    idempotency_key: "expired-run-start",
  });
  const ticket = await governance.issueActionTicket({
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: H("9"),
    action: {
      kind: "git.commit",
      repository: "owner/repo",
      branch: "agent/release-1",
      parent_commit: G("1"),
      tree_sha: G("2"),
      diff_digest: H("5"),
      changed_files: ["services/example/src/index.js"],
      message_digest: H("6"),
      builder_agent_id: "builder",
      provider_execution: false,
    },
    evidence_digest: H("7"),
    idempotency_key: "expired-run-ticket",
  });
  const bound = await governance.bindStandingReleaseRunTicket({
    tenant_id: "tenant-a",
    run_id: started.run_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    intent_binding: intentBinding(),
    ticket_id: ticket.ticket.ticket_id,
    expected_version: 1,
    dtt_session_fingerprint: H("9"),
    dtt_request_binding_digest: H("b"),
    idempotency_key: "expired-run-bind",
  });
  const reserved = await governance.reserveStandingReleaseRunTicket({
    tenant_id: "tenant-a",
    run_id: started.run_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    intent_binding: intentBinding(),
    ticket_id: ticket.ticket.ticket_id,
    expected_version: bound.run.version,
    host_session_fingerprint: H("9"),
    dtt_session_fingerprint: H("9"),
    dtt_request_binding_digest: H("c"),
    idempotency_key: "expired-run-reserve",
  });
  const quarantineInput = {
    tenant_id: "tenant-a",
    run_id: started.run_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    intent_binding: intentBinding(),
    ticket_id: ticket.ticket.ticket_id,
    reservation_id: reserved.reservation_id,
    expected_version: bound.run.version,
    dtt_session_fingerprint: H("9"),
    dtt_request_binding_digest: H("d"),
    idempotency_key: "expired-run-quarantine",
  };
  await assert.rejects(
    governance.quarantineExpiredStandingReleaseRun(quarantineInput),
    /standing_release_expired_reservation_mismatch/,
  );
  advance(300_001);
  await governance.revokeStandingReleaseMandate({
    tenant_id: "tenant-a",
    mandate_id: mandate.mandate_id,
    owner_confirmation: ownerConfirmation(
      "expired-run-revoke",
      "host_native_standing_release_mandate_revoke",
    ),
    reason_digest: H("9"),
    idempotency_key: "expired-run-revoke",
  });
  const revokedDelegation = await governance.readDelegation({
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
  });
  assert.equal(revokedDelegation.state, "revoked");
  const freshIntent = intentBinding({ verifiedAt: "2026-08-14T10:05:00.001Z" });
  store.mutate((state) => {
    state.delegations[delegation.delegation_id].signature = H("f");
  });
  await assert.rejects(governance.quarantineExpiredStandingReleaseRun({
    ...quarantineInput,
    intent_binding: freshIntent,
  }), /standing_release_run_delegation_invalid/);
  store.mutate((state) => {
    state.delegations[delegation.delegation_id].signature = revokedDelegation.signature;
  });
  const quarantined = await governance.quarantineExpiredStandingReleaseRun({
    ...quarantineInput,
    intent_binding: freshIntent,
  });
  assert.equal(quarantined.run.state, "QUARANTINED");
  assert.equal(quarantined.run.active_action, null);
  assert.equal(quarantined.transition, "quarantine_expired");
  assert.equal(governance.verifyStandingReleaseRunRecord(quarantined), true);
  const quarantinedTicket = await governance.readActionTicket({
    tenant_id: "tenant-a",
    ticket_id: ticket.ticket.ticket_id,
  });
  assert.equal(quarantinedTicket.state, "quarantined");
  assert.equal(quarantinedTicket.observed_outcome, "unknown");
  assert.equal(
    quarantinedTicket.quarantine_reason_digest,
    quarantined.run.terminal_reason_digest,
  );
  assert.equal(quarantinedTicket.reservation_id, reserved.reservation_id);
  const usage = await governance.readDelegation({
    tenant_id: "tenant-a",
    delegation_id: delegation.delegation_id,
  });
  assert.equal(usage.usage.total_actions, 1);
  const replay = await governance.quarantineExpiredStandingReleaseRun({
    ...quarantineInput,
    intent_binding: freshIntent,
    dtt_request_binding_digest: H("e"),
  });
  assert.equal(replay.run.version, quarantined.run.version);
  await assert.rejects(governance.completeStandingReleaseRunTicket({
    tenant_id: "tenant-a",
    run_id: started.run_id,
    work_id: RELEASE_WORK_ID,
    intent_anchor_digest: H("3"),
    intent_binding: freshIntent,
    ticket_id: ticket.ticket.ticket_id,
    expected_version: quarantined.run.version,
    reservation_id: reserved.reservation_id,
    host_session_fingerprint: H("9"),
    dtt_session_fingerprint: H("9"),
    dtt_request_binding_digest: H("f"),
    outcome: "success",
    result_digest: H("8"),
    result_commit: G("2"),
    idempotency_key: "expired-run-no-continuation",
  }), /standing_release_run_version_conflict/);
});

test("horizontal runner record survives a file-store restart with its Core signature", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "standing-release-run-restart-"));
  try {
    const first = harness({
      suppliedStore: createFileHostNativeGovernanceStore({ root }),
    });
    const mandate = await install(first.governance);
    const delegation = await first.governance.deriveStandingReleaseDelegation(
      derivationInput(mandate.mandate_id),
    );
    const started = await first.governance.startStandingReleaseRun({
      tenant_id: "tenant-a",
      delegation_id: delegation.delegation_id,
      work_id: RELEASE_WORK_ID,
      intent_anchor_digest: H("3"),
      intent_binding: intentBinding(),
      host_kind: "codex_native",
      host_session_fingerprint: H("9"),
      dtt_session_fingerprint: H("9"),
      dtt_request_binding_digest: H("c"),
      idempotency_key: "restart-run-start",
    });

    const restarted = harness({
      suppliedStore: createFileHostNativeGovernanceStore({ root }),
    });
    const read = await restarted.governance.readStandingReleaseRun({
      tenant_id: "tenant-a",
      run_id: started.run_id,
    });
    assert.equal(restarted.governance.verifyStandingReleaseRunRecord(read), true);
    assert.equal(read.run.state, "COMMIT_PENDING");
    assert.equal(read.run.coordination_model, "horizontal_peer_adapters_v1");
    const cancelled = await restarted.governance.cancelStandingReleaseRun({
      tenant_id: "tenant-a",
      run_id: started.run_id,
      work_id: RELEASE_WORK_ID,
      intent_anchor_digest: H("3"),
      intent_binding: intentBinding(),
      reason_digest: H("a"),
      expected_version: 1,
      dtt_session_fingerprint: H("9"),
      dtt_request_binding_digest: H("d"),
      idempotency_key: "restart-run-cancel",
    });
    assert.equal(cancelled.run.state, "CANCELLED");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("file governance store recovers a lock left by a dead process", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "standing-release-dead-lock-"));
  try {
    const store = createFileHostNativeGovernanceStore({ root });
    fs.writeFileSync(
      path.join(root, "host-native-governance.json.lock"),
      JSON.stringify({
        pid: 2_147_483_647,
        acquired_at: "2026-08-14T09:00:00.000Z",
      }),
      { mode: 0o600 },
    );
    const result = store.mutate((state) => {
      state.schema_version = "host_native_governance_store_v1";
      return "recovered";
    });
    assert.equal(result, "recovered");
    assert.equal(fs.existsSync(path.join(root, "host-native-governance.json.lock")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
