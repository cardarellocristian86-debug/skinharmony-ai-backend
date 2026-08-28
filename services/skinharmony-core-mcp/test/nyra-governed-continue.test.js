import assert from "node:assert/strict";
import test from "node:test";

import {
  createNyraGovernedContinueAttestor,
  createNyraGovernedContinueHandler,
} from "../src/nyra-governed-continue.js";
import { HOST_APP_CAPABILITIES } from "../src/host-app-registry.js";
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
const bootstrapDependencies = Object.freeze({
  reviewWorkBootstrap: async () => { throw new Error("unexpected_bootstrap_review"); },
  createWorkBootstrap: async () => { throw new Error("unexpected_bootstrap_create"); },
});

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
      },
    },
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
  const issued = attestor.issue({ identity: identity(), directive: directive() });
  assert.equal(issued.available, true);
  assert.equal(issued.submit_tool, "nyra_governed_continue");
  assert.match(issued.candidate_attestation, /^ngc1\./);
  assert.equal(attestor.issue({
    identity: identity(),
    directive: directive("GIT_COMMIT", "READY_FOR_CORE_REVIEW"),
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
  assert.equal(attestor.issue({ identity: unknown, directive: directive() }).available, false);
  assert.equal(attestor.issue({ identity: identity(), directive: directive("GIT_MERGE", "NEEDS_CONTEXT") }).available, false);
  const futureHost = identity({
    authenticatedHostPrincipal: {
      ...identity().authenticatedHostPrincipal,
      app_id: "future_ai",
      host_kind: "future_ai_native",
    },
  });
  const unsupported = attestor.issue({ identity: futureHost, directive: directive() });
  assert.equal(unsupported.available, false);
  assert.equal(unsupported.reason, "host_native_host_kind_not_supported");
});

test("submits a merge candidate for a Core ticket without reserving or executing it", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = attestor.issue({ identity: identity(), directive: directive() });
  const calls = [];
  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
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
  });
  const calls = [];
  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    attestor,
    readDirectiveContext: async () => ({ raw: true }),
    normalizeDirectiveContext: () => normalizedContext(),
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
      evidence_digest: DIGEST_A,
    },
  }, identity());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action.kind, "git.commit");
  assert.equal(response.structuredContent.ticket_issued, true);
  assert.equal(response.structuredContent.execution_authorized, false);
  assert.equal(response.structuredContent.external_action_authorized, false);
});

test("derives the same downstream idempotency key across process replicas", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const firstAttestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = firstAttestor.issue({ identity: identity(), directive: directive() });
  const downstreamKeys = [];
  const makeHandler = (attestor) => createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
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

test("fails closed on host/session drift, Work drift, replay and action-class substitution", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = attestor.issue({ identity: identity(), directive: directive() });
  assert.throws(() => attestor.verify({
    token: candidate.candidate_attestation,
    identity: identity({ agentPresence: { session_fingerprint: "e".repeat(24), client_type: "chatgpt" } }),
    idempotencyKey: "session-drift-1",
  }), /attestation_binding_mismatch/);

  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
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

  const fresh = attestor.issue({ identity: identity(), directive: directive() });
  const actionHandler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
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
  const candidate = attestor.issue({ identity: identity(), directive: directive() });
  let calls = 0;
  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
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

test("one action attestation cannot issue both a delegation and a ticket", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const candidate = attestor.issue({ identity: identity(), directive: directive() });
  let delegationCalls = 0;
  let actionCalls = 0;
  const handler = createNyraGovernedContinueHandler({
    ...bootstrapDependencies,
    attestor,
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
  });
  const shared = {
    candidate_attestation: candidate.candidate_attestation,
    idempotency_key: "one-continuation-key",
  };
  await handler({
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
  await assert.rejects(handler({
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
  }, identity()), /nyra_governed_continue_attestation_replayed/);
  assert.equal(delegationCalls, 1);
  assert.equal(actionCalls, 0);
});

test("reviews then creates one exact canonical V2 Work through separate governed phases", async () => {
  const clock = Date.parse("2026-08-25T12:00:00.000Z");
  const caller = identity();
  const attestor = createNyraGovernedContinueAttestor({ secret: SECRET, now: () => clock });
  const { directive: candidateDirective } = bootstrapDirective(bootstrapSpec(), caller);
  const candidate = attestor.issue({ identity: caller, directive: candidateDirective });
  assert.equal(candidate.available, true);
  const calls = [];
  const handler = createNyraGovernedContinueHandler({
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
