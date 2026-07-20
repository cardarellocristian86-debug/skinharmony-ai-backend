import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";
import {
  DEFAULT_AUTOMATION_SCOPES,
  DEFAULT_CONNECTOR_SCOPES,
  KEY_PRESETS,
  SCOPES,
} from "../src/scope.js";
import { providerSetupLinkBindingApprovalDigest } from "../src/providerSetupLinkBinding.js";

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function request(base, method, pathname, body, key) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

const OWNER_SUBJECT_FINGERPRINT = `osf_${"a".repeat(64)}`;

function signedOwnerContext(tenantId, signingSecret, approvalDigest, issuedAt = new Date().toISOString(), tenantOwner = false) {
  const context = {
    assertion_version: "owner_context_assertion_v1",
    audience: "nira_core_bridge",
    tenant_id: tenantId,
    access_mode: tenantOwner ? "tenant_owner" : "god_mode",
    role: tenantOwner ? "tenant_owner" : "owner_root",
    // The provider setup route accepts only the OAuth owner assertion emitted
    // by the browser connection. A test-only delegated actor would make this
    // look like an MCP bearer bypass rather than exercising the real gate.
    delegated_actor: "oauth",
    owner_verified: true,
    owner_subject_fingerprint: OWNER_SUBJECT_FINGERPRINT,
    issued_at: issuedAt,
    approval_digest: approvalDigest,
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
    approval_digest: context.approval_digest,
  });
  return {
    ...context,
    assertion: `ocs_${crypto.createHmac("sha256", signingSecret)
      .update(`owner-context\u0000${canonical}`)
      .digest("hex")}`,
  };
}

function providerSetupLinkBindingEnvelope(overrides = {}) {
  const targetCommit = "18b689e5cde9622a280b9d34651dc18ec2d675a8";
  return {
    action_type: "render_blueprint_environment_binding",
    action_label: "Bind Core provider setup-link validation",
    operation_class: "reversible_owner_confirmed_provider_setup_link_blueprint_binding",
    // Both identifiers are deliberately overwritten by the authenticated Core
    // request path. Tests below use divergent caller values to prove it.
    authenticated_tenant_id: "caller-supplied-tenant",
    tenant_id: "codexai",
    external_side_effect: true,
    contains_customer_data: false,
    contains_secret: false,
    secret_value_transmitted: false,
    cross_tenant: false,
    destructive: false,
    bypass_orchestrator: false,
    rollback_ready: true,
    audit_ready: true,
    configuration_changes: true,
    environment: "production",
    target_branch: "main",
    resource_type: "render_blueprint_from_service_env_binding",
    render_blueprint_id: "exs-d99edqgki2s73e29nug",
    blueprint_path: "render-universal-core.yaml",
    source_service: "skinharmony-core-mcp",
    target_service: "skinharmony-universal-core",
    source_environment_variable: "CORE_PROVIDER_SETUP_LINK_KEY",
    target_environment_variable: "CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY",
    tenant_environment_variable: "CORE_PROVIDER_SETUP_LINK_TENANT_ID",
    tenant_environment_value: "codexai",
    create_new: false,
    rotate_existing: false,
    delete: false,
    merge: false,
    production_deploy: false,
    deploy: false,
    auth0_changes: false,
    provider_execution: false,
    execution_enabled: false,
    force: false,
    admin_bypass: false,
    allowed_environment_variables: ["CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY", "CORE_PROVIDER_SETUP_LINK_TENANT_ID"],
    target_commit: targetCommit,
    confirmation_target_commit: targetCommit,
    confirmation_target_branch: "main",
    confirmation_render_blueprint_id: "exs-d99edqgki2s73e29nug",
    confirmation_blueprint_path: "render-universal-core.yaml",
    confirmation_source_service: "skinharmony-core-mcp",
    confirmation_target_service: "skinharmony-universal-core",
    confirmation_source_environment_variable: "CORE_PROVIDER_SETUP_LINK_KEY",
    confirmation_target_environment_variable: "CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY",
    confirmation_tenant_id: "codexai",
    confirmation_reference: "owner confirmed exact provider setup-link Blueprint binding",
    owner_confirmed: true,
    ...overrides,
  };
}

function withSignedOwnerContext(envelope, tenantId, signingSecret) {
  return {
    ...envelope,
    owner_context: signedOwnerContext(
      tenantId,
      signingSecret,
      providerSetupLinkBindingApprovalDigest(envelope, tenantId),
    ),
  };
}

test("provider setup-link issuance requires the bound bootstrap key and a signed OAuth owner proof", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "provider-setup-scope-admin";
  const ownerContextSigningSecret = "provider-setup-owner-context-signing-secret";
  const providerSetupLinkBootstrapKey = "provider-setup-scope-bound-bootstrap-key";
  const issued = [];
  const tenantProviderSetupLinks = {
    async issue(input) {
      issued.push(input);
      return {
        token: "local_test_setup_token_abcdefghijklmnopqrstuvwxyz",
        proof: "local_test_setup_proof_abcdefghijklmnopqrstuvwxyz",
        link_id: "psl_local_test_setup_link",
        expires_at: "2026-07-18T20:00:00.000Z",
      };
    },
  };
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `provider-setup-scope-${Date.now()}-${Math.random()}`),
    tenantProviderSetupLinks,
    providerSetupLinkBootstrapKey,
    providerSetupLinkTenantId: "codexai",
    ownerContextSigningSecret,
  });
  const { server, base } = await listen(service.app);

  try {
    assert.equal(SCOPES.WRITE_PROVIDER_SETUP_LINK, "write:provider_setup_link");
    assert.equal(DEFAULT_CONNECTOR_SCOPES.includes(SCOPES.WRITE_PROVIDER_SETUP_LINK), false);
    assert.equal(DEFAULT_AUTOMATION_SCOPES.includes(SCOPES.WRITE_PROVIDER_SETUP_LINK), false);
    for (const preset of Object.values(KEY_PRESETS)) {
      assert.equal(preset.scopes.includes(SCOPES.WRITE_PROVIDER_SETUP_LINK), false);
    }

    const dedicated = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "codexai",
      key_type: "connector",
      label: "Tenant-scoped MCP provider setup-link test",
      allowed_scopes: [SCOPES.WRITE_PROVIDER_SETUP_LINK],
    }, "provider-setup-scope-admin");
    assert.equal(dedicated.status, 201);
    assert.deepEqual(dedicated.json.record.allowed_scopes, [SCOPES.WRITE_PROVIDER_SETUP_LINK]);

    const broadLegacy = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "codexai",
      key_type: "connector",
      label: "Legacy decision writer",
      allowed_scopes: [SCOPES.WRITE_DECISION],
    }, "provider-setup-scope-admin");
    assert.equal(broadLegacy.status, 201);

    const deniedLegacy = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", {
      tenant_id: "codexai",
      ttl_minutes: 15,
    }, broadLegacy.json.key);
    assert.equal(deniedLegacy.status, 403);
    assert.equal(deniedLegacy.json.error, "scope_denied");

    const missingOwnerProof = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", {
      tenant_id: "codexai",
      ttl_minutes: 15,
    }, providerSetupLinkBootstrapKey);
    assert.equal(missingOwnerProof.status, 403);
    assert.equal(missingOwnerProof.json.error, "owner_context_required");
    assert.equal(issued.length, 0);

    const manuallyScoped = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", {
      tenant_id: "codexai",
      ttl_minutes: 15,
      owner_context: signedOwnerContext("codexai", ownerContextSigningSecret, ""),
    }, dedicated.json.key);
    assert.equal(manuallyScoped.status, 403);
    assert.equal(manuallyScoped.json.error, "provider_setup_link_issuer_required");

    const allowed = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", {
      tenant_id: "codexai",
      ttl_minutes: 15,
      owner_context: signedOwnerContext("codexai", ownerContextSigningSecret, ""),
    }, providerSetupLinkBootstrapKey);
    assert.equal(allowed.status, 201);
    assert.equal(allowed.json.tenant_id, "codexai");
    assert.equal(allowed.json.execution_enabled, false);
    assert.match(allowed.json.setup_url, /\/v1\/generic-agents\/providers\/openai\/setup\//);
    assert.equal(allowed.json.setup_proof, "local_test_setup_proof_abcdefghijklmnopqrstuvwxyz");
    assert.equal(allowed.json.setup_url.includes(allowed.json.setup_proof), false);
    assert.deepEqual(issued, [{
      tenant_id: "codexai",
      owner_subject_fingerprint: OWNER_SUBJECT_FINGERPRINT,
      ttl_minutes: 15,
    }]);

    const crossTenant = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", {
      tenant_id: "another-tenant",
      ttl_minutes: 15,
      owner_context: signedOwnerContext("another-tenant", ownerContextSigningSecret, ""),
    }, providerSetupLinkBootstrapKey);
    assert.equal(crossTenant.status, 403);
    assert.equal(crossTenant.json.error, "tenant_scope_denied");
    assert.equal(issued.length, 1);

    const unrelatedWrite = await request(base, "POST", "/v1/generic-agents/runs", {
      tenant_id: "codexai",
      agent_id: "must-not-start",
      task: "This key cannot acquire generic write authority",
    }, dedicated.json.key);
    assert.equal(unrelatedWrite.status, 403);
    assert.equal(unrelatedWrite.json.error, "scope_denied");

    const directWrite = await request(base, "PUT", "/v1/generic-agents/providers/openai", {
      api_key: "sk-proj-must-never-be-accepted-through-a-core-bearer-key",
    }, broadLegacy.json.key);
    assert.equal(directWrite.status, 410);
    assert.equal(directWrite.json.error, "provider_setup_link_required");
    assert.equal(JSON.stringify(directWrite.json).includes("sk-proj-must-never-be-accepted"), false);

    const directDelete = await request(base, "DELETE", "/v1/generic-agents/providers/openai", {
      owner_confirmed: true,
    }, broadLegacy.json.key);
    assert.equal(directDelete.status, 410);
    assert.equal(directDelete.json.error, "provider_setup_link_required");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

test("a service issuer is limited to each signed tenant-owner context", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "provider-setup-service-admin";
  const signingSecret = "provider-setup-service-owner-context-signing-secret";
  const serviceKey = "provider-setup-service-key";
  const issued = [];
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `provider-setup-service-${Date.now()}-${Math.random()}`),
    providerSetupLinkServiceKey: serviceKey,
    ownerContextSigningSecret: signingSecret,
    tenantProviderSetupLinks: { async issue(input) { issued.push(input); return { token: "local_test_setup_token_abcdefghijklmnopqrstuvwxyz", proof: "local_test_setup_proof_abcdefghijklmnopqrstuvwxyz", link_id: "psl_local_test_setup_link", expires_at: "2030-01-01T00:00:00.000Z" }; } },
  });
  const { server, base } = await listen(service.app);
  try {
    const ownerA = signedOwnerContext("tenant-a", signingSecret, "", new Date().toISOString(), true);
    const allowedA = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", { tenant_id: "tenant-a", owner_context: ownerA }, serviceKey);
    assert.equal(allowedA.status, 201);
    assert.equal(allowedA.json.tenant_id, "tenant-a");

    const forged = { ...ownerA, tenant_id: "tenant-b" };
    const denied = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", { tenant_id: "tenant-b", owner_context: forged }, serviceKey);
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error, "owner_context_required");

    const ownerB = signedOwnerContext("tenant-b", signingSecret, "", new Date().toISOString(), true);
    const allowedB = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", { tenant_id: "tenant-b", owner_context: ownerB }, serviceKey);
    assert.equal(allowedB.status, 201);
    assert.deepEqual(issued.map((entry) => entry.tenant_id), ["tenant-a", "tenant-b"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

test("provider setup-link Blueprint binding requires a signed owner context and the authenticated codexai tenant", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "provider-binding-policy-admin";
  const ownerContextSigningSecret = "provider-binding-owner-context-signing-secret";
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `provider-binding-policy-${Date.now()}-${Math.random()}`),
    ownerContextSigningSecret,
  });
  const { server, base } = await listen(service.app);

  try {
    const codexai = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "codexai",
      key_type: "connector",
      label: "Core evaluation key for provider binding",
      allowed_scopes: [SCOPES.READ_DECISION],
    }, "provider-binding-policy-admin");
    assert.equal(codexai.status, 201);

    const anotherTenant = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "tenant-a",
      key_type: "connector",
      label: "Other tenant Core evaluation key",
      allowed_scopes: [SCOPES.READ_DECISION],
    }, "provider-binding-policy-admin");
    assert.equal(anotherTenant.status, 201);

    const validEnvelope = providerSetupLinkBindingEnvelope();
    const valid = await request(
      base,
      "POST",
      "/v1/action-evaluator",
      withSignedOwnerContext(validEnvelope, "codexai", ownerContextSigningSecret),
      codexai.json.key,
    );
    assert.equal(valid.status, 200);
    assert.equal(valid.json.tenant_id, "codexai");
    assert.equal(valid.json.authorization.allowed, true);
    assert.equal(valid.json.authorization.scope, "reversible_owner_confirmed_provider_setup_link_blueprint_binding");

    const bearerSignedEnvelope = providerSetupLinkBindingEnvelope();
    const bearerSigned = await request(
      base,
      "POST",
      "/v1/action-evaluator",
      withSignedOwnerContext(bearerSignedEnvelope, "codexai", codexai.json.key),
      codexai.json.key,
    );
    assert.equal(bearerSigned.status, 200);
    assert.equal(bearerSigned.json.authorization.allowed, false);
    assert.equal(bearerSigned.json.authorization.state, "confirmation_required");
    assert.equal(bearerSigned.json.guardrail.execution_allowed, false);

    const wrongDigestEnvelope = providerSetupLinkBindingEnvelope();
    const wrongDigest = providerSetupLinkBindingApprovalDigest({
      ...wrongDigestEnvelope,
      owner_confirmed: false,
    }, "codexai");
    const wrongDigestSignature = await request(base, "POST", "/v1/action-evaluator", {
      ...wrongDigestEnvelope,
      owner_context: signedOwnerContext("codexai", ownerContextSigningSecret, wrongDigest),
    }, codexai.json.key);
    assert.equal(wrongDigestSignature.status, 200);
    assert.equal(wrongDigestSignature.json.authorization.allowed, false);
    assert.equal(wrongDigestSignature.json.authorization.confirmation_satisfied, false);

    const unexpectedFieldEnvelope = {
      ...providerSetupLinkBindingEnvelope(),
      unexpected_render_change: true,
    };
    const unexpectedField = await request(
      base,
      "POST",
      "/v1/action-evaluator",
      withSignedOwnerContext(unexpectedFieldEnvelope, "codexai", ownerContextSigningSecret),
      codexai.json.key,
    );
    assert.equal(unexpectedField.status, 200);
    assert.equal(unexpectedField.json.authorization.allowed, false);
    assert.equal(unexpectedField.json.authorization.state, "blocked");

    const staleEnvelope = providerSetupLinkBindingEnvelope();
    const staleOwnerContext = signedOwnerContext(
      "codexai",
      ownerContextSigningSecret,
      providerSetupLinkBindingApprovalDigest(staleEnvelope, "codexai"),
      new Date(Date.now() - 180_000).toISOString(),
    );
    const stale = await request(base, "POST", "/v1/action-evaluator", {
      ...staleEnvelope,
      owner_context: staleOwnerContext,
    }, codexai.json.key);
    assert.equal(stale.status, 200);
    assert.equal(stale.json.authorization.allowed, false);

    const futureEnvelope = providerSetupLinkBindingEnvelope();
    const futureOwnerContext = signedOwnerContext(
      "codexai",
      ownerContextSigningSecret,
      providerSetupLinkBindingApprovalDigest(futureEnvelope, "codexai"),
      new Date(Date.now() + 60_000).toISOString(),
    );
    const future = await request(base, "POST", "/v1/action-evaluator", {
      ...futureEnvelope,
      owner_context: futureOwnerContext,
    }, codexai.json.key);
    assert.equal(future.status, 200);
    assert.equal(future.json.authorization.allowed, false);

    const unconfirmedEnvelope = providerSetupLinkBindingEnvelope({ owner_confirmed: false });
    const unconfirmed = await request(
      base,
      "POST",
      "/v1/action-evaluator",
      withSignedOwnerContext(unconfirmedEnvelope, "codexai", ownerContextSigningSecret),
      codexai.json.key,
    );
    assert.equal(unconfirmed.status, 200);
    assert.equal(unconfirmed.json.authorization.allowed, false);
    assert.equal(unconfirmed.json.authorization.confirmation_satisfied, false);

    const forgedVerificationFlag = await request(base, "POST", "/v1/action-evaluator", providerSetupLinkBindingEnvelope({
      owner_context_verified: true,
    }), codexai.json.key);
    assert.equal(forgedVerificationFlag.status, 200);
    assert.equal(forgedVerificationFlag.json.authorization.allowed, false);
    assert.equal(forgedVerificationFlag.json.authorization.state, "confirmation_required");
    assert.equal(forgedVerificationFlag.json.authorization.confirmation_satisfied, false);
    assert.equal(forgedVerificationFlag.json.guardrail.execution_allowed, false);

    const wrongTenantEnvelope = providerSetupLinkBindingEnvelope({
      tenant_id: "tenant-a",
      authenticated_tenant_id: "codexai",
    });
    const wrongTenant = await request(
      base,
      "POST",
      "/v1/action-evaluator",
      withSignedOwnerContext(wrongTenantEnvelope, "tenant-a", ownerContextSigningSecret),
      anotherTenant.json.key,
    );
    assert.equal(wrongTenant.status, 200);
    assert.equal(wrongTenant.json.tenant_id, "tenant-a");
    assert.equal(wrongTenant.json.authorization.allowed, false);

    const crossTenantEnvelope = providerSetupLinkBindingEnvelope({
      tenant_id: "codexai",
      authenticated_tenant_id: "codexai",
    });
    const crossTenantClaim = await request(
      base,
      "POST",
      "/v1/action-evaluator",
      withSignedOwnerContext(crossTenantEnvelope, "tenant-a", ownerContextSigningSecret),
      anotherTenant.json.key,
    );
    assert.equal(crossTenantClaim.status, 403);
    assert.equal(crossTenantClaim.json.error, "tenant_scope_denied");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});
