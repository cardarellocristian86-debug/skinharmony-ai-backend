import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildActionAuthorization } from "../src/actionAuthorization.js";
import { createUniversalCoreService } from "../src/app.js";
import {
  RENDER_STAGING_RECEIPT_AUDIENCE,
  RENDER_STAGING_RECEIPT_ISSUER,
  RENDER_STAGING_RECEIPT_TYPE,
  createRenderStagingCoreReceiptIssuer,
} from "../src/renderStagingCoreReceiptIssuer.js";
import { SCOPES } from "../src/scope.js";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SERVICE_ID = "srv-0123456789abcdef";
const KID = "render-staging-core-test-key";
const DIGEST = "a".repeat(64);

function contract(overrides = {}) {
  return {
    state: "attention",
    risk_band: "high",
    control_level: "confirm",
    recommended_actions: [{ blocked: false }],
    ...overrides,
  };
}

function deployAction(overrides = {}) {
  return {
    operation_class: "request_bound_owner_confirmed_staging_deploy",
    action_type: "render_staging_deploy",
    target: "render_staging_deploy",
    authenticated_tenant_id: "codexai",
    tenant_id: "codexai",
    authenticated_key_type: "connector",
    owner_confirmed: true,
    owner_context_verified: true,
    request_bound_owner_confirmation: true,
    external_side_effect: true,
    contains_customer_data: false,
    contains_secret: false,
    secret_value_transmitted: false,
    cross_tenant: false,
    configuration_changes: false,
    provider_execution: true,
    deploy: true,
    production_deploy: false,
    merge: false,
    delete: false,
    auth0_changes: false,
    database_changes: false,
    modify_environment_variables: false,
    clear_build_cache: false,
    destructive: true,
    bounded_scope: true,
    low_impact: false,
    idempotent_or_compensable: false,
    rollback_ready: false,
    audit_ready: true,
    target_authority_verified: true,
    actor_authorized_for_target: true,
    receipt_required: true,
    receipt_type: RENDER_STAGING_RECEIPT_TYPE,
    receipt_single_use: true,
    actor_subject_sha256: DIGEST,
    confirmation_reference_sha256: "b".repeat(64),
    catalog_revision: "c".repeat(64),
    dynamic_capability_arguments_digest: "d".repeat(64),
    idempotency_key_sha256: "e".repeat(64),
    target_service_id: SERVICE_ID,
    target_service: "skinharmony-universal-core-staging",
    target_environment: "staging",
    target_branch: "agent/nyra-policy-registry",
    target_commit: COMMIT,
    confirmation_reference: "owner-confirmed-exact-staging-deploy",
    ...overrides,
  };
}

function keyMaterial() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateJwk: privateKey.export({ format: "jwk" }),
    publicKey,
  };
}

function parseAndVerifyReceipt(receipt, publicKey) {
  const parts = String(receipt).split(".");
  assert.equal(parts.length, 3);
  assert.equal(
    crypto.verify(
      null,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKey,
      Buffer.from(parts[2], "base64url"),
    ),
    true,
  );
  return {
    header: JSON.parse(Buffer.from(parts[0], "base64url")),
    claims: JSON.parse(Buffer.from(parts[1], "base64url")),
  };
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function signedActionOwnerContext(key, tenantId, body) {
  const { owner_context: _ownerContext, ...payload } = body;
  const binding = `core_action_evaluator\u0000${JSON.stringify(stableCanonical(payload))}`;
  const context = {
    assertion_version: "owner_context_assertion_v1",
    audience: "nira_core_bridge",
    tenant_id: tenantId,
    access_mode: "god_mode",
    role: "owner_root",
    delegated_actor: "render_staging_core_receipt_test",
    owner_verified: true,
    issued_at: new Date().toISOString(),
    binding_version: "owner_request_binding_v1",
    binding_hash: crypto.createHash("sha256").update(binding).digest("hex"),
  };
  const canonical = JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
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

function httpEnvelope() {
  const body = deployAction();
  for (const field of [
    "authenticated_tenant_id",
    "tenant_id",
    "authenticated_key_type",
    "owner_context_verified",
    "request_bound_owner_confirmation",
  ]) delete body[field];
  return body;
}

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

test("authorizes only the exact request-bound staging deploy policy", () => {
  const body = deployAction();
  const result = buildActionAuthorization(contract(), body);
  assert.equal(result.allowed, true);
  assert.equal(result.scope, "request_bound_owner_confirmed_staging_deploy");
  assert.equal(result.confirmation_satisfied, true);
  assert.equal(result.target_commit, COMMIT);

  const unsafeChanges = [
    { authenticated_tenant_id: "other" },
    { owner_context_verified: false },
    { request_bound_owner_confirmation: false },
    { contains_customer_data: true },
    { contains_secret: true },
    { secret_value_transmitted: true },
    { cross_tenant: true },
    { configuration_changes: true },
    { provider_execution: false },
    { deploy: false },
    { production_deploy: true },
    { merge: true },
    { delete: true },
    { auth0_changes: true },
    { database_changes: true },
    { modify_environment_variables: true },
    { clear_build_cache: true },
    { destructive: false },
    { low_impact: true },
    { idempotent_or_compensable: true },
    { rollback_ready: true },
    { receipt_type: "other_receipt" },
    { receipt_single_use: false },
    { idempotency_key_sha256: "invalid" },
    { target_service_id: "invalid-service-id" },
    { target_service: "skinharmony-core-mcp-staging" },
    { target_environment: "production" },
    { target_branch: "main" },
    { target_commit: "not-a-full-commit" },
  ];
  for (const change of unsafeChanges) {
    const denied = buildActionAuthorization(contract(), deployAction(change));
    assert.equal(denied.allowed, false, JSON.stringify(change));
    assert.equal(denied.state, "blocked", JSON.stringify(change));
    assert.equal(denied.mediation, "hard_block", JSON.stringify(change));
  }
});

test("issues a short-lived Ed25519 receipt bound to the exact approved request", () => {
  const { privateJwk, publicKey } = keyMaterial();
  const timestamp = Date.parse("2026-07-29T12:00:00.000Z");
  const issuer = createRenderStagingCoreReceiptIssuer({
    privateJwk,
    kid: KID,
    serviceId: SERVICE_ID,
    now: () => timestamp,
  });
  const body = deployAction();
  const authorization = buildActionAuthorization(contract(), body);
  const receipt = issuer.issue({ tenantId: "codexai", body, authorization });
  const { header, claims } = parseAndVerifyReceipt(receipt, publicKey);

  assert.deepEqual(header, {
    alg: "EdDSA",
    kid: KID,
    typ: RENDER_STAGING_RECEIPT_TYPE,
  });
  assert.equal(claims.receipt_type, RENDER_STAGING_RECEIPT_TYPE);
  assert.equal(claims.iss, RENDER_STAGING_RECEIPT_ISSUER);
  assert.equal(claims.aud, RENDER_STAGING_RECEIPT_AUDIENCE);
  assert.equal(claims.tenant_id, "codexai");
  assert.equal(claims.capability_id, "render_staging_deploy");
  assert.equal(claims.target_service_id, SERVICE_ID);
  assert.equal(claims.target_commit, COMMIT);
  assert.equal(claims.single_use, true);
  assert.ok(claims.jti.startsWith("render-staging-"));
  assert.ok(claims.exp > claims.iat);
  assert.ok(claims.exp - claims.iat <= 30);

  assert.throws(
    () => issuer.issue({
      tenantId: "codexai",
      body: deployAction({ target_commit: "f".repeat(40) }),
      authorization,
    }),
    /render_staging_core_receipt_binding_invalid/,
  );
  assert.throws(
    () => issuer.issue({
      tenantId: "codexai",
      body: deployAction({ target_service_id: "srv-other00000000" }),
      authorization,
    }),
    /render_staging_core_receipt_binding_invalid/,
  );
});

test("HTTP evaluator emits a verifiable receipt and rejects a rebound request", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "render-staging-core-receipt-http-admin";
  const { privateJwk, publicKey } = keyMaterial();
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `render-staging-receipt-${Date.now()}-${Math.random()}`),
    renderStagingCoreReceiptPrivateJwk: privateJwk,
    renderStagingCoreReceiptKid: KID,
    renderStagingServiceId: SERVICE_ID,
  });
  const { server, base } = await listen(service.app);

  try {
    const connector = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "codexai",
      key_type: "connector",
      label: "Render staging receipt HTTP integration",
      allowed_scopes: [SCOPES.READ_DECISION, SCOPES.OWNER_ASSERTION],
    }, "render-staging-core-receipt-http-admin");
    assert.equal(connector.status, 201);

    const envelope = httpEnvelope();
    const ownerContext = signedActionOwnerContext(connector.json.key, "codexai", envelope);
    const authorized = await request(base, "POST", "/v1/action-evaluator", {
      ...envelope,
      owner_context: ownerContext,
    }, connector.json.key);
    assert.equal(authorized.status, 200);
    assert.equal(
      authorized.json.authorization.allowed,
      true,
      JSON.stringify({
        authorization: authorized.json.authorization,
        decision_contract: authorized.json.decision_contract,
        risk_classification: authorized.json.risk_classification,
      }),
    );
    assert.equal(
      authorized.json.authorization.scope,
      "request_bound_owner_confirmed_staging_deploy",
    );
    const { claims } = parseAndVerifyReceipt(
      authorized.json.authorization.core_receipt,
      publicKey,
    );
    assert.equal(claims.target_commit, COMMIT);
    assert.equal(claims.target_service_id, SERVICE_ID);

    const rebound = await request(base, "POST", "/v1/action-evaluator", {
      ...envelope,
      target_commit: "f".repeat(40),
      owner_context: ownerContext,
    }, connector.json.key);
    assert.equal(rebound.status, 200);
    assert.equal(rebound.json.authorization.allowed, false);
    assert.equal(rebound.json.authorization.state, "blocked");
    assert.equal(rebound.json.authorization.core_receipt, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

test("HTTP evaluator fails closed when the staging receipt issuer is unavailable", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "render-staging-no-issuer-http-admin";
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `render-staging-no-issuer-${Date.now()}-${Math.random()}`),
  });
  const { server, base } = await listen(service.app);

  try {
    const connector = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "codexai",
      key_type: "connector",
      label: "Render staging missing issuer integration",
      allowed_scopes: [SCOPES.READ_DECISION, SCOPES.OWNER_ASSERTION],
    }, "render-staging-no-issuer-http-admin");
    assert.equal(connector.status, 201);

    const envelope = httpEnvelope();
    const response = await request(base, "POST", "/v1/action-evaluator", {
      ...envelope,
      owner_context: signedActionOwnerContext(connector.json.key, "codexai", envelope),
    }, connector.json.key);
    assert.equal(response.status, 503);
    assert.equal(response.json.error, "render_staging_core_receipt_issuer_unavailable");
    assert.equal(response.json.core_receipt, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});
