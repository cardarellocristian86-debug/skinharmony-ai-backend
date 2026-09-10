import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConnectedAiTypedRequest } from "../../shared/connected-ai-typed-request.mjs";
import { createCoreTypedRequestHandler } from "../src/core-typed-request.js";
import { createNyraGovernedContinueHandler } from "../src/nyra-governed-continue.js";

const D = "a".repeat(64);
const identity = { tenantId: "tenant-a", subject: "owner-a", authenticatedHostPrincipal: {
  registered: true, app_id: "codex", host_kind: "codex_native", registry_revision: "r1",
  capabilities: ["governed_continue", "work.create", "host_native.delegate", "host_native.authorize"],
}, agentPresence: { session_fingerprint: "b".repeat(64) } };

test("shared typed contract rejects lexical and unknown operations", () => {
  assert.throws(() => normalizeConnectedAiTypedRequest({ schema_version: "connected_ai_typed_request_v1",
    operation: "CHAT", request: {} }), /connected_ai_typed_request_invalid/);
});

test("core_typed_request authorizes the exact operation capability without governed_continue", async () => {
  const handler = createCoreTypedRequestHandler({
    store: { recordConnectedAiTypedRequest: async () => ({
      canonical_request_ref: `cair1_${"c".repeat(40)}`, continuation_ref: `nyc1_${"d".repeat(40)}`,
      expires_at: "2030-01-01T00:00:00.000Z",
    }) },
    issueDelegation: async () => assert.fail("wrong_route"),
    authorizeAction: async () => assert.fail("wrong_route"),
    reviewWorkBootstrap: async () => ({ structuredContent: { ok: true, tenant_id: "tenant-a",
      result: { review_id: "review-1" } } }),
    resolveWorkBinding: async () => assert.fail("wrong_route"),
  });
  const workCreateOnly = { ...identity, authenticatedHostPrincipal: {
    ...identity.authenticatedHostPrincipal, capabilities: ["work.create"],
  } };
  const response = await handler({ schema_version: "connected_ai_typed_request_v1",
    operation: "WORK_CREATE_OR_RECONCILE", request: { create_request: {
      project_id: "project-a", request_id: "request-capability", work_name: "Work",
      work_type: "software_git", idea: "Idea", objective: "Objective", architecture: {},
      next_action: "Review", acceptance_criteria: ["Pass"], constraints: [],
      tasks: [{ title: "Build", weight: 1, required: true }], parent_work_id: null,
      idempotency_key: "bootstrap-capability",
    }, idempotency_key: "typed-capability" } }, workCreateOnly);
  assert.equal(response.structuredContent.requester, "AI_HOST");
});

test("core_typed_request persists an opaque server-owned Core result", async () => {
  let persisted;
  const handler = createCoreTypedRequestHandler({
    store: { recordConnectedAiTypedRequest: async (value) => (persisted = value, {
      canonical_request_ref: `cair1_${"c".repeat(40)}`, continuation_ref: `nyc1_${"d".repeat(40)}`,
      expires_at: "2030-01-01T00:00:00.000Z",
    }) },
    issueDelegation: async () => ({ structuredContent: { ok: true, tenant_id: "tenant-a",
      delegation: { delegation_id: "secret-server-result" } } }),
    authorizeAction: async () => { throw new Error("wrong_route"); },
    reviewWorkBootstrap: async () => { throw new Error("wrong_route"); },
    resolveWorkBinding: async (work_id) => ({ work_id, intent_digest: D }),
  });
  const result = await handler({ schema_version: "connected_ai_typed_request_v1",
    operation: "DELEGATION_REQUEST", request: { work_id: "11111111-1111-4111-8111-111111111111",
      repository: "owner/repo", audience: ["agent-a"], allowed_branches: ["feature/x"],
      protected_branches: [], allowed_path_prefixes: ["services/"],
      allowed_actions: ["git.commit"], ttl_seconds: 300, idempotency_key: "typed-test-1" } }, identity);
  assert.equal(result.structuredContent.authority, "UNIVERSAL_CORE");
  assert.equal(result.structuredContent.requester, "AI_HOST");
  assert.equal(JSON.stringify(result).includes("secret-server-result"), false);
  assert.equal(persisted.core_result.delegation.delegation_id, "secret-server-result");
});

test("core_typed_request fails closed for mismatched Core tenant", async () => {
  const handler = createCoreTypedRequestHandler({
    store: { recordConnectedAiTypedRequest: async () => assert.fail("must not persist") },
    issueDelegation: async () => ({ structuredContent: { ok: true, tenant_id: "other" } }),
    authorizeAction: async () => ({ structuredContent: { ok: true, tenant_id: "other" } }),
    reviewWorkBootstrap: async () => ({ structuredContent: { ok: true, tenant_id: "other" } }),
    resolveWorkBinding: async (work_id) => ({ work_id, intent_digest: D }),
  });
  await assert.rejects(handler({ schema_version: "connected_ai_typed_request_v1",
    operation: "ACTION_TICKET_REQUEST", request: { work_id: "11111111-1111-4111-8111-111111111111",
      delegation_id: "hnd_x", repository: "owner/repo", action: { kind: "git.commit" },
      evidence_digest: D, idempotency_key: "typed-test-2" } }, identity),
  /core_typed_request_core_result_invalid/);
});

test("WORK_CREATE_OR_RECONCILE reaches Core review without host provenance fields", async () => {
  let reviewed;
  const handler = createCoreTypedRequestHandler({
    store: { recordConnectedAiTypedRequest: async () => ({
      canonical_request_ref: `cair1_${"e".repeat(40)}`, continuation_ref: `nyc1_${"f".repeat(40)}`,
      expires_at: "2030-01-01T00:00:00.000Z",
    }) }, issueDelegation: async () => assert.fail(), authorizeAction: async () => assert.fail(),
    resolveWorkBinding: async () => assert.fail(),
    reviewWorkBootstrap: async (request) => (reviewed = request,
      { structuredContent: { ok: true, tenant_id: "tenant-a", result: { review_id: "review-1" } } }),
  });
  const create_request = { project_id: "project-a", request_id: "request-a", work_name: "Work",
    work_type: "software_git", idea: "Idea", objective: "Objective", architecture: {},
    next_action: "Review", acceptance_criteria: ["Pass"], constraints: [],
    tasks: [{ title: "Build", weight: 1, required: true }], parent_work_id: null,
    idempotency_key: "bootstrap-request-a" };
  const response = await handler({ schema_version: "connected_ai_typed_request_v1",
    operation: "WORK_CREATE_OR_RECONCILE", request: { create_request,
      idempotency_key: "typed-bootstrap-a" } }, identity);
  assert.deepEqual(reviewed.create_request, create_request);
  assert.match(response.structuredContent.continuation_ref, /^nyc1_/);
});

test("typed bootstrap continues through create_work and replays the server-owned specification", async () => {
  const spec = { project_id: "project-a", request_id: "request-a", work_name: "Work",
    work_type: "software_git", idea: "Idea", objective: "Objective", architecture: {},
    next_action: "Review", acceptance_criteria: ["Pass"], constraints: [],
    tasks: [{ title: "Build", weight: 1, required: true }], parent_work_id: null };
  const review_digest = "9".repeat(64);
  let creates = 0;
  let final_result = null;
  const store = {
    claim: async () => assert.fail("legacy claim must not run"), complete: async () => {},
    readCompletedOperation: async () => {},
    consumeConnectedAiTypedRequest: async () => ({ operation: "WORK_CREATE_OR_RECONCILE",
      canonical_request: { request: { create_request: spec } },
      core_result: { result: { review_id: "review-a", review_digest } },
      replay: final_result !== null, final_result,
      server_idempotency_key: "core_typed_stable_idempotency" }),
    completeConnectedAiTypedRequest: async ({ final_result: value }) => { final_result = value; },
    releaseConnectedAiTypedRequest: async () => {},
  };
  const continueHandler = createNyraGovernedContinueHandler({ store,
    readDirectiveContext: async () => ({}), normalizeDirectiveContext: () => ({}),
    issueDelegation: async () => {}, authorizeAction: async () => {},
    reviewWorkBootstrap: async () => {},
    createWorkBootstrap: async (request) => ({ structuredContent: { ok: true,
      result: { work_id: "11111111-1111-4111-8111-111111111111", replay: creates++ > 0,
        request_id: request.request_id } } }),
  });
  const owner = { ...identity, ownerConfirmed: true };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await continueHandler({ operation: "create_work",
      continuation_ref: `nyc1_${"g".repeat(40)}`, idempotency_key: "typed-create-replay",
      owner_confirmed: true, confirmation_reference: "owner-confirmed-bootstrap" }, owner);
    assert.equal(result.structuredContent.result.work_id, "11111111-1111-4111-8111-111111111111");
  }
  assert.equal(creates, 1);
});

test("typed continuation exposes only opaque orchestration refs", async () => {
  const store = {
    claim: async () => assert.fail("legacy claim must not run"), complete: async () => {},
    readCompletedOperation: async () => {},
    consumeConnectedAiTypedRequest: async () => ({ operation: "DELEGATION_REQUEST",
      canonical_request_ref: `cair1_${"h".repeat(40)}`,
      continuation_ref: `nyc1_${"i".repeat(40)}`,
      canonical_request: { secret_internal_spec: true },
      core_result: { delegation: { delegation_id: "hnd_safe_reference",
        signature: "must-not-leak" }, internal_receipt: "must-not-leak" }, replay: false }),
    completeConnectedAiTypedRequest: async () => {}, releaseConnectedAiTypedRequest: async () => {},
  };
  const handler = createNyraGovernedContinueHandler({ store,
    readDirectiveContext: async () => ({}), normalizeDirectiveContext: () => ({}),
    issueDelegation: async () => {}, authorizeAction: async () => {},
    reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
  });
  const response = await handler({ operation: "consume_core_typed_request",
    continuation_ref: `nyc1_${"i".repeat(40)}`, idempotency_key: "consume-safe-ref" }, identity);
  assert.equal(response.structuredContent.orchestration_refs.delegation_id, "hnd_safe_reference");
  assert.equal(JSON.stringify(response).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(response).includes("secret_internal_spec"), false);
});

test("typed Work creation releases its claim after a downstream failure", async () => {
  let releases = 0;
  const store = {
    claim: async () => assert.fail("legacy claim must not run"), complete: async () => {},
    readCompletedOperation: async () => {},
    consumeConnectedAiTypedRequest: async () => ({ operation: "WORK_CREATE_OR_RECONCILE",
      canonical_request: { request: { create_request: { request_id: "request-a" } } },
      core_result: { result: { review_id: "review-a", review_digest: "9".repeat(64) } },
      replay: false, server_idempotency_key: "core_typed_stable_idempotency" }),
    completeConnectedAiTypedRequest: async () => assert.fail("must not complete"),
    releaseConnectedAiTypedRequest: async () => { releases += 1; },
  };
  const handler = createNyraGovernedContinueHandler({ store,
    readDirectiveContext: async () => ({}), normalizeDirectiveContext: () => ({}),
    issueDelegation: async () => {}, authorizeAction: async () => {},
    reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => { throw new Error("transient"); },
  });
  await assert.rejects(handler({ operation: "create_work",
    continuation_ref: `nyc1_${"j".repeat(40)}`, idempotency_key: "typed-create-failure",
    owner_confirmed: true, confirmation_reference: "owner-confirmed-bootstrap" },
  { ...identity, ownerConfirmed: true }), /transient/);
  assert.equal(releases, 1);
});
