import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  createNyraGovernedContinueAttestor,
  createNyraGovernedContinueHandler,
  createNyraGovernedContinuationIssuer,
} from "../src/nyra-governed-continue.js";
import { HOST_APP_CAPABILITIES } from "../src/host-app-registry.js";
import { TOOLS } from "../src/tool-definitions.js";
import {
  bindWorkBootstrapRequestToAuthenticatedHost,
  governedWorkBootstrapAuthorizationTarget,
  governedWorkBootstrapDigest,
  materializeGovernedWorkBootstrapRequest,
  normalizeGovernedWorkBootstrapSpec,
} from "../src/work-bootstrap-contract.js";

const SECRET = "nyra-governed-continue-test-secret-0123456789abcdef";
const WORK_ID = "11111111-1111-4111-8111-111111111111";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const PRECOMMIT_GATE = Object.freeze({
  task_id: "22222222-2222-4222-8222-222222222222",
  plan_id: "33333333-3333-4333-8333-333333333333",
  evaluation_id: "44444444-4444-4444-8444-444444444444",
  evaluation_digest: "4".repeat(64),
  workspace_digest: "5".repeat(64),
  supersession_digest: "6".repeat(64),
  reconciliation_digest: "7".repeat(64),
  projection_digest: "8".repeat(64),
});
const bootstrapDependencies = Object.freeze({
  reviewWorkBootstrap: async () => { throw new Error("unexpected_bootstrap_review"); },
  createWorkBootstrap: async () => { throw new Error("unexpected_bootstrap_create"); },
});
const nativeDependencies = Object.freeze({
  resumeExistingWork: async () => { throw new Error("unexpected_work_resume"); },
  createNativePlan: async () => { throw new Error("unexpected_native_plan"); },
  bindNativeChild: async () => { throw new Error("unexpected_native_bind"); },
  authorizeNativeCoordination: async () => {
    throw new Error("unexpected_native_coordination");
  },
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function legacyV1Token(candidateAttestation) {
  const [, encoded] = String(candidateAttestation || "").split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  payload.schema_version = "nyra_governed_continue_attestation_v1";
  delete payload.continuation_operation;
  const legacyEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET)
    .update(`nyra-governed-continue-v1\u0000${JSON.stringify(stable(payload))}`)
    .digest("base64url");
  return `ngc1.${legacyEncoded}.${signature}`;
}

function legacyV1VerifierAccepts(candidateAttestation) {
  const [prefix, encoded, signature, extra] = String(candidateAttestation || "").split(".");
  if (prefix !== "ngc1" || !encoded || !signature || extra) return false;
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (payload.schema_version !== "nyra_governed_continue_attestation_v1") return false;
  const expected = crypto.createHmac("sha256", SECRET)
    .update(`nyra-governed-continue-v1\u0000${JSON.stringify(stable(payload))}`)
    .digest("base64url");
  return expected === signature;
}

function identity(overrides = {}) {
  return {
    kind: "oauth",
    tenantId: "tenant-a",
    subject: "owner-a",
    ownerConfirmed: true,
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      registry_revision: DIGEST_C,
      app_id: "chatgpt_prod",
      auth_kind: "oauth",
      host_kind: "chatgpt_native",
      client_type: "chatgpt",
      interaction_mode: "nyra_conversational",
      capabilities: Object.values(HOST_APP_CAPABILITIES),
    },
    agentPresence: {
      session_fingerprint: "d".repeat(24),
      client_type: "chatgpt",
      session_id: "chatgpt-session",
      agent_id: "chatgpt-agent",
    },
    ...overrides,
  };
}

function directive(actionClass = "GIT_MERGE", state = "MANUAL_ONLY") {
  return {
    directive_id: "nyra_dir_1234567890abcdef12345678",
    request_digest: DIGEST_B,
    ticket_request: {
      required: true,
      state,
      action_class: actionClass,
      merge_policy: actionClass === "GIT_MERGE" ? "MANUAL_ONLY" : "NOT_APPLICABLE",
      request_digest: DIGEST_A,
      binding: {
        tenant_id: "tenant-a",
        work_id: WORK_ID,
        project_id: "project-a",
        work_revision: 7,
        intent_digest: DIGEST_B,
        context_digest: DIGEST_C,
        precommit_ticket_gate: actionClass === "GIT_COMMIT" ? PRECOMMIT_GATE : null,
      },
    },
  };
}

function issueAction(
  attestor,
  continuationOperation = "authorize_action",
  caller = identity(),
  actionClass = "GIT_MERGE",
  state = "MANUAL_ONLY",
) {
  return attestor.issue({
    identity: caller,
    directive: directive(actionClass, state),
    continuationOperation,
  });
}

function continuationDirective(overrides = {}) {
  const base = directive("PULL_REQUEST_OPEN", "NEEDS_CONTEXT");
  return {
    ...base,
    can_continue: true,
    decision: {
      disposition: "PREPARE_BOUNDED_WORK",
      execution_authorized: false,
      external_action_authorized: false,
    },
    permitted_progress: ["READ_ONLY", "ANALYSIS", "EVIDENCE", "BOUNDED_WORKSPACE"],
    work_context: { status: "ACTIVE" },
    ticket_request: {
      ...base.ticket_request,
      request_digest: null,
      ...overrides.ticket_request,
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "ticket_request")),
  };
}

function normalizedContext(overrides = {}) {
  return {
    available: true,
    work_id: WORK_ID,
    project_id: "project-a",
    work_revision: 7,
    intent_digest: DIGEST_B,
    context_digest: DIGEST_C,
    status: "ACTIVE",
    ...overrides,
  };
}

function trustedCommitTicketReadback(clock, overrides = {}) {
  const ticket = {
    schema_version: "host_native_action_ticket_v1",
    ticket_id: `hnt_${"2".repeat(64)}`,
    delegation_id: "hnd_delegation-12345678",
    tenant_id: "tenant-a",
    work_id: WORK_ID,
    intent_anchor_digest: DIGEST_B,
    repository: "owner/repo",
    host_kind: "chatgpt_native",
    host_session_fingerprint: "d".repeat(24),
    action: { kind: "git.commit", repository: "owner/repo", branch: "feature" },
    evidence_digest: PRECOMMIT_GATE.projection_digest,
    issued_at: new Date(clock).toISOString(),
    expires_at: new Date(clock + 60_000).toISOString(),
    max_uses: 1,
    provider_execution: false,
    host_policy_override: false,
    host_policy_must_allow: true,
    signature: `hnt_${"3".repeat(64)}`,
    ...overrides,
  };
  return {
    structuredContent: {
      ok: true,
      tenant_id: "tenant-a",
      action_ticket: {
        schema_version: "host_native_action_ticket_record_v1",
        tenant_id: "tenant-a",
        state: "issued",
        uses: 0,
        ticket,
      },
    },
    content: [],
  };
}

test("admits git.commit in the bounded continuation delegation schema", () => {
  const tool = TOOLS.find((item) => item.name === "nyra_governed_continue");
  const allowedKinds = tool.inputSchema.properties.delegation_request
    .properties.allowed_actions.items.enum;
  assert(allowedKinds.includes("git.commit"));
  assert.equal(allowedKinds.includes("github.commit"), false);
});

function bootstrapSpec(overrides = {}) {
  return {
    request_id: "entity-360-bootstrap-001",
    work_name: "Entità 360",
    work_type: "software_git",
    idea: "General-purpose context and evidence layer",
    objective: "Create one canonical Entity 360 Work without duplicates",
    architecture: { layer: "context_evidence" },
    next_action: "Review architecture and task graph",
    acceptance_criteria: ["One persistent Work Identity is created"],
    constraints: ["Universal Core remains final authority"],
    tasks: [{ title: "Review architecture", weight: 2, required: true }],
    ...overrides,
  };
}

function boundedUniqueText(prefix, index, length) {
  const marker = `${prefix}-${String(index).padStart(3, "0")}-`;
  return `${marker}${"x".repeat(length - marker.length)}`;
}

test("production issuer forwards the signed operation binding without projection", () => {
  let received = null;
  const issuer = createNyraGovernedContinuationIssuer({
    issue: (candidate) => {
      received = candidate;
      return { available: false };
    },
  });
  const candidate = Object.freeze({
    identity: identity(),
    directive: directive(),
    continuationOperation: "authorize_action",
  });
  issuer(candidate);
  assert.equal(received, candidate);
  assert.equal(received.continuationOperation, "authorize_action");
});

function bootstrapDirective(spec = bootstrapSpec(), caller = identity()) {
  const request = materializeGovernedWorkBootstrapRequest({
    spec,
    identity: caller,
    projectId: "project-a",
  });
  return {
    directive: {
      directive_id: "nyra_dir_1234567890abcdef12345678",
      request_digest: DIGEST_B,
      ticket_request: {
        required: true,
        state: "WORK_BOOTSTRAP_READY",
        action_class: "WORK_BOOTSTRAP",
        merge_policy: "NOT_APPLICABLE",
        request_digest: DIGEST_A,
        work_bootstrap_request_digest: governedWorkBootstrapDigest(request),
        binding: {
          tenant_id: "tenant-a",
          work_id: null,
          project_id: "project-a",
          work_revision: null,
          intent_digest: null,
          context_digest: null,
        },
      },
    },
    request,
  };
}

test("issues a short-lived candidate only to a registered capable host", () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const issued = issueAction(attestor);
  assert.equal(issued.available, true);
  assert.equal(issued.submit_tool, "nyra_governed_continue");
  assert.match(issued.candidate_attestation, /^ngc2\./);
  assert.equal(legacyV1VerifierAccepts(issued.candidate_attestation), false);
  assert.throws(() => attestor.verify({
    token: legacyV1Token(issued.candidate_attestation),
    identity: identity(),
    idempotencyKey: "legacy-action-token",
    replayOperation: "authorize_action",
  }), /nyra_governed_continue_attestation_binding_mismatch/);
  assert.equal(attestor.issue({
    identity: identity(),
    directive: directive("GIT_COMMIT", "READY_FOR_CORE_REVIEW"),
    continuationOperation: "authorize_action",
  }).available, true);

  const unknown = identity({
    authenticatedHostPrincipal: {
      ...identity().authenticatedHostPrincipal,
      registered: false,
      app_id: null,
      host_kind: null,
      capabilities: ["work.read"],
    },
  });
  assert.equal(issueAction(attestor, "authorize_action", unknown).available, false);
  assert.equal(issueAction(attestor, "authorize_action", identity(), "GIT_MERGE", "NEEDS_CONTEXT").available, false);
  assert.equal(attestor.issue({ identity: identity(), directive: directive() }).available, false);
  assert.equal(attestor.issue({ identity: identity(), directive: directive() }).reason,
    "continuation_operation_required");
  const futureHost = identity({
    authenticatedHostPrincipal: {
      ...identity().authenticatedHostPrincipal,
      app_id: "future_ai",
      host_kind: "future_ai_native",
    },
  });
  const unsupported = issueAction(attestor, "authorize_action", futureHost);
  assert.equal(unsupported.available, false);
  assert.equal(unsupported.reason, "host_native_host_kind_not_supported");
});

test("issues a distinct internal Work candidate without turning it into an external ticket", () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = attestor.issue({
    identity: identity(),
    directive: continuationDirective(),
  });
  assert.equal(candidate.available, true);
  assert.deepEqual(candidate.operations, ["resume_existing_work", "create_native_plan"]);
  assert.equal(candidate.operations.includes("bind_native_child"), false);
  assert.equal(candidate.operations.includes("authorize_action"), false);
  assert.equal(candidate.operations.includes("work_continuity_native_report"), false);

  const terminal = attestor.issue({
    identity: identity(),
    directive: continuationDirective({ work_context: { status: "COMPLETED" } }),
  });
  assert.equal(terminal.available, false);

  const external = attestor.issue({
    identity: identity(),
    continuationOperation: "authorize_action",
    directive: {
      ...continuationDirective(),
      ticket_request: directive().ticket_request,
    },
  });
  assert.deepEqual(external.operations, ["issue_delegation", "authorize_action"]);
  assert.equal(external.operations.includes("create_native_plan"), false);
});

test("resumes only the attested Work, revision and transport session through the existing gate", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = attestor.issue({ identity: identity(), directive: continuationDirective() });
  const calls = [];
  const makeHandler = (context = normalizedContext()) => createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => ({ raw: true }),
    normalizeDirectiveContext: () => context,
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    authorizeAction: async () => { throw new Error("unexpected_action"); },
    resumeExistingWork: async (args, caller) => {
      calls.push({ args, caller });
      return { structuredContent: { ok: true, result: {
        tenant_id: caller.tenantId,
        work_id: args.work_id,
        resumed: true,
      }, dedicated_core_gate: { authorized: true } } };
    },
  });
  const request = {
    operation: "resume_existing_work",
    candidate_attestation: candidate.candidate_attestation,
    idempotency_key: "resume-existing-work-001",
    owner_confirmed: true,
    confirmation_reference: "owner-resume-e360",
    resume_request: {
      work_id: WORK_ID,
      session_id: "chatgpt-session",
      current_state_hashes: {
        repository_hash: DIGEST_A,
        policy_hash: DIGEST_B,
        live_state_hash: DIGEST_C,
      },
    },
  };
  const resumed = await makeHandler()(request, identity());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.work_id, WORK_ID);
  assert.match(calls[0].args.idempotency_key, /^nyra_cont_[a-f0-9]{48}$/);
  assert.equal(resumed.structuredContent.work_resumed, true);
  assert.equal(resumed.structuredContent.external_action_authorized, false);

  const wrongSessionCandidate = attestor.issue({
    identity: identity(),
    directive: continuationDirective(),
  });
  await assert.rejects(makeHandler()({
    ...request,
    candidate_attestation: wrongSessionCandidate.candidate_attestation,
    idempotency_key: "resume-wrong-session-001",
    resume_request: { ...request.resume_request, session_id: "other-session" },
  }, identity()), /native_request_binding_mismatch/);

  const wrongRevisionCandidate = attestor.issue({
    identity: identity(),
    directive: continuationDirective(),
  });
  await assert.rejects(makeHandler(normalizedContext({ work_revision: 8 }))({
    ...request,
    candidate_attestation: wrongRevisionCandidate.candidate_attestation,
    idempotency_key: "resume-wrong-revision-001",
  }, identity()), /work_drift/);

  const crossTenantCandidate = attestor.issue({
    identity: identity(),
    directive: continuationDirective(),
  });
  await assert.rejects(makeHandler()({
    ...request,
    candidate_attestation: crossTenantCandidate.candidate_attestation,
    idempotency_key: "resume-cross-tenant-001",
  }, identity({ tenantId: "tenant-b" })), /attestation_binding_mismatch/);
});

test("two replicas converge on one downstream resume replay without sharing process memory", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const issuer = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = issuer.issue({ identity: identity(), directive: continuationDirective() });
  const downstream = new Map();
  const observedKeys = [];
  const buildReplica = () => {
    const verifier = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
    return createNyraGovernedContinueHandler({
      ...bootstrapDependencies,
      ...nativeDependencies,
      attestor: verifier,
      readDirectiveContext: async () => ({ raw: true }),
      normalizeDirectiveContext: () => normalizedContext(),
      issueDelegation: async () => { throw new Error("unexpected_delegation"); },
      authorizeAction: async () => { throw new Error("unexpected_action"); },
      resumeExistingWork: async (request, caller) => {
        observedKeys.push(request.idempotency_key);
        const existing = downstream.get(request.idempotency_key);
        if (existing) return existing;
        const result = { structuredContent: { ok: true, result: {
          tenant_id: caller.tenantId,
          work_id: request.work_id,
          resumed: true,
          idempotent_replay: false,
        } } };
        downstream.set(request.idempotency_key, result);
        return result;
      },
    });
  };
  const request = {
    operation: "resume_existing_work",
    candidate_attestation: candidate.candidate_attestation,
    idempotency_key: "resume-two-replicas-001",
    owner_confirmed: true,
    confirmation_reference: "owner-resume-two-replicas",
    resume_request: {
      work_id: WORK_ID,
      session_id: "chatgpt-session",
      current_state_hashes: {
        repository_hash: DIGEST_A,
        policy_hash: DIGEST_B,
        live_state_hash: DIGEST_C,
      },
    },
  };
  const first = await buildReplica()(request, identity());
  const second = await buildReplica()(request, identity());
  assert.equal(first.structuredContent.work_resumed, true);
  assert.equal(second.structuredContent.work_resumed, true);
  assert.equal(observedKeys.length, 2);
  assert.equal(observedKeys[0], observedKeys[1]);
  assert.equal(downstream.size, 1);
});

test("handler rejects expired and registry-drifted continuations before Core dispatch", async () => {
  let clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({
    secret: SECRET,
    now: () => clock,
    ttlMs: 60_000,
  });
  let calls = 0;
  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => ({ raw: true }),
    normalizeDirectiveContext: () => normalizedContext(),
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    authorizeAction: async () => { throw new Error("unexpected_action"); },
    resumeExistingWork: async () => { calls += 1; return {}; },
  });
  const requestFor = (candidate, idempotencyKey) => ({
    operation: "resume_existing_work",
    candidate_attestation: candidate.candidate_attestation,
    idempotency_key: idempotencyKey,
    resume_request: {
      work_id: WORK_ID,
      session_id: "chatgpt-session",
      current_state_hashes: {
        repository_hash: DIGEST_A,
        policy_hash: DIGEST_B,
        live_state_hash: DIGEST_C,
      },
    },
  });
  const expired = attestor.issue({ identity: identity(), directive: continuationDirective() });
  clock += 60_001;
  await assert.rejects(
    handler(requestFor(expired, "expired-handler-001"), identity()),
    /attestation_expired/,
  );
  clock = Date.parse("2026-08-25T12:02:00.000Z");
  const registryBound = attestor.issue({ identity: identity(), directive: continuationDirective() });
  const driftedIdentity = identity({
    authenticatedHostPrincipal: {
      ...identity().authenticatedHostPrincipal,
      registry_revision: DIGEST_A,
    },
  });
  await assert.rejects(
    handler(requestFor(registryBound, "registry-drift-handler-001"), driftedIdentity),
    /attestation_binding_mismatch/,
  );
  assert.equal(calls, 0);
});

test("derives a plan-bound child candidate and rejects host, plan, task and replay substitution", async () => {
  let clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  // Production binds a native plan to an MCP transport fingerprint while the
  // conversation attestation remains bound to its logical session fingerprint.
  const caller = identity({
    agentPresence: {
      ...identity().agentPresence,
      transport_bound: true,
      host_transport_session_fingerprint: "e".repeat(64),
    },
  });
  const rootCandidate = attestor.issue({ identity: caller, directive: continuationDirective() });
  const PLAN_ID = "22222222-2222-4222-8222-222222222222";
  const nativeTasks = [
    { task_id: "build", kind: "builder", instruction: "Implement the bounded bridge." },
    { task_id: "verify", kind: "verifier", instruction: "Verify the bounded bridge.", dependencies: ["build"] },
  ];
  const taskDigests = { build: DIGEST_A, verify: DIGEST_B };
  const nativePlanResult = (caller) => ({ structuredContent: { ok: true, result: {
    schema_version: "work_continuity_fabric_v2",
    tenant_id: caller.tenantId,
    work_id: WORK_ID,
    plan_digest: DIGEST_C,
    plan: {
      plan_id: PLAN_ID,
      host_type: "chatgpt_native",
      coordinator_session_fingerprint: "e".repeat(64),
      tasks: nativeTasks.map((task) => ({
        ...task,
        task_digest: taskDigests[task.task_id],
      })),
    },
  } } });
  const calls = [];
  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    attestor,
    readDirectiveContext: async () => ({ raw: true }),
    normalizeDirectiveContext: () => normalizedContext(),
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    authorizeAction: async () => { throw new Error("unexpected_action"); },
    resumeExistingWork: async () => { throw new Error("unexpected_resume"); },
    authorizeNativeCoordination: async (request) => { calls.push({ phase: "gate", request }); },
    createNativePlan: async (request, caller) => {
      calls.push({ phase: "plan", request });
      return nativePlanResult(caller);
    },
    bindNativeChild: async (request, caller) => {
      calls.push({ phase: "bind", request });
      return { structuredContent: { ok: true, result: {
        tenant_id: caller.tenantId,
        work_id: WORK_ID,
        plan_id: PLAN_ID,
        binding: {
          task_id: request.task_id,
          task_digest: taskDigests[request.task_id],
          agent_id: request.native_agent_id,
          host_type: request.host_type,
          host_task_id: request.host_task_id,
        },
        assignment_capability: `hnac_${"x".repeat(43)}`,
      } } };
    },
  });
  const planRequest = {
    operation: "create_native_plan",
    candidate_attestation: rootCandidate.candidate_attestation,
    idempotency_key: "native-plan-create-001",
    native_plan_request: {
      work_id: WORK_ID,
      repository: "owner/repo",
      base_branch: "main",
      host_type: "chatgpt_native",
      required_checks: ["core-mcp"],
      tasks: nativeTasks,
      max_parallel: 2,
    },
  };
  clock += 60_000;
  const planned = await handler(planRequest, caller);
  assert.equal(planned.structuredContent.native_plan_created, true);
  const nextContinuation = planned.structuredContent.next_governed_continuation;
  assert.deepEqual(nextContinuation.operations, ["bind_native_child"]);
  assert(Date.parse(nextContinuation.expires_at) <= Date.parse(rootCandidate.expires_at));
  assert.deepEqual(calls.map((call) => call.phase), ["gate", "plan"]);
  const bindCandidate = nextContinuation.candidate_attestation;
  const bindRequest = {
    operation: "bind_native_child",
    candidate_attestation: bindCandidate,
    idempotency_key: "native-bind-build-001",
    native_bind_request: {
      work_id: WORK_ID,
      plan_id: PLAN_ID,
      task_id: "build",
      native_agent_id: "chatgpt-builder",
      host_type: "chatgpt_native",
      host_task_id: "/root/build",
    },
  };
  const bound = await handler(bindRequest, caller);
  assert.equal(bound.structuredContent.native_child_bound, true);
  assert.equal(bound.structuredContent.bound_task_id, "build");
  assert.match(bound.structuredContent.core_result.result.assignment_capability, /^hnac_/);

  const replicaBindCalls = [];
  const replicaHandler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    ...nativeDependencies,
    attestor: createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock }),
    readDirectiveContext: async () => ({ raw: true }),
    normalizeDirectiveContext: () => normalizedContext(),
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    authorizeAction: async () => { throw new Error("unexpected_action"); },
    authorizeNativeCoordination: async () => {},
    bindNativeChild: async (request, caller) => {
      replicaBindCalls.push(request);
      return { structuredContent: { ok: true, result: {
        tenant_id: caller.tenantId,
        work_id: WORK_ID,
        plan_id: PLAN_ID,
        idempotent_replay: true,
        binding: {
          task_id: request.task_id,
          task_digest: taskDigests[request.task_id],
          agent_id: request.native_agent_id,
          host_type: request.host_type,
          host_task_id: request.host_task_id,
        },
        assignment_capability: `hnac_${"x".repeat(43)}`,
      } } };
    },
  });
  const replicaBound = await replicaHandler(bindRequest, caller);
  const firstBindCall = calls.find((call) => call.phase === "bind");
  assert.equal(replicaBound.structuredContent.native_child_bound, true);
  assert.equal(replicaBindCalls.length, 1);
  assert.equal(replicaBindCalls[0].idempotency_key, firstBindCall.request.idempotency_key);
  assert.equal(replicaBindCalls[0].task_id, firstBindCall.request.task_id);

  const wrongHostRoot = attestor.issue({ identity: identity(), directive: continuationDirective() });
  await assert.rejects(handler({
    ...planRequest,
    candidate_attestation: wrongHostRoot.candidate_attestation,
    idempotency_key: "native-plan-wrong-host-001",
    native_plan_request: { ...planRequest.native_plan_request, host_type: "codex_native" },
  }, identity()), /native_request_binding_mismatch/);

  await assert.rejects(handler({
    ...bindRequest,
    idempotency_key: "native-bind-wrong-plan-001",
    native_bind_request: {
      ...bindRequest.native_bind_request,
      plan_id: "33333333-3333-4333-8333-333333333333",
    },
  }, identity()), /native_bind_binding_mismatch/);
  await assert.rejects(handler({
    ...bindRequest,
    idempotency_key: "native-bind-wrong-task-001",
    native_bind_request: { ...bindRequest.native_bind_request, task_id: "invented" },
  }, identity()), /native_bind_binding_mismatch/);
  await assert.rejects(handler({
    ...bindRequest,
    idempotency_key: "native-bind-substitution-001",
    native_bind_request: { ...bindRequest.native_bind_request, native_agent_id: "other-builder" },
  }, identity()), /attestation_replayed/);
  await assert.rejects(handler({
    operation: "work_continuity_native_report",
    candidate_attestation: bindCandidate,
    idempotency_key: "native-report-forbidden-001",
  }, identity()), /operation_invalid/);

  for (const [field, value] of [
    ["agent_id", "wrong-builder"],
    ["host_type", "codex_native"],
    ["host_task_id", "/root/wrong-build"],
  ]) {
    const replicaAttestor = createNyraGovernedContinueAttestor({
      secret: SECRET,
      now: () => clock,
    });
    const mismatchedReadbackHandler = createNyraGovernedContinueHandler({
      ...bootstrapDependencies,
      ...nativeDependencies,
      attestor: replicaAttestor,
      readDirectiveContext: async () => ({ raw: true }),
      normalizeDirectiveContext: () => normalizedContext(),
      issueDelegation: async () => { throw new Error("unexpected_delegation"); },
      authorizeAction: async () => { throw new Error("unexpected_action"); },
      authorizeNativeCoordination: async () => {},
      bindNativeChild: async (request, caller) => ({ structuredContent: { ok: true, result: {
        tenant_id: caller.tenantId,
        work_id: WORK_ID,
        plan_id: PLAN_ID,
        binding: {
          task_id: request.task_id,
          task_digest: taskDigests[request.task_id],
          agent_id: request.native_agent_id,
          host_type: request.host_type,
          host_task_id: request.host_task_id,
          [field]: value,
        },
        assignment_capability: `hnac_${"x".repeat(43)}`,
      } } }),
    });
    await assert.rejects(mismatchedReadbackHandler({
      ...bindRequest,
      idempotency_key: `native-bind-readback-${field}`,
    }, identity()), /native_bind_readback_mismatch/);
  }

  const expiringParent = attestor.issue({
    identity: identity(),
    directive: continuationDirective(),
  });
  const [, encodedParent] = expiringParent.candidate_attestation.split(".");
  const parentPayload = JSON.parse(Buffer.from(encodedParent, "base64url").toString("utf8"));
  clock += 5 * 60_000 + 1;
  assert.throws(() => attestor.issueNativePlanBinding({
    identity: identity(),
    parentPayload,
    planResult: nativePlanResult(identity()),
  }), /native_plan_parent_expired/);
});

test("submits a merge candidate for a Core ticket without reserving or executing it", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = issueAction(attestor);
  const calls = [];
  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => ({ raw: true }),
    normalizeDirectiveContext: () => normalizedContext(),
    issueDelegation: async () => {
      throw new Error("unexpected_delegation");
    },
    authorizeAction: async (args, caller) => {
      calls.push({ args, caller });
      return {
        structuredContent: {
          action_ticket: { ticket: { ticket_id: `hnt_${"1".repeat(64)}` } },
          provider_execution: false,
        },
        content: [],
      };
    },
  });
  const response = await handler({
    operation: "authorize_action",
    candidate_attestation: candidate.candidate_attestation,
    idempotency_key: "authorize-merge-1",
    action_request: {
      delegation_id: "hnd_delegation-12345678",
      work_id: WORK_ID,
      intent_anchor_digest: DIGEST_B,
      repository: "owner/repo",
      action: { kind: "github.merge", repository: "owner/repo" },
      evidence_digest: DIGEST_A,
    },
  }, identity());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.action.kind, "github.merge");
  assert.equal(calls[0].caller.authenticatedHostPrincipal.host_kind, "chatgpt_native");
  assert.equal(response.structuredContent.ticket_issued, true);
  assert.equal(response.structuredContent.execution_authorized, false);
  assert.equal(response.structuredContent.external_action_authorized, false);
  assert.equal(response.structuredContent.provider_execution, false);
  assert.equal(response.structuredContent.host_response_contract.speaker, "Nyra");
});

test("submits an exact local commit candidate without widening it to push", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = attestor.issue({
    identity: identity(),
    directive: directive("GIT_COMMIT", "READY_FOR_CORE_REVIEW"),
    continuationOperation: "authorize_action",
  });
  const calls = [];
  const reads = [];
  const fulfillments = [];
  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    attestor,
    readDirectiveContext: async () => ({ raw: true }),
    normalizeDirectiveContext: () => normalizedContext({
      precommit_ticket_gate_applicable: true,
      precommit_ticket_gate: PRECOMMIT_GATE,
    }),
    issueDelegation: async () => {
      throw new Error("unexpected_delegation");
    },
    authorizeAction: async (args) => {
      calls.push(args);
      return {
        structuredContent: {
          action_ticket: { ticket: { ticket_id: `hnt_${"2".repeat(64)}` } },
        },
        content: [],
      };
    },
    readActionTicket: async (args) => {
      reads.push(args);
      return trustedCommitTicketReadback(clock);
    },
    fulfillPrecommitTicketTask: async (args) => { fulfillments.push(args); },
    now: () => clock,
  });
  const response = await handler({
    operation: "authorize_action",
    candidate_attestation: candidate.candidate_attestation,
    idempotency_key: "authorize-commit-1",
    action_request: {
      delegation_id: "hnd_delegation-12345678",
      work_id: WORK_ID,
      intent_anchor_digest: DIGEST_B,
      repository: "owner/repo",
      action: { kind: "git.commit", repository: "owner/repo", branch: "feature" },
      evidence_digest: PRECOMMIT_GATE.projection_digest,
    },
  }, identity());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action.kind, "git.commit");
  assert.deepEqual(reads, [{ ticket_id: `hnt_${"2".repeat(64)}` }]);
  assert.equal(fulfillments.length, 1);
  assert.equal(fulfillments[0].gate_projection_digest, PRECOMMIT_GATE.projection_digest);
  assert.equal(response.structuredContent.ticket_issued, true);
  assert.equal(response.structuredContent.execution_authorized, false);
  assert.equal(response.structuredContent.external_action_authorized, false);
});

test("validates the complete trusted commit ticket and its validity window before fulfillment", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const cases = [
    ["expired", { expires_at: new Date(clock).toISOString() }],
    ["future", { issued_at: new Date(clock + 31_000).toISOString(),
      expires_at: new Date(clock + 61_000).toISOString() }],
    ["wrong delegation", { delegation_id: "hnd_other-12345678" }],
    ["wrong host", { host_session_fingerprint: "e".repeat(24) }],
    ["changed action", { action: { kind: "git.commit", repository: "owner/repo", branch: "other" } }],
  ];
  for (const [label, overrides] of cases) {
    const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
    const candidate = issueAction(
      attestor, "authorize_action", identity(), "GIT_COMMIT", "READY_FOR_CORE_REVIEW",
    );
    let fulfillments = 0;
    const handler = createNyraGovernedContinueHandler({
      ...bootstrapDependencies,
      ...nativeDependencies,
      attestor,
      readDirectiveContext: async () => ({ raw: true }),
      normalizeDirectiveContext: () => normalizedContext({
        precommit_ticket_gate_applicable: true,
        precommit_ticket_gate: PRECOMMIT_GATE,
      }),
      issueDelegation: async () => { throw new Error("unexpected_delegation"); },
      authorizeAction: async () => ({ structuredContent: {
        action_ticket: { ticket: { ticket_id: `hnt_${"2".repeat(64)}` } },
      } }),
      readActionTicket: async () => trustedCommitTicketReadback(clock, overrides),
      fulfillPrecommitTicketTask: async () => { fulfillments += 1; },
      now: () => clock,
    });
    await assert.rejects(handler({
      operation: "authorize_action",
      candidate_attestation: candidate.candidate_attestation,
      idempotency_key: `authorize-commit-invalid-${label.replaceAll(" ", "-")}`,
      action_request: {
        delegation_id: "hnd_delegation-12345678",
        work_id: WORK_ID,
        intent_anchor_digest: DIGEST_B,
        repository: "owner/repo",
        action: { kind: "git.commit", repository: "owner/repo", branch: "feature" },
        evidence_digest: PRECOMMIT_GATE.projection_digest,
      },
    }, identity()), /nyra_governed_continue_commit_ticket_readback_invalid/, label);
    assert.equal(fulfillments, 0, label);
  }
});

test("fails closed when the trusted commit ticket readback is unavailable", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = issueAction(
    attestor, "authorize_action", identity(), "GIT_COMMIT", "READY_FOR_CORE_REVIEW",
  );
  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => ({ raw: true }),
    normalizeDirectiveContext: () => normalizedContext({
      precommit_ticket_gate_applicable: true,
      precommit_ticket_gate: PRECOMMIT_GATE,
    }),
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    authorizeAction: async () => ({ structuredContent: {
      action_ticket: { ticket: { ticket_id: `hnt_${"2".repeat(64)}` } },
    } }),
    fulfillPrecommitTicketTask: async () => { throw new Error("unexpected_fulfillment"); },
    now: () => clock,
  });
  await assert.rejects(handler({
    operation: "authorize_action",
    candidate_attestation: candidate.candidate_attestation,
    idempotency_key: "authorize-commit-readback-missing",
    action_request: {
      delegation_id: "hnd_delegation-12345678",
      work_id: WORK_ID,
      intent_anchor_digest: DIGEST_B,
      repository: "owner/repo",
      action: { kind: "git.commit", repository: "owner/repo", branch: "feature" },
      evidence_digest: PRECOMMIT_GATE.projection_digest,
    },
  }, identity()), /nyra_governed_continue_commit_ticket_readback_unavailable/);
});

test("rejects a forged precommit evidence digest before calling Core", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = issueAction(
    attestor,
    "authorize_action",
    identity(),
    "GIT_COMMIT",
    "READY_FOR_CORE_REVIEW",
  );
  let authorizeCalls = 0;
  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => ({ raw: true }),
    normalizeDirectiveContext: () => normalizedContext({
      precommit_ticket_gate_applicable: true,
      precommit_ticket_gate: PRECOMMIT_GATE,
    }),
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    authorizeAction: async () => { authorizeCalls += 1; return {}; },
  });

  await assert.rejects(handler({
    operation: "authorize_action",
    candidate_attestation: candidate.candidate_attestation,
    idempotency_key: "authorize-commit-forged-evidence",
    action_request: {
      delegation_id: "hnd_delegation-12345678",
      work_id: WORK_ID,
      intent_anchor_digest: DIGEST_B,
      repository: "owner/repo",
      action: { kind: "git.commit", repository: "owner/repo", branch: "feature" },
      evidence_digest: DIGEST_A,
    },
  }, identity()), /nyra_governed_continue_precommit_evidence_mismatch/);
  assert.equal(authorizeCalls, 0);
});

test("rejects a drifted precommit projection before calling Core", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = issueAction(
    attestor,
    "authorize_action",
    identity(),
    "GIT_COMMIT",
    "READY_FOR_CORE_REVIEW",
  );
  let authorizeCalls = 0;
  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => ({ raw: true }),
    normalizeDirectiveContext: () => normalizedContext({
      precommit_ticket_gate_applicable: true,
      precommit_ticket_gate: { ...PRECOMMIT_GATE, projection_digest: DIGEST_A },
    }),
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    authorizeAction: async () => { authorizeCalls += 1; return {}; },
  });

  await assert.rejects(handler({
    operation: "authorize_action",
    candidate_attestation: candidate.candidate_attestation,
    idempotency_key: "authorize-commit-drifted-gate",
    action_request: {
      delegation_id: "hnd_delegation-12345678",
      work_id: WORK_ID,
      intent_anchor_digest: DIGEST_B,
      repository: "owner/repo",
      action: { kind: "git.commit", repository: "owner/repo", branch: "feature" },
      evidence_digest: PRECOMMIT_GATE.projection_digest,
    },
  }, identity()), /nyra_governed_continue_work_drift/);
  assert.equal(authorizeCalls, 0);
});

test("derives the same downstream idempotency key across process replicas", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const firstAttestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = issueAction(firstAttestor);
  const downstreamKeys = [];
  const makeHandler = (attestor) => createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => ({}),
    normalizeDirectiveContext: () => normalizedContext(),
    issueDelegation: async () => ({}),
    authorizeAction: async (args) => {
      downstreamKeys.push(args.idempotency_key);
      return { structuredContent: { action_ticket: { ticket: {
        ticket_id: `hnt_${"9".repeat(64)}`,
      } } } };
    },
  });
  const input = {
    operation: "authorize_action",
    candidate_attestation: candidate.candidate_attestation,
    action_request: {
      delegation_id: "hnd_delegation-12345678",
      work_id: WORK_ID,
      intent_anchor_digest: DIGEST_B,
      repository: "owner/repo",
      action: { kind: "github.merge", repository: "owner/repo" },
      evidence_digest: DIGEST_A,
    },
  };

  await makeHandler(firstAttestor)({ ...input, idempotency_key: "caller-key-one" }, identity());
  const secondAttestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  await makeHandler(secondAttestor)({ ...input, idempotency_key: "caller-key-two" }, identity());

  assert.equal(downstreamKeys.length, 2);
  assert.equal(downstreamKeys[0], downstreamKeys[1]);
  assert.match(downstreamKeys[0], /^nyra_cont_[a-f0-9]{48}$/);
  assert.notEqual(downstreamKeys[0], "caller-key-one");
});

test("keeps one durable plan key across replicas so changed plan bodies fail closed", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const firstAttestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const secondAttestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = firstAttestor.issue({
    identity: identity(),
    directive: continuationDirective(),
  });
  const planId = "22222222-2222-4222-8222-222222222222";
  const durableRequests = new Map();
  const downstreamKeys = [];
  const makeHandler = (attestor) => createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => ({ raw: true }),
    normalizeDirectiveContext: () => normalizedContext(),
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    authorizeAction: async () => { throw new Error("unexpected_action"); },
    authorizeNativeCoordination: async () => {},
    createNativePlan: async (request, caller) => {
      const key = request.idempotency_key;
      const durableBody = JSON.stringify({
        work_id: request.work_id,
        repository: request.repository,
        base_branch: request.base_branch,
        host_type: request.host_type,
        required_checks: request.required_checks,
        tasks: request.tasks,
        max_parallel: request.max_parallel,
      });
      downstreamKeys.push(key);
      const existing = durableRequests.get(key);
      if (existing && existing !== durableBody) {
        const error = new Error("native_plan_idempotency_conflict");
        error.status = 409;
        throw error;
      }
      durableRequests.set(key, durableBody);
      return { structuredContent: { ok: true, result: {
        schema_version: "work_continuity_fabric_v2",
        tenant_id: caller.tenantId,
        work_id: WORK_ID,
        plan_digest: DIGEST_C,
        plan: {
          plan_id: planId,
          host_type: request.host_type,
          coordinator_session_fingerprint: "d".repeat(24),
          tasks: request.tasks.map((task) => ({ ...task, task_digest: DIGEST_A })),
        },
      } } };
    },
  });
  const input = {
    operation: "create_native_plan",
    candidate_attestation: candidate.candidate_attestation,
    native_plan_request: {
      work_id: WORK_ID,
      repository: "owner/repo",
      base_branch: "main",
      host_type: "chatgpt_native",
      required_checks: ["core-mcp"],
      tasks: [{
        task_id: "build",
        kind: "builder",
        instruction: "Implement version one.",
      }],
      max_parallel: 1,
    },
  };

  await makeHandler(firstAttestor)({
    ...input,
    idempotency_key: "plan-replica-body-one",
  }, identity());
  await assert.rejects(makeHandler(secondAttestor)({
    ...input,
    idempotency_key: "plan-replica-body-two",
    native_plan_request: {
      ...input.native_plan_request,
      tasks: [{
        ...input.native_plan_request.tasks[0],
        instruction: "Implement a substituted version two.",
      }],
    },
  }, identity()), /native_plan_idempotency_conflict/);

  assert.equal(downstreamKeys.length, 2);
  assert.equal(downstreamKeys[0], downstreamKeys[1]);
  assert.match(downstreamKeys[0], /^nyra_cont_[a-f0-9]{48}$/);
  assert.equal(durableRequests.size, 1);
});

test("fails closed on host/session drift, Work drift, replay and action-class substitution", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = issueAction(attestor);
  assert.throws(() => attestor.verify({
    token: candidate.candidate_attestation,
    identity: identity({ agentPresence: { session_fingerprint: "e".repeat(24), client_type: "chatgpt" } }),
    idempotencyKey: "session-drift-1",
  }), /attestation_binding_mismatch/);

  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => ({}),
    normalizeDirectiveContext: () => normalizedContext({ work_revision: 8 }),
    issueDelegation: async () => ({}),
    authorizeAction: async () => ({}),
  });
  const input = {
    operation: "authorize_action",
    candidate_attestation: candidate.candidate_attestation,
    idempotency_key: "work-drift-1",
    action_request: {
      delegation_id: "hnd_delegation-12345678",
      work_id: WORK_ID,
      intent_anchor_digest: DIGEST_B,
      repository: "owner/repo",
      action: { kind: "github.merge", repository: "owner/repo" },
      evidence_digest: DIGEST_A,
    },
  };
  await assert.rejects(handler(input, identity()), /work_drift/);
  assert.throws(() => attestor.verify({
    token: candidate.candidate_attestation,
    identity: identity(),
    idempotencyKey: "different-replay-key",
  }), /attestation_replayed/);

  const fresh = issueAction(attestor);
  const actionHandler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => ({}),
    normalizeDirectiveContext: () => normalizedContext(),
    issueDelegation: async () => ({}),
    authorizeAction: async () => ({}),
  });
  await assert.rejects(actionHandler({
    ...input,
    candidate_attestation: fresh.candidate_attestation,
    idempotency_key: "substitute-deploy-1",
    action_request: {
      ...input.action_request,
      action: { kind: "render.deploy", repository: "owner/repo" },
    },
  }, identity()), /action_binding_mismatch/);
});

test("requires a fresh owner confirmation to issue the exact bounded delegation", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = issueAction(attestor, "issue_delegation");
  let calls = 0;
  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => ({}),
    normalizeDirectiveContext: () => normalizedContext(),
    issueDelegation: async () => {
      calls += 1;
      return { structuredContent: { delegation: { delegation_id: "hnd_test-12345678" } }, content: [] };
    },
    authorizeAction: async () => ({}),
  });
  const request = {
    operation: "issue_delegation",
    candidate_attestation: candidate.candidate_attestation,
    idempotency_key: "delegation-merge-1",
    owner_confirmed: true,
    delegation_request: {
      work_id: WORK_ID,
      intent_anchor_digest: DIGEST_B,
      repository: "owner/repo",
      audience: ["chatgpt_native"],
      allowed_branches: ["feat/entity-360-v1"],
      protected_branches: ["main"],
      allowed_path_prefixes: ["services"],
      allowed_actions: ["github.merge"],
      ttl_seconds: 300,
    },
  };
  await assert.rejects(handler(request, identity({ ownerConfirmed: false })), /owner_confirmation_required/);
  const response = await handler(request, identity());
  assert.equal(calls, 1);
  assert.equal(response.structuredContent.delegation_issued, true);
  assert.equal(response.structuredContent.execution_authorized, false);
});

test("one signed action attestation cannot change operation across replicas", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const issueAttestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = issueAction(issueAttestor, "issue_delegation");
  let delegationCalls = 0;
  let actionCalls = 0;
  const dependencies = {
    ...bootstrapDependencies,
    readDirectiveContext: async () => ({}),
    normalizeDirectiveContext: () => normalizedContext(),
    issueDelegation: async () => {
      delegationCalls += 1;
      return { structuredContent: { delegation: { delegation_id: "hnd_test-12345678" } } };
    },
    authorizeAction: async () => {
      actionCalls += 1;
      return { structuredContent: { action_ticket: { ticket: {
        ticket_id: `hnt_${"1".repeat(64)}`,
      } } } };
    },
  };
  const issueHandler = createNyraGovernedContinueHandler({
    ...dependencies,
    attestor: issueAttestor,
  });
  const shared = {
    candidate_attestation: candidate.candidate_attestation,
    idempotency_key: "one-continuation-key",
  };
  await issueHandler({
    ...shared,
    operation: "issue_delegation",
    owner_confirmed: true,
    delegation_request: {
      work_id: WORK_ID,
      intent_anchor_digest: DIGEST_B,
      repository: "owner/repo",
      audience: ["chatgpt_native"],
      allowed_branches: ["feat/entity-360-v1"],
      protected_branches: ["main"],
      allowed_path_prefixes: ["services"],
      allowed_actions: ["github.merge"],
      ttl_seconds: 300,
    },
  }, identity());
  const replicaAttestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const replicaHandler = createNyraGovernedContinueHandler({
    ...dependencies,
    attestor: replicaAttestor,
  });
  await assert.rejects(replicaHandler({
    ...shared,
    operation: "authorize_action",
    action_request: {
      delegation_id: "hnd_test-12345678",
      work_id: WORK_ID,
      intent_anchor_digest: DIGEST_B,
      repository: "owner/repo",
      action: { kind: "github.merge", repository: "owner/repo" },
      evidence_digest: DIGEST_A,
    },
  }, identity()), /nyra_governed_continue_operation_mismatch/);
  assert.equal(delegationCalls, 1);
  assert.equal(actionCalls, 0);

  const authorizeCandidate = issueAction(replicaAttestor);
  const restartAttestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const restartHandler = createNyraGovernedContinueHandler({
    ...dependencies,
    attestor: restartAttestor,
  });
  await assert.rejects(restartHandler({
    operation: "issue_delegation",
    candidate_attestation: authorizeCandidate.candidate_attestation,
    idempotency_key: "reverse-operation-key",
    owner_confirmed: true,
    delegation_request: {
      work_id: WORK_ID,
      intent_anchor_digest: DIGEST_B,
      repository: "owner/repo",
      audience: ["chatgpt_native"],
      allowed_branches: ["feat/entity-360-v1"],
      allowed_path_prefixes: ["services"],
      allowed_actions: ["github.merge"],
      ttl_seconds: 300,
    },
  }, identity()), /nyra_governed_continue_operation_mismatch/);
  assert.equal(delegationCalls, 1);
});

test("signed operation binding survives local replay-cache eviction", () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = issueAction(attestor, "issue_delegation");
  attestor.verify({
    token: candidate.candidate_attestation,
    identity: identity(),
    idempotencyKey: "eviction-original-key",
    replayOperation: "issue_delegation",
  });
  for (let index = 0; index < 2_049; index += 1) {
    const filler = issueAction(attestor, "authorize_action");
    attestor.verify({
      token: filler.candidate_attestation,
      identity: identity(),
      idempotencyKey: `eviction-filler-${index}`,
      replayOperation: "authorize_action",
    });
  }
  assert.throws(() => attestor.verify({
    token: candidate.candidate_attestation,
    identity: identity(),
    idempotencyKey: "eviction-opposite-key",
    replayOperation: "authorize_action",
  }), /nyra_governed_continue_operation_mismatch/);
});

test("reviews then creates one exact canonical V2 Work through separate governed phases", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const caller = identity();
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const { directive: candidateDirective } = bootstrapDirective(bootstrapSpec(), caller);
  const candidate = attestor.issue({ identity: caller, directive: candidateDirective });
  assert.equal(candidate.available, true);
  assert.match(candidate.candidate_attestation, /^ngc1\./);
  assert.equal(legacyV1VerifierAccepts(candidate.candidate_attestation), true);
  const legacyBootstrapAttestor = createNyraGovernedContinueAttestor({
    secret: SECRET,
    now: () => clock,
  });
  const legacyBootstrapPayload = legacyBootstrapAttestor.verify({
    token: candidate.candidate_attestation,
    identity: caller,
    idempotencyKey: "legacy-bootstrap-review",
    replayScope: "review_work_bootstrap",
    replayOperation: "review_work_bootstrap",
  });
  assert.equal(legacyBootstrapPayload.candidate_kind, "work_bootstrap");
  assert.equal(legacyBootstrapPayload.continuation_operation, null);
  const calls = [];
  const handler = createNyraGovernedContinueHandler({
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => { throw new Error("bootstrap_must_not_read_unbound_work"); },
    normalizeDirectiveContext: () => { throw new Error("bootstrap_must_not_normalize_unbound_work"); },
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    authorizeAction: async () => { throw new Error("unexpected_action"); },
    reviewWorkBootstrap: async (args) => {
      calls.push({ phase: "review", args });
      return { structuredContent: { ok: true, result: {
        review_id: "22222222-2222-4222-8222-222222222222",
        review_digest: DIGEST_C,
        requires_owner_decision: false,
      } } };
    },
    createWorkBootstrap: async (args) => {
      calls.push({ phase: "create", args });
      return { structuredContent: { ok: true, result: {
        schema_version: "work_continuity_v2",
        work: { work_id: WORK_ID, status: "ACTIVE" },
        legacy_work_id: WORK_ID,
      } } };
    },
  });
  const review = await handler({
    operation: "review_work_bootstrap",
    candidate_attestation: candidate.candidate_attestation,
    work_bootstrap: bootstrapSpec(),
    idempotency_key: "bootstrap-review-001",
  }, caller);
  assert.equal(review.structuredContent.work_bootstrap_reviewed, true);
  assert.equal(review.structuredContent.work_created, false);
  assert.equal(review.structuredContent.host_response_contract.speaker, "Nyra");

  const created = await handler({
    operation: "create_work",
    candidate_attestation: candidate.candidate_attestation,
    work_bootstrap: bootstrapSpec(),
    review_id: "22222222-2222-4222-8222-222222222222",
    review_digest: DIGEST_C,
    owner_confirmed: true,
    confirmation_reference: "owner-confirmed-entity-360",
    idempotency_key: "bootstrap-create-001",
  }, caller);
  assert.deepEqual(calls.map((item) => item.phase), ["review", "create"]);
  assert.equal(calls[1].args.project_id, "project-a");
  assert.equal(calls[1].args.session_id, "chatgpt-session");
  assert.equal(calls[1].args.host_type, "chatgpt_native");
  assert.equal(calls[1].args.visibility_scope, "private");
  assert.equal(calls[1].args.resume_existing, false);
  assert.match(calls[1].args.idempotency_key, /^nyra_cont_/);
  assert.equal(created.structuredContent.work_id, WORK_ID);
  assert.equal(created.structuredContent.work_created, true);
  assert.equal(created.structuredContent.execution_authorized, false);
  assert.equal(created.structuredContent.external_action_authorized, false);
});

test("Nyra bootstrap normalization accepts exact shared text boundaries and rejects every overflow", () => {
  const boundarySpec = bootstrapSpec({
    acceptance_criteria: Array.from({ length: 250 }, (_, index) =>
      boundedUniqueText("acceptance", index, 2_000)),
    constraints: Array.from({ length: 100 }, (_, index) =>
      boundedUniqueText("constraint", index, 1_000)),
  });
  const normalized = normalizeGovernedWorkBootstrapSpec(boundarySpec);
  assert.equal(normalized.acceptance_criteria.length, 250);
  assert.equal(normalized.acceptance_criteria.at(-1).length, 2_000);
  assert.equal(normalized.constraints.length, 100);
  assert.equal(normalized.constraints.at(-1).length, 1_000);
  assert.deepEqual(normalizeGovernedWorkBootstrapSpec(
    bootstrapSpec({ constraints: [] }),
  ).constraints, []);

  const negativeCases = [
    [bootstrapSpec({ acceptance_criteria: [...boundarySpec.acceptance_criteria, "overflow"] }),
      /nyra_work_bootstrap_acceptance_invalid/],
    [bootstrapSpec({ acceptance_criteria: ["x".repeat(2_001)] }),
      /nyra_work_bootstrap_acceptance_invalid/],
    [bootstrapSpec({ constraints: [...boundarySpec.constraints, "overflow"] }),
      /nyra_work_bootstrap_constraints_invalid/],
    [bootstrapSpec({ constraints: ["x".repeat(1_001)] }),
      /nyra_work_bootstrap_constraints_invalid/],
  ];
  for (const [spec, expected] of negativeCases) {
    assert.throws(() => normalizeGovernedWorkBootstrapSpec(spec), expected);
  }
});

test("binds direct bootstrap provenance to the authenticated host and ignores caller assertions", () => {
  const bound = bindWorkBootstrapRequestToAuthenticatedHost({
    identity: identity(),
    request: {
      ...bootstrapSpec(),
      session_id: "forged-session",
      host_type: "future_ai_native",
      client_type: "other",
      agent_id: "forged-agent",
    },
  });
  assert.equal(bound.session_id, "chatgpt-session");
  assert.equal(bound.host_type, "chatgpt_native");
  assert.equal(bound.client_type, "chatgpt");
  assert.equal(bound.agent_id, "chatgpt-agent");
});

test("Nyra reports an exact bootstrap replay without claiming a new Work", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const caller = identity();
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const { directive: candidateDirective } = bootstrapDirective(bootstrapSpec(), caller);
  const candidate = attestor.issue({ identity: caller, directive: candidateDirective });
  const handler = createNyraGovernedContinueHandler({
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => { throw new Error("unexpected_read"); },
    normalizeDirectiveContext: () => { throw new Error("unexpected_normalize"); },
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    authorizeAction: async () => { throw new Error("unexpected_action"); },
    reviewWorkBootstrap: async () => { throw new Error("unexpected_review"); },
    createWorkBootstrap: async () => ({ structuredContent: { ok: true, result: {
      schema_version: "work_continuity_v2",
      work: { work_id: WORK_ID, status: "ACTIVE" },
      legacy_work_id: WORK_ID,
      idempotent_replay: true,
      core_authorization_receipt: null,
    } } }),
  });
  const replay = await handler({
    operation: "create_work",
    candidate_attestation: candidate.candidate_attestation,
    work_bootstrap: bootstrapSpec(),
    review_id: "22222222-2222-4222-8222-222222222222",
    review_digest: DIGEST_C,
    owner_confirmed: true,
    confirmation_reference: "owner-confirmed-replay",
    idempotency_key: "bootstrap-replay-001",
  }, caller);
  assert.equal(replay.structuredContent.work_id, WORK_ID);
  assert.equal(replay.structuredContent.work_created, false);
  assert.equal(replay.structuredContent.work_replayed, true);
  assert.match(replay.structuredContent.host_response_contract.reply_seed, /senza crearne un duplicato/);
});

test("Nyra resumes a Work when the bootstrap review was already consumed", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const caller = identity();
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const { directive: candidateDirective } = bootstrapDirective(bootstrapSpec(), caller);
  const candidate = attestor.issue({ identity: caller, directive: candidateDirective });
  const handler = createNyraGovernedContinueHandler({
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => { throw new Error("unexpected_read"); },
    normalizeDirectiveContext: () => { throw new Error("unexpected_normalize"); },
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    authorizeAction: async () => { throw new Error("unexpected_action"); },
    createWorkBootstrap: async () => { throw new Error("unexpected_create"); },
    reviewWorkBootstrap: async () => ({ structuredContent: { ok: true, result: {
      review_id: "22222222-2222-4222-8222-222222222222",
      review_digest: DIGEST_C,
      consumed: true,
      consumed_work_id: WORK_ID,
      requires_owner_decision: false,
    } } }),
  });
  const replay = await handler({
    operation: "review_work_bootstrap",
    candidate_attestation: candidate.candidate_attestation,
    work_bootstrap: bootstrapSpec(),
    idempotency_key: "bootstrap-review-replay-001",
  }, caller);
  assert.equal(replay.structuredContent.work_id, WORK_ID);
  assert.equal(replay.structuredContent.work_created, false);
  assert.equal(replay.structuredContent.work_replayed, true);
  assert.match(replay.structuredContent.host_response_contract.reply_seed, /già stata consumata/);
  assert.doesNotMatch(replay.structuredContent.host_response_contract.reply_seed, /non è ancora stato creato/);
});

test("fails closed on bootstrap substitution, missing app capability, and missing owner confirmation", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const caller = identity();
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const { directive: candidateDirective } = bootstrapDirective(bootstrapSpec(), caller);
  const candidate = attestor.issue({ identity: caller, directive: candidateDirective });
  const handler = createNyraGovernedContinueHandler({
    ...nativeDependencies,
    attestor,
    readDirectiveContext: async () => ({}),
    normalizeDirectiveContext: () => ({}),
    issueDelegation: async () => ({}),
    authorizeAction: async () => ({}),
    reviewWorkBootstrap: async () => ({ structuredContent: { result: {} } }),
    createWorkBootstrap: async () => ({ structuredContent: { result: {} } }),
  });
  await assert.rejects(handler({
    operation: "review_work_bootstrap",
    candidate_attestation: candidate.candidate_attestation,
    work_bootstrap: bootstrapSpec({ objective: "Substituted objective" }),
    idempotency_key: "bootstrap-substitute-001",
  }, caller), /work_bootstrap_binding_mismatch/);

  const withoutCreate = identity({
    authenticatedHostPrincipal: {
      ...identity().authenticatedHostPrincipal,
      capabilities: [HOST_APP_CAPABILITIES.WORK_READ, HOST_APP_CAPABILITIES.GOVERNED_CONTINUE],
    },
  });
  const unavailable = attestor.issue({ identity: withoutCreate, directive: candidateDirective });
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.reason, "registered_host_work_create_capability_required");

  await assert.rejects(handler({
    operation: "create_work",
    candidate_attestation: candidate.candidate_attestation,
    work_bootstrap: bootstrapSpec(),
    review_id: "22222222-2222-4222-8222-222222222222",
    review_digest: DIGEST_C,
    idempotency_key: "bootstrap-owner-missing-001",
  }, identity({ ownerConfirmed: false })), /owner_confirmation_required/);
});

test("binds Core bootstrap targets to phase, exact request, app, registry and session", () => {
  const caller = identity();
  const request = materializeGovernedWorkBootstrapRequest({
    spec: bootstrapSpec(),
    identity: caller,
    projectId: "project-a",
  });
  const review = governedWorkBootstrapAuthorizationTarget({
    phase: "review",
    request,
    identity: caller,
  });
  const create = governedWorkBootstrapAuthorizationTarget({
    phase: "create",
    request: {
      ...request,
      review_id: "22222222-2222-4222-8222-222222222222",
      review_digest: DIGEST_C,
    },
    identity: caller,
  });
  const substituted = governedWorkBootstrapAuthorizationTarget({
    phase: "review",
    request: { ...request, architecture: { substituted: true } },
    identity: caller,
  });
  const otherApp = governedWorkBootstrapAuthorizationTarget({
    phase: "review",
    request,
    identity: identity({
      authenticatedHostPrincipal: {
        ...caller.authenticatedHostPrincipal,
        app_id: "future_ai",
        host_kind: "future_ai_native",
      },
    }),
  });
  assert.match(review, /^work_bootstrap:review:chatgpt_prod:chatgpt_native:[a-f0-9]{64}$/);
  assert.match(create, /^work_bootstrap:create:chatgpt_prod:chatgpt_native:[a-f0-9]{64}$/);
  assert.notEqual(review, create);
  assert.notEqual(review, substituted);
  assert.notEqual(review, otherApp);
  assert.equal(review.includes("chatgpt-session"), false);
  assert.throws(() => governedWorkBootstrapAuthorizationTarget({
    phase: "create",
    request,
    identity: identity({
      authenticatedHostPrincipal: {
        ...caller.authenticatedHostPrincipal,
        registered: false,
      },
    }),
  }), /registered_host_principal_required/);
});
