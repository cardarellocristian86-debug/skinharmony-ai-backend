import assert from "node:assert/strict";
import test from "node:test";

import { buildActionAuthorization } from "../src/actionAuthorization.js";
import {
  governedWorkBootstrapAuthorizationTarget,
  materializeGovernedWorkBootstrapRequest,
} from "../../skinharmony-core-mcp/src/work-bootstrap-contract.js";

const DIGEST = "a".repeat(64);

function identity() {
  return {
    tenantId: "tenant-a",
    subject: "owner-a",
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      registry_revision: DIGEST,
      app_id: "chatgpt_prod",
      auth_kind: "oauth",
      host_kind: "chatgpt_native",
      client_type: "chatgpt",
      interaction_mode: "nyra_conversational",
      capabilities: ["work.create", "work.coordinate"],
    },
    agentPresence: {
      session_fingerprint: "b".repeat(24),
      client_type: "chatgpt",
      session_id: "chatgpt-session",
      agent_id: "chatgpt-agent",
    },
  };
}

function bootstrapRequest(caller) {
  return materializeGovernedWorkBootstrapRequest({
    spec: {
      request_id: "mcp-core-contract-review",
      work_name: "MCP Core contract",
      work_type: "software_git",
      idea: "Keep the Work bootstrap contract aligned.",
      objective: "Authorize only an exact request-bound review target.",
      architecture: {},
      next_action: "Run duplicate review.",
      acceptance_criteria: ["Core accepts the exact MCP review target."],
      constraints: ["No Work is created during review."],
      tasks: [{ title: "Verify the cross-service contract" }],
    },
    identity: caller,
    projectId: "nyra-core",
  });
}

function boundedReview(target) {
  return {
    action_type: "work.bootstrap.review",
    operation_class: "bounded_internal_coordination_write",
    authenticated_tenant_id: "tenant-a",
    tenant_id: "tenant-a",
    target,
    idempotency_key: "mcp-core-contract-review-0001",
    external_side_effect: false,
    contains_customer_data: false,
    contains_secret: false,
    secret_value_transmitted: false,
    cross_tenant: false,
    configuration_changes: false,
    destructive: false,
    bypass_orchestrator: false,
    provider_execution: false,
    bounded_scope: true,
    low_impact: true,
    idempotent_or_compensable: true,
    audit_ready: true,
    target_authority_verified: true,
    actor_authorized_for_target: true,
  };
}

test("Universal Core accepts the exact request-bound MCP bootstrap review target", () => {
  const caller = identity();
  const request = bootstrapRequest(caller);
  const target = governedWorkBootstrapAuthorizationTarget({
    phase: "review",
    request,
    identity: caller,
  });
  const authorization = buildActionAuthorization({
    state: "attention",
    risk_band: "low",
    control_level: "confirm",
    recommended_actions: [{ blocked: false }],
  }, boundedReview(target));

  assert.match(
    target,
    /^work_bootstrap:review:chatgpt_prod:chatgpt_native:[a-f0-9]{64}$/,
  );
  assert.equal(authorization.allowed, true);
  assert.equal(authorization.confirmation_required, false);
});
