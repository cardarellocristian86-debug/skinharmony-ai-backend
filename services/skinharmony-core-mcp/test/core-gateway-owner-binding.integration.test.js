import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCoreHandlers, createCoreWriteGuard } from "../src/core-handlers.js";
import { createUniversalCoreService } from "../../universal-core-service/src/app.js";

const GATEWAY_KEY = "integration-tenant-gateway-key-0123456789";
const OWNER_SECRET = "integration-owner-context-secret-0123456789";
const WRONG_OWNER_SECRET = "integration-wrong-owner-secret-0123456789";
const TENANT_CONTEXT_SECRET = "integration-tenant-context-secret-0123456789";

function ownerAssertion(secret, context) {
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
    approval_digest: context.approval_digest,
  });
  return `ocs_${crypto.createHmac("sha256", secret)
    .update(`owner-context\u0000${canonical}`)
    .digest("hex")}`;
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

function coreConfig(origin, ownerContextSigningSecret = OWNER_SECRET) {
  return {
    universalCoreUrl: origin,
    tenantGatewayKey: GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
    ownerContextSigningSecret,
  };
}

test("MCP keeps Work Preflight on the owner secret and binds Action Evaluator to the gateway bearer", async () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "core-owner-domain-binding-"));
  const service = createUniversalCoreService({
    storageRoot,
    mcpTenantGatewayKey: GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
    ownerContextSigningSecret: OWNER_SECRET,
  });
  const { server, origin } = await listen(service.app);

  const ownerRootIdentity = {
    tenantId: "codexai",
    kind: "oauth",
    subject: "auth0|owner-root",
    role: "owner_root",
    godMode: true,
    ownerConfirmed: true,
    confirmationReference: "verify the owner-scoped preflight",
  };
  const tenantOwnerIdentity = {
    tenantId: "tenant-a",
    kind: "oauth",
    subject: "auth0|tenant-owner",
    role: "tenant_owner",
    oauthOwnerElevated: true,
    ownerConfirmed: true,
    confirmationReference: "create the first persistent Work Identity",
  };
  const preflightRequest = {
    request: "inspect the owner tenant workspace",
    agent_id: "codex-owner-binding-test",
    client_type: "codex",
    session_id: "owner-binding-integration-session",
    response_mode: "full",
  };
  const bootstrapAction = {
    action_label: "Create persistent Work Identity",
    action_type: "work.continuity.create",
    target: "tenant-a/project-a",
    operation_class: "owner_confirmed_governed_action",
    external_side_effect: false,
    destructive: false,
    bounded_scope: true,
    low_impact: false,
    idempotent_or_compensable: true,
    rollback_ready: true,
    audit_ready: true,
    target_authority_verified: true,
    actor_authorized_for_target: true,
  };

  try {
    const handlers = createCoreHandlers(coreConfig(origin));
    const ownerPreflight = await handlers.work_preflight(preflightRequest, ownerRootIdentity);
    assert.equal(
      ownerPreflight.structuredContent.work_preflight.domain_pack.id,
      "owner_tenant_scoped",
    );

    const wrongPreflightHandlers = createCoreHandlers(coreConfig(origin, WRONG_OWNER_SECRET));
    const genericPreflight = await wrongPreflightHandlers.work_preflight(
      { ...preflightRequest, session_id: "wrong-owner-preflight-session" },
      ownerRootIdentity,
    );
    assert.equal(genericPreflight.structuredContent.work_preflight.domain_pack.id, "generic");
    assert.equal(
      genericPreflight.structuredContent.work_preflight.governance.owner_confirmation_satisfied,
      false,
    );

    const guard = createCoreWriteGuard(coreConfig(origin));
    const allowed = await guard(bootstrapAction, tenantOwnerIdentity);
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.confirmation_satisfied, true);

    const resignWithOwnerSecret = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname !== "/v1/action-evaluator" || typeof init.body !== "string") {
        return fetch(input, init);
      }
      const body = JSON.parse(init.body);
      if (body.owner_context?.assertion) {
        body.owner_context.assertion = ownerAssertion(OWNER_SECRET, body.owner_context);
      }
      return fetch(input, { ...init, body: JSON.stringify(body) });
    };
    const wronglySignedGuard = createCoreWriteGuard(coreConfig(origin), {
      fetchImpl: resignWithOwnerSecret,
    });
    const denied = await wronglySignedGuard(bootstrapAction, tenantOwnerIdentity);
    assert.equal(denied.allowed, false);
    assert.equal(denied.confirmation_satisfied, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});
