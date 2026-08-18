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
    owner_subject_fingerprint: `osf_${"a".repeat(64)}`,
    issued_at: new Date().toISOString(), binding_version: "owner_request_binding_v1",
    binding_hash: crypto.createHash("sha256").update(`${purpose}\u0000${JSON.stringify(stable(unsigned))}`).digest("hex"),
  };
  const canonical = JSON.stringify({ version: context.assertion_version, audience: context.audience, tenant_id: context.tenant_id, access_mode: context.access_mode, role: context.role, delegated_actor: context.delegated_actor, owner_verified: context.owner_verified, owner_subject_fingerprint: context.owner_subject_fingerprint, issued_at: context.issued_at, binding_version: context.binding_version, binding_hash: context.binding_hash, approval_digest: undefined });
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
    const body = {
      request: "Read Smart Desk status",
      operation_type: "advisory_work",
      tenant_id: "codexai",
      memory_context: {
        schema_version: "tenant_memory_context_v1",
        tenant_id: "codexai",
        revision: 1,
        relevant_memories: [],
        pending_handoffs: [],
        recent_activity: [],
      },
      gallery_context: {
        schema_version: "tenant_work_gallery_v1",
        tenant_id: "codexai",
        available: true,
        state: "ready",
        works: [{
          work_id: "11111111-1111-4111-8111-111111111111",
          project_id: "owner-active-advisory-test",
          status: "active",
          current_version: 1,
        }],
      },
    };
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
    assert.equal(branchResult.branch_package.advisory_activation.active_branch_count, 74);
    assert.equal(branchResult.branch_package.advisory_activation.execution_authorized, false);
    assert.equal(branchResult.branch_package.allowed_branches.length, 74);
    assert(branchResult.branch_package.allowed_branches.includes("suite_governance"));
    assert(branchResult.branch_package.allowed_branches.includes("smartdesk_operations_guard"));
    assert.equal(branchResult.branch_package.allowed_branches.includes("beauty_protocol_guard"), false);
    assert.equal(branchResult.branch_package.allowed_branches.includes("nyra_finance_beauty_test"), false);

    const statusOwner = ownerContext("codexai", { view: "tenant_status" }, "control_plane_read");
    const statusResponse = await fetch(`${url}/v1/tenant/status`, {
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        "x-sh-tenant-id": "codexai",
        "x-sh-tenant-context": tenantContext("codexai"),
        "x-sh-owner-context": Buffer.from(JSON.stringify(statusOwner)).toString("base64url"),
      },
    });
    const statusResult = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(statusResult.active_branches.length, 11);
    assert.equal(statusResult.owner_active_advisory.active_branch_count, 74);
    assert.equal(statusResult.owner_active_advisory.execution_authorized, false);

    const entitlementOwner = ownerContext("codexai", { view: "entitlements" }, "control_plane_read");
    const entitlementResponse = await fetch(`${url}/v1/entitlements/current`, {
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        "x-sh-tenant-id": "codexai",
        "x-sh-tenant-context": tenantContext("codexai"),
        "x-sh-owner-context": Buffer.from(JSON.stringify(entitlementOwner)).toString("base64url"),
      },
    });
    const entitlementResult = await entitlementResponse.json();
    assert.equal(entitlementResponse.status, 200);
    assert.equal(entitlementResult.entitlement.branches.length, 11);
    assert.equal(entitlementResult.entitlement.advisory_activation, undefined);
    assert.equal(entitlementResult.owner_active_advisory.active_branch_count, 74);

    const analyzeBody = { request: "Review the Suite governance posture", work_preflight: result.work_preflight };
    const analyzeOwner = ownerContext("codexai", { ...analyzeBody, branch: "suite_governance" }, "branch_analyze");
    const analyzeResponse = await fetch(`${url}/v1/branches/suite_governance/analyze`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        "content-type": "application/json",
        "x-sh-tenant-id": "codexai",
        "x-sh-tenant-context": tenantContext("codexai"),
        "x-sh-owner-context": Buffer.from(JSON.stringify(analyzeOwner)).toString("base64url"),
      },
      body: JSON.stringify(analyzeBody),
    });
    const analyzeResult = await analyzeResponse.json();
    assert.equal(analyzeResponse.status, 200);
    assert.equal(analyzeResult.guardrail.mode, "active_advisory");
    assert.equal(analyzeResult.guardrail.execution_allowed, false);
    assert.equal(analyzeResult.causal_continuity.execution_authorized, false);
    assert.equal(analyzeResult.profile.advisory_activation.state, "active_advisory");

    const humanToneBody = {
      request: "Rendi naturale il testo senza modificarne il significato",
      source_text: "SkinHarmony organizza il lavoro in 30 minuti con il codice {CENTER_ID}.",
      candidate_text: "In 30 minuti, SkinHarmony rende il lavoro piu ordinato con il codice {CENTER_ID}.",
      audience: "Titolari di centri estetici",
      surface: "site_hero",
      locale: "it-IT",
      work_preflight: result.work_preflight,
    };
    const humanToneOwner = ownerContext("codexai", { ...humanToneBody, branch: "human_tone_intelligence" }, "branch_analyze");
    const humanToneResponse = await fetch(`${url}/v1/branches/human_tone_intelligence/analyze`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        "content-type": "application/json",
        "x-sh-tenant-id": "codexai",
        "x-sh-tenant-context": tenantContext("codexai"),
        "x-sh-owner-context": Buffer.from(JSON.stringify(humanToneOwner)).toString("base64url"),
      },
      body: JSON.stringify(humanToneBody),
    });
    const humanToneResult = await humanToneResponse.json();
    assert.equal(humanToneResponse.status, 200);
    assert.equal(humanToneResult.branch_output.status, "REVIEW_REQUIRED");
    assert.equal(humanToneResult.branch_output.execution_authorized, false);
    assert.equal(humanToneResult.branch_output.publish_ready, false);
    assert.equal(humanToneResult.profile.advisory_activation.state, "active_advisory");

    const testAnalyzeBody = { request: "Review test branch", work_preflight: result.work_preflight };
    const testAnalyzeOwner = ownerContext("codexai", { ...testAnalyzeBody, branch: "beauty_protocol_guard" }, "branch_analyze");
    const testAnalyzeResponse = await fetch(`${url}/v1/branches/beauty_protocol_guard/analyze`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        "content-type": "application/json",
        "x-sh-tenant-id": "codexai",
        "x-sh-tenant-context": tenantContext("codexai"),
        "x-sh-owner-context": Buffer.from(JSON.stringify(testAnalyzeOwner)).toString("base64url"),
      },
      body: JSON.stringify(testAnalyzeBody),
    });
    assert.equal(testAnalyzeResponse.status, 403);

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

    const unboundOwner = ownerContext("codexai", { view: "dashboard" }, "control_plane_read");
    const unboundResponse = await fetch(`${url}/v1/tenant/status`, {
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        "x-sh-tenant-id": "codexai",
        "x-sh-tenant-context": tenantContext("codexai"),
        "x-sh-owner-context": Buffer.from(JSON.stringify(unboundOwner)).toString("base64url"),
      },
    });
    const unboundResult = await unboundResponse.json();
    assert.equal(unboundResponse.status, 200);
    assert.equal(unboundResult.owner_active_advisory, undefined);
    assert.equal(unboundResult.active_branches.length, 11);

    const forgedOwner = { ...ownerContext("codexai", { view: "tenant_status" }, "control_plane_read"), assertion: `ocs_${"0".repeat(64)}` };
    const forgedResponse = await fetch(`${url}/v1/tenant/status`, {
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        "x-sh-tenant-id": "codexai",
        "x-sh-tenant-context": tenantContext("codexai"),
        "x-sh-owner-context": Buffer.from(JSON.stringify(forgedOwner)).toString("base64url"),
      },
    });
    const forgedResult = await forgedResponse.json();
    assert.equal(forgedResponse.status, 200);
    assert.equal(forgedResult.owner_active_advisory, undefined);

    const wrongTenantOwner = ownerContext("other_tenant", { view: "tenant_status" }, "control_plane_read");
    const wrongTenantResponse = await fetch(`${url}/v1/tenant/status`, {
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        "x-sh-tenant-id": "codexai",
        "x-sh-tenant-context": tenantContext("codexai"),
        "x-sh-owner-context": Buffer.from(JSON.stringify(wrongTenantOwner)).toString("base64url"),
      },
    });
    const wrongTenantResult = await wrongTenantResponse.json();
    assert.equal(wrongTenantResponse.status, 200);
    assert.equal(wrongTenantResult.owner_active_advisory, undefined);

    const memberAnalyzeResponse = await fetch(`${url}/v1/branches/suite_governance/analyze`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        "content-type": "application/json",
        "x-sh-tenant-id": "codexai",
        "x-sh-tenant-context": tenantContext("codexai"),
      },
      body: JSON.stringify(analyzeBody),
    });
    assert.equal(memberAnalyzeResponse.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
