import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";

const gatewayKey = "owner-profile-gateway-key-012345678901234567890";
const tenantSecret = "owner-profile-tenant-context-secret-012345678901234";
const ownerSecret = "owner-profile-context-secret-012345678901234567890";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stable(value[key])]));
}

function tenantContext(tenantId) {
  const value = { version: "mcp_tenant_context_v1", tenant_id: tenantId, issued_at: new Date().toISOString() };
  const assertion = `mtc_${crypto.createHmac("sha256", tenantSecret).update(`mcp-tenant-context\u0000${JSON.stringify(value)}`).digest("hex")}`;
  return Buffer.from(JSON.stringify({ ...value, assertion })).toString("base64url");
}

function ownerContext(tenantId, body, purpose = "work_preflight") {
  const { owner_context: _ignored, ...unsigned } = body;
  const context = {
    assertion_version: "owner_context_assertion_v1", audience: "nira_core_bridge", tenant_id: tenantId,
    access_mode: "god_mode", role: "owner_root", delegated_actor: "oauth", owner_verified: true,
    issued_at: new Date().toISOString(), binding_version: "owner_request_binding_v1",
    binding_hash: crypto.createHash("sha256").update(`${purpose}\u0000${JSON.stringify(stable(unsigned))}`).digest("hex"),
  };
  const canonical = JSON.stringify({ version: context.assertion_version, audience: context.audience, tenant_id: context.tenant_id, access_mode: context.access_mode, role: context.role, delegated_actor: context.delegated_actor, owner_verified: context.owner_verified, owner_subject_fingerprint: undefined, issued_at: context.issued_at, binding_version: context.binding_version, binding_hash: context.binding_hash, approval_digest: undefined });
  return { ...context, assertion: `ocs_${crypto.createHmac("sha256", ownerSecret).update(`owner-context\u0000${canonical}`).digest("hex")}` };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test("signed OAuth owner profile passes the gateway and receives vertical registry branches without enabling execution", async () => {
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `owner-branch-profile-${Date.now()}-${Math.random()}`),
    mcpTenantGatewayKey: gatewayKey,
    tenantContextSigningSecret: tenantSecret,
    ownerContextSigningSecret: ownerSecret,
  });
  const { server, url } = await listen(service.app);
  try {
    const body = { request: "Read Smart Desk status", operation_type: "advisory_work", tenant_id: "codexai" };
    body.owner_context = ownerContext("codexai", body);
    const response = await fetch(`${url}/v1/work/preflight`, {
      method: "POST",
      headers: { authorization: `Bearer ${gatewayKey}`, "content-type": "application/json", "x-sh-tenant-id": "codexai", "x-sh-tenant-context": tenantContext("codexai") },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.notEqual(result.error, "tenant_scope_denied");
    assert.equal(result.work_preflight.governance.execution_allowed_by_preflight, false);
    assert(result.work_preflight.core_route.selected_branches.includes("smartdesk_operations_guard"));
    assert(result.work_preflight.core_route.selected_branches.includes("suite_governance"));

    const branchBinding = { view: "authorized", branches: [] };
    const branchOwner = ownerContext("codexai", branchBinding, "branch_registry");
    const branchResponse = await fetch(`${url}/v1/branches/authorized`, {
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        "x-sh-tenant-id": "codexai",
        "x-sh-tenant-context": tenantContext("codexai"),
        "x-sh-owner-context": Buffer.from(JSON.stringify(branchOwner)).toString("base64url"),
      },
    });
    const branchResult = await branchResponse.json();
    assert.equal(branchResponse.status, 200);
    assert.equal(branchResult.branch_package.owner_profile, "tenant_scoped_verified_owner");
    assert(branchResult.branch_package.allowed_branches.includes("suite_governance"));
    assert(branchResult.branch_package.allowed_branches.includes("smartdesk_operations_guard"));

    const memberResponse = await fetch(`${url}/v1/branches/authorized`, {
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        "x-sh-tenant-id": "codexai",
        "x-sh-tenant-context": tenantContext("codexai"),
      },
    });
    const memberResult = await memberResponse.json();
    assert.equal(memberResponse.status, 200);
    assert.equal(memberResult.branch_package.owner_profile, undefined);
    assert.equal(memberResult.branch_package.allowed_branches.includes("suite_governance"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
