import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { createAgentPresence } from "../src/agent-presence.js";
import { createCoreHandlers } from "../src/core-handlers.js";
import { HOST_NATIVE_TOOLS } from "../src/host-native-tools.js";
import {
  DTT_WORK_CONTEXT_HEADER,
  verifyDttWorkContext,
} from "../../shared/dtt-work-context.js";

const H = (value) => String(value).repeat(64);
const AUTH_WORK = "11111111-1111-4111-8111-111111111111";
const RELEASE_WORK = "22222222-2222-4222-8222-222222222222";
const LEASE_ID = "33333333-3333-4333-8333-333333333333";
const MANDATE_ID = `srm_${"a".repeat(40)}`;
const AUTH_DIGEST = H("2");
const RELEASE_DIGEST = H("4");
const GATEWAY_KEY = "standing-release-handler-gateway-key";
const DTT_SECRET = "standing-release-handler-dtt-secret-at-least-32-bytes";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function service(service_id) {
  return { service_id, environment: "production", health_contract_digest: H("1") };
}

function installArgs(overrides = {}) {
  return {
    authorization_work_id: AUTH_WORK,
    authorization_intent_anchor_digest: AUTH_DIGEST,
    repository: "owner/repo",
    base_branch: "main",
    delivery_branch_prefix: "agent/",
    allowed_path_prefixes: ["services"],
    denied_path_prefixes: [],
    required_checks: ["core-mcp", "deployment-parity", "universal-core"],
    required_checks_policy_digest: H("3"),
    services: [service("srv-core"), service("srv-mcp"), service("srv-nyra")],
    repair_classes: ["deterministic_test", "deterministic_lint"],
    limits: {
      max_pull_requests: 1, max_merges: 1, max_commits: 3, max_pushes: 3,
      max_repair_attempts: 2, max_deploys_per_service: 1, max_rollbacks: 1,
    },
    base_protection_required: true,
    ttl_seconds: 86_400,
    idempotency_key: "install-policy-1",
    ...overrides,
  };
}

function deriveArgs(overrides = {}) {
  return {
    mandate_id: MANDATE_ID,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    delivery_branch: "agent/release-1",
    changed_files: ["services/example/src/index.js"],
    builder_agent_id: "builder",
    verifier_agent_ids: ["verifier"],
    required_checks_policy_digest: H("3"),
    induced_services: [service("srv-core"), service("srv-mcp"), service("srv-nyra")],
    ttl_seconds: 3_600,
    idempotency_key: "derive-1",
    ...overrides,
  };
}

function identity() {
  const authenticatedHostPrincipal = {
    schema_version: "authenticated_host_principal_v1",
    registered: true,
    registry_revision: H("a"),
    app_id: "chatgpt_prod",
    host_kind: "chatgpt_native",
    client_type: "chatgpt",
  };
  const agentPresence = createAgentPresence({
    agentSignatureSecret: "standing-release-presence-secret".repeat(2),
    agentPresenceSignatureVersion: "v2",
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
  return {
    tenantId: "tenant-a",
    kind: "oauth",
    subject: "auth0|standing-release-owner",
    role: "tenant_owner",
    oauthOwnerElevated: true,
    ownerConfirmed: true,
    confirmationReference: "confirmed standing release mandate",
    authenticatedHostPrincipal,
    agentPresence: {
      ...agentPresence,
      transport_bound: true,
      session_id: "standing-release-session",
      host_transport_session_fingerprint: H("8"),
    },
  };
}

function intentBinding(workId, digest, overrides = {}) {
  const instant = new Date().toISOString();
  const { binding_digest: bindingDigestOverride, ...bindingOverrides } = overrides;
  const binding = {
    schema_version: "standing_release_intent_binding_v1",
    source: "mcp_work_continuity_postgres",
    tenant_id: "tenant-a",
    work_id: workId,
    project_id: "release-project",
    work_status: "active",
    current_version: 1,
    work_updated_at: instant,
    intent_anchor_schema_version: "intent_anchor_v1",
    intent_anchor_immutable: true,
    intent_anchor_digest: digest,
    intent_anchor_created_at: instant,
    verified_at: instant,
    provider_execution: false,
    ...bindingOverrides,
  };
  return {
    ...binding,
    binding_digest: bindingDigestOverride || canonicalDigest(binding),
  };
}

function trustedResolver(implementation) {
  Object.defineProperty(implementation, "trusted", { value: true });
  return implementation;
}

function leaseBinding(actor, workId) {
  return {
    schema_version: "dtt_work_lease_binding_v1",
    tenant_id: actor.tenantId,
    work_id: workId,
    lease_id: LEASE_ID,
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    participant_expires_at: new Date(Date.now() + 120_000).toISOString(),
    session_id: actor.agentPresence.session_id,
    agent_id: actor.agentPresence.agent_id,
    client_type: actor.agentPresence.client_type,
    session_fingerprint: actor.agentPresence.session_fingerprint,
    host_transport_session_fingerprint: actor.agentPresence.host_transport_session_fingerprint,
    presence_signature: actor.agentPresence.signature,
    opaque_agent_id: actor.agentPresence.opaque_agent_id,
    actor_provenance: actor.agentPresence.actor_provenance,
    execution_authorized: false,
  };
}

function config() {
  return {
    universalCoreUrl: "https://core.test",
    githubStandingReleaseWorkerUrl: "https://github-worker.test",
    universalCoreKeys: { "tenant-a": "tenant-core-key" },
    tenantGatewayKey: GATEWAY_KEY,
    tenantContextSigningSecret: "standing-release-handler-tenant-secret-at-least-32-bytes",
    ownerContextSigningSecret: "standing-release-handler-owner-secret-at-least-32-bytes",
    dttAgentIdentitySigningSecret: DTT_SECRET,
  };
}

test("standing release tools require UUID Work IDs and expose no caller authority fields", () => {
  const install = HOST_NATIVE_TOOLS.find((tool) =>
    tool.name === "host_native_standing_release_mandate_install");
  const derive = HOST_NATIVE_TOOLS.find((tool) =>
    tool.name === "host_native_standing_release_delegation_derive");
  const mandateRead = HOST_NATIVE_TOOLS.find((tool) =>
    tool.name === "host_native_standing_release_mandate_read");
  assert.equal(install.inputSchema.properties.authorization_work_id.format, "uuid");
  assert.equal(derive.inputSchema.properties.work_id.format, "uuid");
  assert.equal(mandateRead.inputSchema.properties.work_id.format, "uuid");
  assert.equal(Object.hasOwn(derive.inputSchema.properties, "host_kind"), false);
  assert.equal(Object.hasOwn(derive.inputSchema.properties, "host_session_fingerprint"), false);
  assert.equal(Object.hasOwn(derive.inputSchema.properties, "tenant_id"), false);
  for (const name of [
    "host_native_standing_release_run_start",
    "host_native_standing_release_run_bind_ticket",
    "host_native_standing_release_run_reserve",
    "host_native_standing_release_run_complete",
    "host_native_standing_release_run_reconcile",
    "host_native_standing_release_run_advance",
    "host_native_standing_release_run_quarantine_expired",
    "host_native_standing_release_run_cancel",
    "host_native_standing_release_github_execute",
    "host_native_standing_release_github_reconcile",
  ]) {
    const runTool = HOST_NATIVE_TOOLS.find((tool) => tool.name === name);
    assert(runTool, name);
    assert.equal(runTool.inputSchema.properties.work_id.format, "uuid");
    assert.equal(Object.hasOwn(runTool.inputSchema.properties, "tenant_id"), false);
    assert.equal(Object.hasOwn(runTool.inputSchema.properties, "host_kind"), false);
    assert.equal(Object.hasOwn(runTool.inputSchema.properties, "host_session_fingerprint"), false);
  }
});

test("GitHub worker handlers forward only same-tenant persisted-Intent claims", async () => {
  const calls = [];
  const claim = {
    schema_version: "github_worker_execution_claim_v1",
    tenant_id: "tenant-a",
    work_id: RELEASE_WORK,
    repository: "owner/repo",
    ticket_id: `hnt_${"a".repeat(40)}`,
    reservation_id: `hnr_${"b".repeat(40)}`,
    action: { kind: "github.ready" },
    action_digest: H("c"),
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    nonce: H("d"),
    provider_execution: false,
    signature: `gwe_${H("e")}`,
  };
  const handlers = createCoreHandlers(config(), {
    resolveStandingReleaseIntentBinding: trustedResolver(async (_actor, workId) => intentBinding(workId, RELEASE_DIGEST)),
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, execution: { state: "succeeded" } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
  });
  await handlers.host_native_standing_release_github_execute({
    work_id: RELEASE_WORK, intent_anchor_digest: RELEASE_DIGEST, claim,
    materialization: { title: "Bounded", body: "Body" },
  }, identity());
  await handlers.host_native_standing_release_github_reconcile({
    work_id: RELEASE_WORK, intent_anchor_digest: RELEASE_DIGEST, claim,
  }, identity());
  assert.deepEqual(calls.map((call) => call.url), [
    "https://github-worker.test/v1/execute", "https://github-worker.test/v1/reconcile",
  ]);
  assert.deepEqual(calls[0].body, { claim, materialization: { title: "Bounded", body: "Body" } });
  assert.deepEqual(calls[1].body, { claim });
  await assert.rejects(handlers.host_native_standing_release_github_execute({
    work_id: RELEASE_WORK, intent_anchor_digest: RELEASE_DIGEST,
    claim: { ...claim, tenant_id: "other-tenant" },
  }, identity()), /claim_binding_mismatch/);
  assert.equal(calls.length, 2);
});

test("reserved GitHub tickets are forwarded once and successful evidence is completed in Core", async () => {
  const runId = `srr_${"a".repeat(40)}`;
  const ticketId = `hnt_${"b".repeat(40)}`;
  const reservationId = `hnr_${"c".repeat(40)}`;
  const resultCommit = "d".repeat(40);
  const claim = {
    schema_version: "github_worker_execution_claim_v1",
    tenant_id: "tenant-a",
    work_id: RELEASE_WORK,
    repository: "owner/repo",
    ticket_id: ticketId,
    reservation_id: reservationId,
    action: { kind: "git.push.branch" },
    action_digest: H("e"),
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    nonce: H("f"),
    provider_execution: false,
    signature: `gwe_${H("1")}`,
  };
  const calls = [];
  const intentRequests = [];
  const leaseRequests = [];
  const handlers = createCoreHandlers({
    ...config(),
    standingReleaseAutoCoordinatorEnabled: true,
  }, {
    resolveStandingReleaseIntentBinding: trustedResolver(async (actor, workId) => {
      intentRequests.push([actor.tenantId, workId]);
      return intentBinding(workId, RELEASE_DIGEST);
    }),
    resolveDttWorkBinding: async (actor, workId) => {
      leaseRequests.push(workId);
      return leaseBinding(actor, workId);
    },
    fetchImpl: async (url, init) => {
      const call = {
        url,
        path: new URL(url).pathname,
        method: init.method,
        body: JSON.parse(init.body),
      };
      calls.push(call);
      if (url === "https://github-worker.test/v1/execute") {
        return new Response(JSON.stringify({
          ok: true,
          provider_execution: true,
          execution: {
            schema_version: "github_worker_execution_record_v1",
            nonce: claim.nonce,
            tenant_id: "tenant-a",
            repository: claim.repository,
            ticket_id: ticketId,
            reservation_id: reservationId,
            action_digest: claim.action_digest,
            claim_digest: canonicalDigest(claim),
            state: "succeeded",
            result: { outcome: "success", result_commit: resultCommit },
            signature: `gwl_${H("8")}`,
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (call.path.endsWith("/reserve")) {
        return new Response(JSON.stringify({
          ok: true,
          tenant_id: "tenant-a",
          action_ticket: {
            state: "reserved",
            reservation_id: reservationId,
            ticket: { ticket_id: ticketId },
          },
          github_execution_claim: claim,
          provider_execution: false,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        ok: true,
        tenant_id: "tenant-a",
        action_ticket: { state: "completed", ticket: { ticket_id: ticketId } },
        provider_execution: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await handlers.host_native_standing_release_run_reserve({
    run_id: runId,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    ticket_id: ticketId,
    expected_version: 2,
    idempotency_key: "auto-reserve-success",
  }, identity());

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["POST", `/v1/host-native/standing-release/runs/${runId}/reserve`],
    ["POST", `/v1/host-native/standing-release/runs/${runId}/complete`],
    ["POST", "/v1/execute"],
    ["POST", `/v1/host-native/standing-release/runs/${runId}/reconcile`],
  ]);
  assert.equal(calls[1].body.outcome, "unknown");
  assert.match(calls[1].body.result_digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(calls[2].body, { claim });
  assert.equal(calls[3].body.observed_outcome, "success");
  assert.equal(calls[3].body.observed_commit, resultCommit);
  assert.match(calls[3].body.readback_digest, /^[a-f0-9]{64}$/);
  assert.equal(calls[3].body.reservation_id, reservationId);
  assert.equal(calls[3].body.ticket_id, ticketId);
  assert.equal(result.structuredContent.standing_release_auto_coordinator.forwarded, true);
  assert.deepEqual(intentRequests, [
    ["tenant-a", RELEASE_WORK],
    ["tenant-a", RELEASE_WORK],
    ["tenant-a", RELEASE_WORK],
  ]);
  assert.deepEqual(leaseRequests, [RELEASE_WORK, RELEASE_WORK, RELEASE_WORK]);

  const readyRunId = `srr_${"9".repeat(40)}`;
  const readyTicketId = `hnt_${"a".repeat(40)}`;
  const readyReservationId = `hnr_${"b".repeat(40)}`;
  const readyHeadCommit = "c".repeat(40);
  const readyClaim = {
    ...claim,
    ticket_id: readyTicketId,
    reservation_id: readyReservationId,
    action: {
      kind: "github.ready",
      head_commit: readyHeadCommit,
    },
    action_digest: H("3"),
    nonce: H("4"),
  };
  const readyCalls = [];
  const readyHandlers = createCoreHandlers({
    ...config(),
    standingReleaseAutoCoordinatorEnabled: true,
  }, {
    resolveStandingReleaseIntentBinding: trustedResolver(async (_actor, workId) =>
      intentBinding(workId, RELEASE_DIGEST)),
    resolveDttWorkBinding: async (actor, workId) => leaseBinding(actor, workId),
    fetchImpl: async (url, init) => {
      const call = {
        url,
        path: new URL(url).pathname,
        method: init.method,
        body: JSON.parse(init.body),
      };
      readyCalls.push(call);
      if (url === "https://github-worker.test/v1/execute") {
        return new Response(JSON.stringify({
          ok: true,
          provider_execution: true,
          execution: {
            schema_version: "github_worker_execution_record_v1",
            nonce: readyClaim.nonce,
            tenant_id: readyClaim.tenant_id,
            repository: readyClaim.repository,
            ticket_id: readyTicketId,
            reservation_id: readyReservationId,
            action_digest: readyClaim.action_digest,
            claim_digest: canonicalDigest(readyClaim),
            state: "succeeded",
            result: { outcome: "success", result_pull_request: 17 },
            signature: `gwl_${H("5")}`,
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (call.path.endsWith("/reserve")) {
        return new Response(JSON.stringify({
          ok: true,
          tenant_id: "tenant-a",
          action_ticket: {
            state: "reserved",
            reservation_id: readyReservationId,
            ticket: { ticket_id: readyTicketId },
          },
          github_execution_claim: readyClaim,
          provider_execution: false,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true, tenant_id: "tenant-a" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await readyHandlers.host_native_standing_release_run_reserve({
    run_id: readyRunId,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    ticket_id: readyTicketId,
    expected_version: 2,
    idempotency_key: "auto-ready-success",
  }, identity());
  assert.deepEqual(readyCalls.map((call) => call.path), [
    `/v1/host-native/standing-release/runs/${readyRunId}/reserve`,
    `/v1/host-native/standing-release/runs/${readyRunId}/complete`,
    "/v1/execute",
    `/v1/host-native/standing-release/runs/${readyRunId}/reconcile`,
  ]);
  assert.equal(readyCalls[3].body.observed_commit, readyHeadCommit);
  assert.equal(readyCalls[3].body.observed_pull_request, 17);
});

test("uncertain GitHub worker outcomes remain reconciliation-required without blind retry", async () => {
  const runId = `srr_${"2".repeat(40)}`;
  const ticketId = `hnt_${"3".repeat(40)}`;
  const reservationId = `hnr_${"4".repeat(40)}`;
  const claim = {
    schema_version: "github_worker_execution_claim_v1",
    tenant_id: "tenant-a",
    work_id: RELEASE_WORK,
    repository: "owner/repo",
    ticket_id: ticketId,
    reservation_id: reservationId,
    action: { kind: "github.ready" },
    action_digest: H("5"),
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    nonce: H("6"),
    provider_execution: false,
    signature: `gwe_${H("7")}`,
  };
  const calls = [];
  let ticketState = "reserved";
  const handlers = createCoreHandlers({
    ...config(),
    standingReleaseAutoCoordinatorEnabled: true,
  }, {
    resolveStandingReleaseIntentBinding: trustedResolver(async (_actor, workId) =>
      intentBinding(workId, RELEASE_DIGEST)),
    resolveDttWorkBinding: async (actor, workId) => leaseBinding(actor, workId),
    fetchImpl: async (url, init) => {
      calls.push({ url, path: new URL(url).pathname, method: init.method });
      if (url === "https://github-worker.test/v1/execute") {
        return new Response(JSON.stringify({
          error: "github_worker_execution_outcome_unknown",
          execution: { state: "outcome_unknown" },
        }), { status: 409, headers: { "content-type": "application/json" } });
      }
      if (new URL(url).pathname.endsWith("/complete")) {
        ticketState = "reconciliation_required";
        return new Response(JSON.stringify({
          ok: true,
          tenant_id: "tenant-a",
          action_ticket: { state: ticketState, ticket: { ticket_id: ticketId } },
          provider_execution: false,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        ok: true,
        tenant_id: "tenant-a",
        action_ticket: {
          state: ticketState,
          reservation_id: reservationId,
          ticket: { ticket_id: ticketId },
        },
        github_execution_claim: claim,
        provider_execution: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await assert.rejects(handlers.host_native_standing_release_run_reserve({
    run_id: runId,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    ticket_id: ticketId,
    expected_version: 2,
    idempotency_key: "auto-reserve-unknown",
  }, identity()), /standing_release_auto_execution_outcome_unknown/);
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["POST", `/v1/host-native/standing-release/runs/${runId}/reserve`],
    ["POST", `/v1/host-native/standing-release/runs/${runId}/complete`],
    ["POST", "/v1/execute"],
  ]);

  const replay = await handlers.host_native_standing_release_run_reserve({
    run_id: runId,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    ticket_id: ticketId,
    expected_version: 2,
    idempotency_key: "auto-reserve-unknown",
  }, identity());
  assert.equal(replay.structuredContent.action_ticket.state, "reconciliation_required");
  assert.equal(calls.filter((call) => call.path === "/v1/execute").length, 1);
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["POST", `/v1/host-native/standing-release/runs/${runId}/reserve`],
    ["POST", `/v1/host-native/standing-release/runs/${runId}/complete`],
    ["POST", "/v1/execute"],
    ["POST", `/v1/host-native/standing-release/runs/${runId}/reserve`],
  ]);

  let invalidConfigurationFetches = 0;
  const invalidConfigurationHandlers = createCoreHandlers({
    ...config(),
    githubStandingReleaseWorkerUrl: "",
    standingReleaseAutoCoordinatorEnabled: true,
    standingReleaseAutoCoordinatorConfigurationValid: false,
  }, {
    resolveStandingReleaseIntentBinding: trustedResolver(async (_actor, workId) =>
      intentBinding(workId, RELEASE_DIGEST)),
    resolveDttWorkBinding: async (actor, workId) => leaseBinding(actor, workId),
    fetchImpl: async () => {
      invalidConfigurationFetches += 1;
      throw new Error("fetch_must_not_run");
    },
  });
  await assert.rejects(invalidConfigurationHandlers.host_native_standing_release_run_reserve({
    run_id: runId,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    ticket_id: ticketId,
    expected_version: 2,
    idempotency_key: "invalid-auto-coordinator",
  }, identity()), /standing_release_auto_coordinator_unavailable/);
  assert.equal(invalidConfigurationFetches, 0);
});

test("horizontal runner mutations use fresh exact DTT bindings and peer-provider routes", async () => {
  const calls = [];
  const leaseRequests = [];
  const intentRequests = [];
  const runId = `srr_${"c".repeat(40)}`;
  const ticketId = `hnt_${"d".repeat(40)}`;
  const reservationId = `hnr_${"e".repeat(40)}`;
  const handlers = createCoreHandlers(config(), {
    resolveStandingReleaseIntentBinding: trustedResolver(async (actor, workId) => {
      intentRequests.push([actor.tenantId, workId]);
      return intentBinding(workId, RELEASE_DIGEST);
    }),
    resolveDttWorkBinding: async (actor, workId) => {
      leaseRequests.push(workId);
      return leaseBinding(actor, workId);
    },
    fetchImpl: async (url, init) => {
      const call = {
        path: new URL(url).pathname,
        method: init.method || "GET",
        headers: init.headers,
        body: init.body ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      return new Response(JSON.stringify({
        ok: true,
        tenant_id: "tenant-a",
        standing_release_run: {
          schema_version: "standing_release_run_record_v1",
          run_id: runId,
          run: {
            run_id: runId,
            state: "COMMIT_PENDING",
            coordination_model: "horizontal_peer_adapters_v1",
            provider_execution: false,
          },
          provider_execution: false,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const actor = identity();
  await handlers.host_native_standing_release_run_start({
    delegation_id: `hnd_${"b".repeat(40)}`,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    idempotency_key: "run-start",
  }, actor);
  await handlers.host_native_standing_release_run_read({
    run_id: runId,
    work_id: RELEASE_WORK,
  }, actor);
  await handlers.host_native_standing_release_run_bind_ticket({
    run_id: runId,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    ticket_id: ticketId,
    expected_version: 1,
    idempotency_key: "run-bind",
  }, actor);
  await handlers.host_native_standing_release_run_reserve({
    run_id: runId,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    ticket_id: ticketId,
    expected_version: 2,
    idempotency_key: "run-reserve",
  }, actor);
  await handlers.host_native_standing_release_run_complete({
    run_id: runId,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    ticket_id: ticketId,
    expected_version: 2,
    reservation_id: reservationId,
    outcome: "unknown",
    result_digest: H("a"),
    idempotency_key: "run-complete",
  }, actor);
  await handlers.host_native_standing_release_run_reconcile({
    run_id: runId,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    ticket_id: ticketId,
    expected_version: 2,
    reservation_id: reservationId,
    observed_outcome: "success",
    observed_commit: H("b").slice(0, 40),
    readback_digest: H("c"),
    idempotency_key: "run-reconcile",
  }, actor);
  await handlers.host_native_standing_release_run_advance({
    run_id: runId,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    ticket_id: ticketId,
    expected_version: 2,
    idempotency_key: "run-advance",
  }, actor);
  await handlers.host_native_standing_release_run_quarantine_expired({
    run_id: runId,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    ticket_id: ticketId,
    reservation_id: reservationId,
    expected_version: 2,
    idempotency_key: "run-quarantine-expired",
  }, actor);
  await handlers.host_native_standing_release_run_cancel({
    run_id: runId,
    work_id: RELEASE_WORK,
    intent_anchor_digest: RELEASE_DIGEST,
    reason_digest: H("e"),
    expected_version: 3,
    idempotency_key: "run-cancel",
  }, actor);

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["POST", "/v1/host-native/standing-release/runs"],
    ["GET", `/v1/host-native/standing-release/runs/${runId}`],
    ["POST", `/v1/host-native/standing-release/runs/${runId}/bind-ticket`],
    ["POST", `/v1/host-native/standing-release/runs/${runId}/reserve`],
    ["POST", `/v1/host-native/standing-release/runs/${runId}/complete`],
    ["POST", `/v1/host-native/standing-release/runs/${runId}/reconcile`],
    ["POST", `/v1/host-native/standing-release/runs/${runId}/advance`],
    ["POST", `/v1/host-native/standing-release/runs/${runId}/quarantine-expired`],
    ["POST", `/v1/host-native/standing-release/runs/${runId}/cancel`],
  ]);
  assert.deepEqual(leaseRequests, [
    RELEASE_WORK, RELEASE_WORK, RELEASE_WORK, RELEASE_WORK, RELEASE_WORK,
    RELEASE_WORK, RELEASE_WORK, RELEASE_WORK, RELEASE_WORK,
  ]);
  assert.deepEqual(intentRequests, [
    ["tenant-a", RELEASE_WORK], ["tenant-a", RELEASE_WORK],
    ["tenant-a", RELEASE_WORK], ["tenant-a", RELEASE_WORK],
    ["tenant-a", RELEASE_WORK], ["tenant-a", RELEASE_WORK],
    ["tenant-a", RELEASE_WORK], ["tenant-a", RELEASE_WORK],
  ]);
  assert.equal(calls[0].body.host_kind, "chatgpt_native");
  assert.equal(calls[0].body.host_session_fingerprint, actor.agentPresence.session_fingerprint);
  assert.match(calls[0].body.host_session_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(calls[1].body, undefined);
  for (const call of calls.filter((entry) =>
    entry.method === "POST" || entry.path === `/v1/host-native/standing-release/runs/${runId}`)) {
    if (call.method === "POST") {
      assert.equal(call.body.intent_anchor_digest, RELEASE_DIGEST);
      assert.deepEqual(call.body.intent_binding, intentBinding(RELEASE_WORK, RELEASE_DIGEST, {
        verified_at: call.body.intent_binding.verified_at,
        work_updated_at: call.body.intent_binding.work_updated_at,
        intent_anchor_created_at: call.body.intent_binding.intent_anchor_created_at,
      }));
    }
    assert.equal(call.headers.authorization, `Bearer ${GATEWAY_KEY}`);
    assert.equal(call.headers["x-sh-tenant-id"], "tenant-a");
    const verified = verifyDttWorkContext({
      token: call.headers[DTT_WORK_CONTEXT_HEADER],
      secret: DTT_SECRET,
      expected_tenant_id: "tenant-a",
      expected_work_id: RELEASE_WORK,
      method: call.method,
      path: call.path,
      body: call.body,
    });
    assert.equal(verified.work_id, RELEASE_WORK);
    assert.equal(verified.execution_authorized, false);
    if (call.method === "POST") {
      assert.throws(() => verifyDttWorkContext({
        token: call.headers[DTT_WORK_CONTEXT_HEADER],
        secret: DTT_SECRET,
        expected_tenant_id: "tenant-a",
        expected_work_id: RELEASE_WORK,
        method: call.method,
        path: call.path,
        body: { ...call.body, expected_version: 999 },
      }), /dtt_work_context_request_mismatch/);
    }
  }
});

test("install and derive use persisted Intent through exact DTT request-bound gateway headers", async () => {
  const calls = [];
  const intentRequests = [];
  const persistedBindings = [];
  const leaseRequests = [];
  const resolver = trustedResolver(async (actor, workId) => {
    intentRequests.push([actor.tenantId, workId]);
    const binding = workId === AUTH_WORK
      ? intentBinding(workId, AUTH_DIGEST)
      : intentBinding(workId, RELEASE_DIGEST);
    persistedBindings.push(binding);
    return binding;
  });
  const handlers = createCoreHandlers(config(), {
    resolveStandingReleaseIntentBinding: resolver,
    resolveDttWorkBinding: async (actor, workId) => {
      leaseRequests.push(workId);
      return leaseBinding(actor, workId);
    },
    fetchImpl: async (url, init) => {
      calls.push({
        path: new URL(url).pathname,
        method: init.method || "GET",
        headers: init.headers,
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      return new Response(JSON.stringify({
        ok: true,
        mandate: { mandate_id: MANDATE_ID },
        delegation: { delegation_id: `hnd_${"b".repeat(40)}` },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const actor = identity();
  await handlers.host_native_standing_release_mandate_install(installArgs(), actor);
  await handlers.host_native_standing_release_mandate_read({
    mandate_id: MANDATE_ID,
    work_id: AUTH_WORK,
  }, actor);
  await handlers.host_native_standing_release_delegation_derive(deriveArgs(), actor);

  assert.deepEqual(intentRequests, [
    ["tenant-a", AUTH_WORK],
    ["tenant-a", RELEASE_WORK],
  ]);
  assert.deepEqual(leaseRequests, [AUTH_WORK, AUTH_WORK, RELEASE_WORK]);
  for (const binding of persistedBindings) {
    const { binding_digest: bindingDigest, ...unsigned } = binding;
    assert.equal(binding.source, "mcp_work_continuity_postgres");
    assert.equal(bindingDigest, canonicalDigest(unsigned));
    assert.equal("anchor" in binding, false);
    assert.equal("initial_message" in binding, false);
    assert.equal("idea" in binding, false);
    assert.equal("objective" in binding, false);
  }
  assert.equal(calls[0].body.authorization_work_id, AUTH_WORK);
  assert.equal(calls[0].body.authorization_intent_anchor_digest, AUTH_DIGEST);
  assert.equal(calls[1].method, "GET");
  assert.equal(calls[1].body, undefined);
  assert.equal(calls[2].body.work_id, RELEASE_WORK);
  assert.equal(calls[2].body.intent_anchor_digest, RELEASE_DIGEST);
  assert.deepEqual(calls[0].body.authorization_intent_binding, persistedBindings[0]);
  assert.deepEqual(calls[2].body.intent_binding, persistedBindings[1]);
  for (const binding of [
    calls[0].body.authorization_intent_binding,
    calls[2].body.intent_binding,
  ]) {
    for (const promptField of ["anchor", "initial_message", "idea", "objective", "constraints"]) {
      assert.equal(promptField in binding, false);
    }
  }
  for (const [call, workId] of [
    [calls[0], AUTH_WORK],
    [calls[1], AUTH_WORK],
    [calls[2], RELEASE_WORK],
  ]) {
    assert.equal(call.headers.authorization, `Bearer ${GATEWAY_KEY}`);
    assert.equal(call.headers["x-sh-tenant-id"], "tenant-a");
    const verified = verifyDttWorkContext({
      token: call.headers[DTT_WORK_CONTEXT_HEADER],
      secret: DTT_SECRET,
      expected_tenant_id: "tenant-a",
      expected_work_id: workId,
      method: call.method,
      path: call.path,
      body: call.body,
    });
    assert.equal(verified.work_id, workId);
    assert.equal(verified.lease.lease_id, LEASE_ID);
    assert.equal(verified.execution_authorized, false);
    if (call.method === "POST") {
      const tampered = structuredClone(call.body);
      if (workId === AUTH_WORK) tampered.authorization_intent_binding.binding_digest = H("f");
      else tampered.intent_binding.binding_digest = H("f");
      assert.throws(() => verifyDttWorkContext({
        token: call.headers[DTT_WORK_CONTEXT_HEADER],
        secret: DTT_SECRET,
        expected_tenant_id: "tenant-a",
        expected_work_id: workId,
        method: call.method,
        path: call.path,
        body: tampered,
      }), /dtt_work_context_request_mismatch/);
    }
  }
});

test("missing, untrusted, mismatched, corrupt and ineligible Intent bindings never fetch", async () => {
  const cases = [
    ["missing", undefined, /standing_release_intent_binding_unavailable/],
    ["untrusted", async () => intentBinding(AUTH_WORK, AUTH_DIGEST),
      /standing_release_intent_binding_unavailable/],
    ["digest mismatch", trustedResolver(async () => intentBinding(AUTH_WORK, H("e"))),
      /standing_release_intent_digest_mismatch/],
    ["cross tenant", trustedResolver(async () => intentBinding(AUTH_WORK, AUTH_DIGEST,
      { tenant_id: "tenant-b" })), /standing_release_intent_binding_invalid/],
    ["wrong work", trustedResolver(async () => intentBinding(RELEASE_WORK, AUTH_DIGEST)),
      /standing_release_intent_binding_invalid/],
    ["wrong source", trustedResolver(async () => intentBinding(AUTH_WORK, AUTH_DIGEST,
      { source: "caller_supplied" })), /standing_release_intent_binding_invalid/],
    ["tampered binding digest", trustedResolver(async () => intentBinding(AUTH_WORK, AUTH_DIGEST,
      { binding_digest: H("f") })), /standing_release_intent_binding_invalid/],
    ["corrupt", trustedResolver(async () => intentBinding(AUTH_WORK, AUTH_DIGEST,
      { intent_anchor_immutable: false })), /standing_release_intent_binding_invalid/],
    ["stale", trustedResolver(async () => intentBinding(AUTH_WORK, AUTH_DIGEST,
      { verified_at: new Date(Date.now() - 301_000).toISOString() })),
      /standing_release_intent_binding_invalid/],
    ["ineligible status", trustedResolver(async () => intentBinding(AUTH_WORK, AUTH_DIGEST,
      { work_status: "blocked" })), /standing_release_intent_binding_invalid/],
  ];
  for (const [name, resolver, expected] of cases) {
    let fetchCalls = 0;
    let leaseCalls = 0;
    const handlers = createCoreHandlers(config(), {
      resolveStandingReleaseIntentBinding: resolver,
      resolveDttWorkBinding: async (actor, workId) => {
        leaseCalls += 1;
        return leaseBinding(actor, workId);
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("fetch_must_not_run");
      },
    });
    await assert.rejects(
      handlers.host_native_standing_release_mandate_install(installArgs(), identity()),
      expected,
      name,
    );
    assert.equal(leaseCalls, 0, name);
    assert.equal(fetchCalls, 0, name);
  }
});

test("resolver not-found, corrupt and status errors block derive without fetch", async () => {
  for (const reason of [
    "standing_release_intent_binding_not_found",
    "standing_release_intent_binding_corrupt",
    "standing_release_intent_work_status_ineligible",
  ]) {
    let fetchCalls = 0;
    const resolver = trustedResolver(async () => { throw new Error(reason); });
    const handlers = createCoreHandlers(config(), {
      resolveStandingReleaseIntentBinding: resolver,
      resolveDttWorkBinding: async (actor, workId) => leaseBinding(actor, workId),
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("fetch_must_not_run");
      },
    });
    await assert.rejects(
      handlers.host_native_standing_release_delegation_derive(deriveArgs(), identity()),
      new RegExp(reason),
    );
    assert.equal(fetchCalls, 0, reason);
  }
});

test("standing release handler rejects non-canonical persisted and caller Work/Intent forms", async (t) => {
  const letterWork = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const letterDigest = "a".repeat(64);
  const canonicalInstant = new Date(Math.floor(Date.now() / 1_000) * 1_000).toISOString();
  const offsetInstant = canonicalInstant.replace(/Z$/, "+00:00");
  const shortInstant = canonicalInstant.replace(".000Z", "Z");
  const validBinding = intentBinding(AUTH_WORK, AUTH_DIGEST);
  const cases = [
    {
      name: "string current_version",
      args: installArgs(),
      binding: () => intentBinding(AUTH_WORK, AUTH_DIGEST, { current_version: "1" }),
      expected: /standing_release_intent_binding_invalid/,
    },
    {
      name: "offset verified_at",
      args: installArgs(),
      binding: () => intentBinding(AUTH_WORK, AUTH_DIGEST, { verified_at: offsetInstant }),
      expected: /standing_release_intent_binding_invalid/,
    },
    {
      name: "short work_updated_at",
      args: installArgs(),
      binding: () => intentBinding(AUTH_WORK, AUTH_DIGEST, { work_updated_at: shortInstant }),
      expected: /standing_release_intent_binding_invalid/,
    },
    {
      name: "offset intent_anchor_created_at",
      args: installArgs(),
      binding: () => intentBinding(AUTH_WORK, AUTH_DIGEST, {
        intent_anchor_created_at: offsetInstant,
      }),
      expected: /standing_release_intent_binding_invalid/,
    },
    {
      name: "uppercase persisted work",
      args: installArgs({ authorization_work_id: letterWork,
        authorization_intent_anchor_digest: letterDigest }),
      binding: () => intentBinding(letterWork.toUpperCase(), letterDigest),
      expected: /standing_release_intent_binding_invalid/,
    },
    {
      name: "uppercase persisted intent digest",
      args: installArgs({ authorization_intent_anchor_digest: letterDigest }),
      binding: () => intentBinding(AUTH_WORK, letterDigest.toUpperCase()),
      expected: /standing_release_intent_binding_invalid/,
    },
    {
      name: "uppercase binding digest",
      args: installArgs(),
      binding: () => ({ ...validBinding,
        binding_digest: validBinding.binding_digest.toUpperCase() }),
      expected: /standing_release_intent_binding_invalid/,
    },
    {
      name: "uppercase caller work",
      args: installArgs({ authorization_work_id: letterWork.toUpperCase(),
        authorization_intent_anchor_digest: letterDigest }),
      binding: (requestedWork) => intentBinding(requestedWork, letterDigest),
      expected: /standing_release_work_id_invalid/,
    },
    {
      name: "padded caller work",
      args: installArgs({ authorization_work_id: ` ${AUTH_WORK} ` }),
      binding: (requestedWork) => intentBinding(requestedWork, AUTH_DIGEST),
      expected: /standing_release_work_id_invalid/,
    },
    {
      name: "uppercase caller digest",
      args: installArgs({ authorization_intent_anchor_digest: letterDigest.toUpperCase() }),
      binding: (requestedWork) => intentBinding(requestedWork, letterDigest),
      expected: /standing_release_intent_digest_invalid/,
    },
    {
      name: "padded caller digest",
      args: installArgs({ authorization_intent_anchor_digest: ` ${AUTH_DIGEST} ` }),
      binding: (requestedWork) => intentBinding(requestedWork, AUTH_DIGEST),
      expected: /standing_release_intent_digest_invalid/,
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let fetchCalls = 0;
      let leaseCalls = 0;
      const resolver = trustedResolver(async (_actor, requestedWork) =>
        entry.binding(requestedWork));
      const handlers = createCoreHandlers(config(), {
        resolveStandingReleaseIntentBinding: resolver,
        resolveDttWorkBinding: async (actor, workId) => {
          leaseCalls += 1;
          return leaseBinding(actor, workId);
        },
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error("fetch_must_not_run");
        },
      });
      await assert.rejects(
        handlers.host_native_standing_release_mandate_install(entry.args, identity()),
        entry.expected,
      );
      assert.equal(leaseCalls, 0);
      assert.equal(fetchCalls, 0);
    });
  }
});
