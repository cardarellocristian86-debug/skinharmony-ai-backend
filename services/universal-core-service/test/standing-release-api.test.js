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
  hostNativeDigest,
} from "../src/hostNativeGovernance.js";

const H = (value) => String(value).repeat(64);
const G = (value) => String(value).repeat(40);
const TENANT = "tenant-standing-api";
const OWNER = `osf_${H("a")}`;
const OWNER_SECRET = "standing-api-owner-context-secret-0123456789";
const TENANT_SECRET = "standing-api-tenant-context-secret-0123456789";
const TENANT_GATEWAY_KEY = "standing-api-tenant-gateway-key-0123456789";
const ADMIN_KEY = "standing-api-admin-key";
const AUTHORIZATION_WORK_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_WORK_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORK_ID = "33333333-3333-4333-8333-333333333333";
const BINDING_REFERENCE_MS = Date.now();
const BINDING_WORK_UPDATED_AT = new Date(BINDING_REFERENCE_MS - 60_000).toISOString();
const BINDING_ANCHOR_CREATED_AT = new Date(BINDING_REFERENCE_MS - 60 * 60_000).toISOString();
const REQUIRED_POLICY = Object.freeze({
  schema_version: "host_native_required_checks_policy_v1",
  tenant_id: TENANT,
  repository: "owner/repo",
  base_branch: "main",
  required_checks: ["core-mcp", "deployment-parity", "universal-core"],
  check_app: { id: 15368, slug: "github-actions", owner: "github" },
  workflow: {
    id: 312527659,
    name: "Nyra Core Intelligence",
    path: ".github/workflows/nyra-core-intelligence.yml",
    sha256: H("7"),
  },
  allowed_events: ["pull_request", "push"],
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined)
    .sort().map((key) => [key, stable(value[key])]));
}

function objectDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function intentBinding({
  workId,
  intentDigest,
  verifiedAt = new Date().toISOString(),
  workUpdatedAt = BINDING_WORK_UPDATED_AT,
  intentAnchorCreatedAt = BINDING_ANCHOR_CREATED_AT,
  ...overrides
} = {}) {
  const unsigned = {
    schema_version: "standing_release_intent_binding_v1",
    source: "mcp_work_continuity_postgres",
    tenant_id: TENANT,
    work_id: workId,
    project_id: "project-standing-release",
    work_status: "active",
    current_version: 3,
    work_updated_at: workUpdatedAt,
    intent_anchor_schema_version: "intent_anchor_v1",
    intent_anchor_immutable: true,
    intent_anchor_digest: intentDigest,
    intent_anchor_created_at: intentAnchorCreatedAt,
    verified_at: new Date(Date.parse(verifiedAt)).toISOString(),
    provider_execution: false,
    ...overrides,
  };
  return Object.freeze({ ...unsigned, binding_digest: objectDigest(unsigned) });
}

function runIntentFields() {
  return {
    intent_anchor_digest: H("3"),
    intent_binding: intentBinding({
      workId: RELEASE_WORK_ID,
      intentDigest: H("3"),
    }),
  };
}

function ownerContext(body, purpose) {
  const { owner_context: _ownerContext, ...payload } = body;
  const context = {
    assertion_version: "owner_context_assertion_v1",
    audience: "nira_core_bridge",
    tenant_id: TENANT,
    access_mode: "god_mode",
    role: "owner_root",
    delegated_actor: "standing_release_api_test",
    owner_verified: true,
    owner_subject_fingerprint: OWNER,
    issued_at: new Date().toISOString(),
    binding_version: "owner_request_binding_v1",
    binding_hash: crypto.createHash("sha256")
      .update(`${purpose}\u0000${JSON.stringify(stable(payload))}`)
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
    assertion: `ocs_${crypto.createHmac("sha256", OWNER_SECRET)
      .update(`owner-context\u0000${canonical}`)
      .digest("hex")}`,
  };
}

function tenantContext(tenantId = TENANT) {
  const context = {
    version: "mcp_tenant_context_v1",
    tenant_id: tenantId,
    issued_at: new Date().toISOString(),
  };
  const canonical = JSON.stringify(context);
  return Buffer.from(JSON.stringify({
    ...context,
    assertion: `mtc_${crypto.createHmac("sha256", TENANT_SECRET)
      .update(`mcp-tenant-context\u0000${canonical}`)
      .digest("hex")}`,
  })).toString("base64url");
}

function trustedProtectionResolver() {
  const resolver = async (request) => {
    const unsigned = {
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
      verified_at: new Date().toISOString(),
      provider_execution: false,
    };
    return { ...unsigned, evidence_digest: hostNativeDigest(unsigned) };
  };
  Object.defineProperty(resolver, "trusted", { value: true });
  return resolver;
}

function mandateBody() {
  return {
    authorization_work_id: AUTHORIZATION_WORK_ID,
    authorization_intent_anchor_digest: H("1"),
    authorization_intent_binding: intentBinding({
      workId: AUTHORIZATION_WORK_ID,
      intentDigest: H("1"),
    }),
    repository: "owner/repo",
    base_branch: "main",
    delivery_branch_prefix: "agent/",
    allowed_path_prefixes: ["services/example"],
    denied_path_prefixes: [],
    required_checks: [...REQUIRED_POLICY.required_checks],
    required_checks_policy_digest: hostNativeDigest(REQUIRED_POLICY),
    services: [{
      service_id: "srv-core",
      environment: "production",
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    }],
    repair_classes: ["deterministic_test", "deterministic_lint"],
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
    expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    idempotency_key: "standing-install-one",
    owner_confirmed: true,
    confirmation_reference: "owner approved the exact standing release mandate",
  };
}

async function withService(run) {
  const priorAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = ADMIN_KEY;
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "standing-release-api-"));
  const { app } = createUniversalCoreService({
    storageRoot,
    hostNativeGovernanceEnabled: true,
    hostNativeSigningSecret: "standing-api-host-governance-secret-0123456789",
    dttAgentIdentitySigningSecret: "standing-api-dtt-identity-secret-0123456789",
    ownerContextSigningSecret: OWNER_SECRET,
    mcpTenantGatewayKey: TENANT_GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_SECRET,
    hostNativeRequiredChecksPolicyResolver: async () => REQUIRED_POLICY,
    standingReleaseAutomationEnabled: true,
    standingReleaseEmergencyStop: false,
    standingReleaseBaseProtectionResolver: trustedProtectionResolver(),
    allowTestDttWorkBindingResolver: true,
    resolveDttWorkBinding: async ({ tenant_id, body, request }) => ({
      schema_version: "dtt_work_context_v1",
      tenant_id,
      work_id: String(
        request.get("x-test-dtt-work-id") || body?.work_id || body?.authorization_work_id || "",
      ).toLowerCase(),
      execution_authorized: false,
      principal: {
        session_fingerprint: String(
          request.get("x-test-dtt-session-fingerprint") || H("9"),
        ).toLowerCase(),
      },
      request: {
        request_digest: request.get("x-test-dtt-binding-digest") || H("d"),
      },
    }),
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, pathname, body, key = ADMIN_KEY, headers = {}) => {
    const response = await fetch(`${origin}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };
  try {
    await run(request);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(storageRoot, { recursive: true, force: true });
    if (priorAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = priorAdmin;
  }
}

test("standing release API binds one owner mandate and gateway-only derivation", async () => {
  await withService(async (request) => {
    const ownerKey = await request("POST", "/v1/keys/generate", {
      tenant_id: TENANT,
      key_type: "connector",
      allowed_scopes: ["read:decision", "owner:assertion"],
    });
    assert.equal(ownerKey.status, 201);
    const automationKey = await request("POST", "/v1/keys/generate", {
      tenant_id: TENANT,
      key_type: "automation",
      allowed_scopes: ["read:decision", "automation:codex"],
    });
    assert.equal(automationKey.status, 201);

    const body = mandateBody();
    const directInstall = await request(
      "POST",
      "/v1/host-native/standing-release/mandates",
      {
        ...body,
        owner_context: ownerContext(body, "host_native_standing_release_mandate_install"),
      },
      ownerKey.json.key,
    );
    assert.equal(directInstall.status, 403);
    assert.equal(directInstall.json.error, "standing_release_mcp_gateway_required");

    const tampered = await request(
      "POST",
      "/v1/host-native/standing-release/mandates",
      {
        ...body,
        allowed_path_prefixes: ["services/other"],
        owner_context: ownerContext(body, "host_native_standing_release_mandate_install"),
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
      },
    );
    assert.equal(tampered.status, 400);
    assert.equal(tampered.json.error, "verified_owner_confirmation_required");

    const installed = await request(
      "POST",
      "/v1/host-native/standing-release/mandates",
      {
        ...body,
        owner_context: ownerContext(body, "host_native_standing_release_mandate_install"),
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
      },
    );
    assert.equal(installed.status, 201, JSON.stringify(installed.json));
    assert.equal(installed.json.mandate.effective_state, "active");
    assert.equal(installed.json.mandate.mandate.provider_execution, false);
    assert.equal(
      installed.json.mandate.authorization_intent_binding_digest,
      body.authorization_intent_binding.binding_digest,
    );
    assert.equal(
      installed.json.mandate.authorization_dtt_request_binding_digest,
      H("d"),
    );
    assert.deepEqual(
      installed.json.mandate.authorization_intent_binding,
      body.authorization_intent_binding,
    );
    const mandateId = installed.json.mandate.mandate_id;

    const directMandateRead = await request(
      "GET",
      `/v1/host-native/standing-release/mandates/${mandateId}`,
      undefined,
      ownerKey.json.key,
      { "x-test-dtt-work-id": AUTHORIZATION_WORK_ID },
    );
    assert.equal(directMandateRead.status, 403);
    assert.equal(directMandateRead.json.error, "standing_release_mcp_gateway_required");

    const wrongWorkMandateRead = await request(
      "GET",
      `/v1/host-native/standing-release/mandates/${mandateId}`,
      undefined,
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-work-id": OTHER_WORK_ID,
      },
    );
    assert.equal(wrongWorkMandateRead.status, 400);
    assert.equal(wrongWorkMandateRead.json.error, "standing_release_mandate_work_mismatch");

    const mandateRead = await request(
      "GET",
      `/v1/host-native/standing-release/mandates/${mandateId}`,
      undefined,
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-work-id": AUTHORIZATION_WORK_ID,
      },
    );
    assert.equal(mandateRead.status, 200, JSON.stringify(mandateRead.json));
    assert.equal(mandateRead.json.mandate.mandate_id, mandateId);

    await new Promise((resolve) => setTimeout(resolve, 2));
    const freshAuthorizationBinding = intentBinding({
      workId: AUTHORIZATION_WORK_ID,
      intentDigest: H("1"),
      verifiedAt: new Date().toISOString(),
    });
    const installReplayBody = {
      ...body,
      authorization_intent_binding: freshAuthorizationBinding,
    };
    const replayedInstall = await request(
      "POST",
      "/v1/host-native/standing-release/mandates",
      {
        ...installReplayBody,
        owner_context: ownerContext(
          installReplayBody,
          "host_native_standing_release_mandate_install",
        ),
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-binding-digest": H("e"),
      },
    );
    assert.equal(replayedInstall.status, 201, JSON.stringify(replayedInstall.json));
    assert.equal(replayedInstall.json.mandate.mandate_id, mandateId);
    assert.equal(
      replayedInstall.json.mandate.authorization_intent_binding_digest,
      body.authorization_intent_binding.binding_digest,
    );
    assert.equal(
      replayedInstall.json.mandate.authorization_dtt_request_binding_digest,
      H("d"),
    );

    const changedInstallScope = {
      ...installReplayBody,
      allowed_path_prefixes: ["services/other"],
    };
    const conflictingInstall = await request(
      "POST",
      "/v1/host-native/standing-release/mandates",
      {
        ...changedInstallScope,
        owner_context: ownerContext(
          changedInstallScope,
          "host_native_standing_release_mandate_install",
        ),
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-binding-digest": H("f"),
      },
    );
    assert.equal(conflictingInstall.status, 409, JSON.stringify(conflictingInstall.json));
    assert.equal(conflictingInstall.json.error, "idempotency_key_conflict");

    const revokeBody = {
      mandate_id: mandateId,
      reason_digest: H("6"),
      idempotency_key: "standing-revoke-target-binding",
      owner_confirmed: true,
      confirmation_reference: "owner approved revocation of this exact mandate",
    };
    const substitutedTarget = await request(
      "POST",
      `/v1/host-native/standing-release/mandates/srm_${"f".repeat(40)}/revoke`,
      {
        ...revokeBody,
        owner_context: ownerContext(
          revokeBody,
          "host_native_standing_release_mandate_revoke",
        ),
      },
      ownerKey.json.key,
    );
    assert.equal(substitutedTarget.status, 400);
    assert.equal(
      substitutedTarget.json.error,
      "standing_release_mandate_target_mismatch",
    );

    const deriveBody = {
      work_id: RELEASE_WORK_ID,
      intent_anchor_digest: H("3"),
      intent_binding: intentBinding({
        workId: RELEASE_WORK_ID,
        intentDigest: H("3"),
      }),
      delivery_branch: "agent/release-one",
      changed_files: ["services/example/src/index.js"],
      builder_agent_id: "builder-one",
      verifier_agent_ids: ["verifier-one"],
      required_checks_policy_digest: hostNativeDigest(REQUIRED_POLICY),
      induced_services: body.services,
      host_kind: "codex_native",
      host_session_fingerprint: H("9"),
      ttl_seconds: 3_600,
      idempotency_key: "standing-derive-one",
    };
    const directOwner = await request(
      "POST",
      `/v1/host-native/standing-release/mandates/${mandateId}/derive-delegation`,
      deriveBody,
      automationKey.json.key,
    );
    assert.equal(directOwner.status, 403);
    assert.equal(directOwner.json.error, "standing_release_mcp_gateway_required");

    const wrongTenant = await request(
      "POST",
      `/v1/host-native/standing-release/mandates/${mandateId}/derive-delegation`,
      deriveBody,
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext("tenant-other"),
      },
    );
    assert.equal(wrongTenant.status, 403);
    assert.equal(wrongTenant.json.error, "tenant_scope_denied");

    const crossWork = await request(
      "POST",
      `/v1/host-native/standing-release/mandates/${mandateId}/derive-delegation`,
      deriveBody,
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-work-id": OTHER_WORK_ID,
      },
    );
    assert.equal(crossWork.status, 403);
    assert.equal(crossWork.json.error, "cross_work_task_tree_denied");

    const derived = await request(
      "POST",
      `/v1/host-native/standing-release/mandates/${mandateId}/derive-delegation`,
      deriveBody,
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
      },
    );
    assert.equal(derived.status, 201, JSON.stringify(derived.json));
    assert.equal(derived.json.delegation.grant.authorization_source,
      "owner_standing_release_mandate");
    assert.equal(derived.json.delegation.grant.provider_execution, false);
    assert.equal(
      derived.json.delegation.grant.standing_release_binding.horizontal_runner_required,
      true,
    );
    assert.equal(
      derived.json.delegation.grant.standing_release_binding.coordination_model,
      "horizontal_peer_adapters_v1",
    );
    assert.deepEqual(
      derived.json.delegation.grant.standing_release_binding.changed_files,
      deriveBody.changed_files,
    );
    assert.equal(
      derived.json.delegation.grant.work_intent_binding_digest,
      deriveBody.intent_binding.binding_digest,
    );
    assert.equal(
      derived.json.delegation.grant.dtt_request_binding_digest,
      H("d"),
    );
    assert.deepEqual(
      derived.json.delegation.grant.standing_release_binding.intent_binding,
      deriveBody.intent_binding,
    );

    await new Promise((resolve) => setTimeout(resolve, 2));
    const deriveReplayBody = {
      ...deriveBody,
      intent_binding: intentBinding({
        workId: RELEASE_WORK_ID,
        intentDigest: H("3"),
        verifiedAt: new Date().toISOString(),
      }),
    };
    const replayedDerivation = await request(
      "POST",
      `/v1/host-native/standing-release/mandates/${mandateId}/derive-delegation`,
      deriveReplayBody,
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-binding-digest": H("a"),
      },
    );
    assert.equal(replayedDerivation.status, 201, JSON.stringify(replayedDerivation.json));
    assert.equal(
      replayedDerivation.json.delegation.delegation_id,
      derived.json.delegation.delegation_id,
    );
    assert.equal(
      replayedDerivation.json.delegation.grant.work_intent_binding_digest,
      deriveBody.intent_binding.binding_digest,
    );
    assert.equal(
      replayedDerivation.json.delegation.grant.dtt_request_binding_digest,
      H("d"),
    );

    const changedDerivationScope = {
      ...deriveReplayBody,
      changed_files: ["services/example/src/other.js"],
    };
    const conflictingDerivation = await request(
      "POST",
      `/v1/host-native/standing-release/mandates/${mandateId}/derive-delegation`,
      changedDerivationScope,
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-binding-digest": H("b"),
      },
    );
    assert.equal(
      conflictingDerivation.status,
      409,
      JSON.stringify(conflictingDerivation.json),
    );
    assert.equal(conflictingDerivation.json.error, "idempotency_key_conflict");

    const startRunBody = {
      delegation_id: derived.json.delegation.delegation_id,
      work_id: RELEASE_WORK_ID,
      ...runIntentFields(),
      host_kind: "codex_native",
      host_session_fingerprint: H("9"),
      idempotency_key: "horizontal-run-start-api",
    };
    const directRunStart = await request(
      "POST",
      "/v1/host-native/standing-release/runs",
      startRunBody,
      automationKey.json.key,
    );
    assert.equal(directRunStart.status, 403);
    assert.equal(directRunStart.json.error, "standing_release_mcp_gateway_required");

    const crossWorkRunStart = await request(
      "POST",
      "/v1/host-native/standing-release/runs",
      startRunBody,
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-work-id": OTHER_WORK_ID,
      },
    );
    assert.equal(crossWorkRunStart.status, 403);
    assert.equal(crossWorkRunStart.json.error, "cross_work_task_tree_denied");

    const startedRun = await request(
      "POST",
      "/v1/host-native/standing-release/runs",
      startRunBody,
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-binding-digest": H("c"),
      },
    );
    assert.equal(startedRun.status, 201, JSON.stringify(startedRun.json));
    const runRecord = startedRun.json.standing_release_run;
    assert.equal(runRecord.run.coordination_model, "horizontal_peer_adapters_v1");
    assert.deepEqual(
      runRecord.run.adapter_lanes.map((lane) => lane.relationship),
      ["peer", "peer", "peer"],
    );
    assert.equal(runRecord.run.state, "COMMIT_PENDING");
    assert.equal(runRecord.dtt_request_binding_digest, H("c"));
    assert.equal(runRecord.run.provider_execution, false);

    const readRun = await request(
      "GET",
      `/v1/host-native/standing-release/runs/${runRecord.run_id}`,
      undefined,
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-work-id": RELEASE_WORK_ID,
      },
    );
    assert.equal(readRun.status, 200, JSON.stringify(readRun.json));
    assert.equal(readRun.json.standing_release_run.run.version, 1);
    assert.equal(readRun.json.standing_release_run.authority_state, "active");

    const issuedTicket = await request(
      "POST",
      "/v1/host-native/actions/authorize",
      {
        delegation_id: derived.json.delegation.delegation_id,
        work_id: RELEASE_WORK_ID,
        intent_anchor_digest: H("3"),
        repository: "owner/repo",
        host_kind: "codex_native",
        host_session_fingerprint: H("9"),
        action: {
          kind: "git.commit",
          repository: "owner/repo",
          branch: "agent/release-one",
          parent_commit: G("1"),
          tree_sha: G("2"),
          diff_digest: H("5"),
          changed_files: ["services/example/src/index.js"],
          message_digest: H("6"),
          builder_agent_id: "builder-one",
          provider_execution: false,
        },
        evidence_digest: H("7"),
        idempotency_key: "horizontal-run-ticket-api",
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
      },
    );
    assert.equal(issuedTicket.status, 201, JSON.stringify(issuedTicket.json));
    const ticketId = issuedTicket.json.action_ticket.ticket.ticket_id;
    const boundTicket = await request(
      "POST",
      `/v1/host-native/standing-release/runs/${runRecord.run_id}/bind-ticket`,
      {
        work_id: RELEASE_WORK_ID,
        ...runIntentFields(),
        ticket_id: ticketId,
        expected_version: 1,
        idempotency_key: "horizontal-run-bind-api",
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-binding-digest": H("d"),
      },
    );
    assert.equal(boundTicket.status, 200, JSON.stringify(boundTicket.json));
    assert.equal(boundTicket.json.standing_release_run.run.state, "ACTION_IN_PROGRESS");
    assert.equal(boundTicket.json.standing_release_run.run.version, 2);

    const wrongSessionAdvance = await request(
      "POST",
      `/v1/host-native/standing-release/runs/${runRecord.run_id}/advance`,
      {
        work_id: RELEASE_WORK_ID,
        ...runIntentFields(),
        ticket_id: ticketId,
        expected_version: 2,
        idempotency_key: "horizontal-run-wrong-session-api",
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-session-fingerprint": H("8"),
      },
    );
    assert.equal(wrongSessionAdvance.status, 400, JSON.stringify(wrongSessionAdvance.json));
    assert.equal(wrongSessionAdvance.json.error, "standing_release_run_session_mismatch");

    const genericReserveDenied = await request(
      "POST",
      `/v1/host-native/actions/${ticketId}/reserve`,
      {
        host_session_fingerprint: H("9"),
        idempotency_key: "horizontal-run-generic-reserve-denied",
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
      },
    );
    assert.equal(genericReserveDenied.status, 400, JSON.stringify(genericReserveDenied.json));
    assert.equal(genericReserveDenied.json.error, "standing_release_run_ticket_not_bound");

    const spoofedGenericReserve = await request(
      "POST",
      `/v1/host-native/actions/${ticketId}/reserve`,
      {
        host_session_fingerprint: H("9"),
        standing_release_run_id: runRecord.run_id,
        standing_release_run_version: 2,
        dtt_request_binding_digest: H("1"),
        idempotency_key: "horizontal-run-spoofed-generic-reserve",
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
      },
    );
    assert.equal(spoofedGenericReserve.status, 400, JSON.stringify(spoofedGenericReserve.json));
    assert.equal(
      spoofedGenericReserve.json.error,
      "standing_release_run_reservation_route_required",
    );

    const genericObserveDenied = await request(
      "POST",
      `/v1/host-native/actions/${ticketId}/observe-unreserved`,
      {
        host_session_fingerprint: H("9"),
        observed_outcome: "success",
        observed_commit: G("1"),
        readback_digest: H("2"),
        verifier_evidence_digest: H("3"),
        deviation_reason: "test recovery must remain inside the horizontal run",
        idempotency_key: "horizontal-run-generic-observe-denied",
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
      },
    );
    assert.equal(genericObserveDenied.status, 400, JSON.stringify(genericObserveDenied.json));
    assert.equal(
      genericObserveDenied.json.error,
      "standing_release_run_reservation_route_required",
    );

    const reservedTicket = await request(
      "POST",
      `/v1/host-native/standing-release/runs/${runRecord.run_id}/reserve`,
      {
        work_id: RELEASE_WORK_ID,
        ...runIntentFields(),
        ticket_id: ticketId,
        expected_version: 2,
        host_session_fingerprint: H("9"),
        idempotency_key: "horizontal-run-reserve-api",
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-binding-digest": H("e"),
      },
    );
    assert.equal(reservedTicket.status, 200, JSON.stringify(reservedTicket.json));
    assert.equal(reservedTicket.json.action_ticket.state, "reserved");

    const prematureQuarantine = await request(
      "POST",
      `/v1/host-native/standing-release/runs/${runRecord.run_id}/quarantine-expired`,
      {
        work_id: RELEASE_WORK_ID,
        ...runIntentFields(),
        ticket_id: ticketId,
        reservation_id: reservedTicket.json.action_ticket.reservation_id,
        expected_version: 2,
        idempotency_key: "horizontal-run-premature-quarantine",
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-binding-digest": H("f"),
      },
    );
    assert.equal(prematureQuarantine.status, 403, JSON.stringify(prematureQuarantine.json));
    assert.equal(
      prematureQuarantine.json.error,
      "standing_release_expired_reservation_mismatch",
    );

    const completionBody = {
      work_id: RELEASE_WORK_ID,
      ...runIntentFields(),
      ticket_id: ticketId,
      expected_version: 2,
      reservation_id: reservedTicket.json.action_ticket.reservation_id,
      host_session_fingerprint: H("9"),
      outcome: "unknown",
      result_digest: H("a"),
      result_commit: G("2"),
      idempotency_key: "horizontal-run-complete-api",
    };
    const genericCompleteDenied = await request(
      "POST",
      `/v1/host-native/actions/${ticketId}/complete`,
      {
        reservation_id: completionBody.reservation_id,
        host_session_fingerprint: H("9"),
        outcome: "unknown",
        result_digest: H("a"),
        result_commit: G("2"),
        idempotency_key: "horizontal-run-generic-complete-denied",
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
      },
    );
    assert.equal(genericCompleteDenied.status, 400, JSON.stringify(genericCompleteDenied.json));
    assert.equal(genericCompleteDenied.json.error, "standing_release_run_ticket_not_bound");

    const completedTicket = await request(
      "POST",
      `/v1/host-native/standing-release/runs/${runRecord.run_id}/complete`,
      completionBody,
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-binding-digest": H("b"),
      },
    );
    assert.equal(completedTicket.status, 200, JSON.stringify(completedTicket.json));
    assert.equal(completedTicket.json.action_ticket.state, "reconciliation_required");

    const reconciledTicket = await request(
      "POST",
      `/v1/host-native/standing-release/runs/${runRecord.run_id}/reconcile`,
      {
        work_id: RELEASE_WORK_ID,
        ...runIntentFields(),
        ticket_id: ticketId,
        expected_version: 2,
        reservation_id: reservedTicket.json.action_ticket.reservation_id,
        host_session_fingerprint: H("9"),
        observed_outcome: "success",
        observed_commit: G("2"),
        readback_digest: H("c"),
        idempotency_key: "horizontal-run-reconcile-api",
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-binding-digest": H("4"),
      },
    );
    assert.equal(reconciledTicket.status, 200, JSON.stringify(reconciledTicket.json));
    assert.equal(reconciledTicket.json.action_ticket.state, "reconciled");

    const advancedRun = await request(
      "POST",
      `/v1/host-native/standing-release/runs/${runRecord.run_id}/advance`,
      {
        work_id: RELEASE_WORK_ID,
        ...runIntentFields(),
        ticket_id: ticketId,
        expected_version: 2,
        idempotency_key: "horizontal-run-advance-api",
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-binding-digest": H("f"),
      },
    );
    assert.equal(advancedRun.status, 200, JSON.stringify(advancedRun.json));
    assert.equal(advancedRun.json.standing_release_run.run.state, "PUSH_PENDING");
    assert.equal(advancedRun.json.standing_release_run.run.version, 3);

    const cancelledRun = await request(
      "POST",
      `/v1/host-native/standing-release/runs/${runRecord.run_id}/cancel`,
      {
        work_id: RELEASE_WORK_ID,
        ...runIntentFields(),
        reason_digest: H("8"),
        expected_version: 3,
        idempotency_key: "horizontal-run-cancel-api",
      },
      TENANT_GATEWAY_KEY,
      {
        "x-sh-tenant-id": TENANT,
        "x-sh-tenant-context": tenantContext(),
        "x-test-dtt-binding-digest": H("d"),
      },
    );
    assert.equal(cancelledRun.status, 200, JSON.stringify(cancelledRun.json));
    assert.equal(cancelledRun.json.standing_release_run.run.state, "CANCELLED");
    assert.equal(cancelledRun.json.standing_release_run.transition, "cancel");
    assert.equal(cancelledRun.json.standing_release_run.run.background_execution, false);
  });
});
