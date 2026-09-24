import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConnectedAiTypedRequest } from "../../shared/connected-ai-typed-request.mjs";
import {
  canonicalWorkBindingFromDirectiveContext,
  createCoreTypedRequestHandler,
} from "../src/core-typed-request.js";
import { createNyraGovernedContinueHandler } from "../src/nyra-governed-continue.js";
import { createNyraGovernedContinuationStore } from "../src/nyra-governed-continuation-store.js";
import { TOOLS } from "../src/tool-definitions.js";

const D = "a".repeat(64);
const delegationGovernance = {
  budget: {
    max_agents: 1, max_parallel: 1, max_commits: 1, max_pushes: 1,
    max_deploys: 1, max_total_actions: 1,
  },
  release_policy: {
    manifest_required_for_protected_push: true,
    manifest_required_for_induced_deploy: true,
    manifest_required_for_deploy: true,
    independent_verifier_required: true,
    rollback_required: true,
    required_checks: ["core-mcp"],
  },
};
const identity = { tenantId: "tenant-a", subject: "owner-a", authenticatedHostPrincipal: {
  registered: true, app_id: "codex", host_kind: "codex_native", registry_revision: "r1",
  capabilities: ["governed_continue", "work.create", "host_native.delegate", "host_native.authorize"],
}, agentPresence: { session_fingerprint: "b".repeat(64) } };

function typedRequestStorePool() {
  let row = null;
  const exactBinding = (parameters) => row &&
    row.tenant_id === parameters[0] && row.continuation_ref === parameters[1] &&
    row.app_id === parameters[2] && row.host_kind === parameters[3] &&
    row.host_registry_revision === parameters[4] && row.subject_digest === parameters[5] &&
    row.session_fingerprint === parameters[6];
  return {
    get row() { return row; },
    async query(statement, parameters = []) {
      const sql = String(statement);
      if (sql.includes("to_regclass")) return { rows: [{
        continuation_table: true, operation_table: true, open_index: true,
        operation_index: true, typed_request_table: true,
        core_verdict_column: true, bootstrap_request_column: true,
      }] };
      if (sql.includes("CREATE TABLE IF NOT EXISTS")) return { rows: [] };
      if (sql.includes("INSERT INTO connected_ai_typed_request")) {
        row = {
          tenant_id: parameters[0], canonical_request_ref: parameters[1],
          continuation_ref: parameters[2], app_id: parameters[3], host_kind: parameters[4],
          host_registry_revision: parameters[5], subject_digest: parameters[6],
          session_fingerprint: parameters[7], operation: parameters[8],
          request_digest: parameters[9], canonical_request: JSON.parse(parameters[10]),
          core_result: JSON.parse(parameters[11]), record_digest: parameters[12],
          issued_at: new Date(parameters[13]), expires_at: new Date(parameters[14]),
          state: "READY", final_result: null, final_result_signature: null,
          claim_started_at: null,
        };
        return { rows: [{
          canonical_request_ref: row.canonical_request_ref,
          continuation_ref: row.continuation_ref,
          operation: row.operation,
          request_digest: row.request_digest,
          state: row.state,
          issued_at: row.issued_at,
          expires_at: row.expires_at,
        }] };
      }
      if (sql.includes("SELECT * FROM connected_ai_typed_request")) {
        return { rows: row && row.tenant_id === parameters[0] &&
          row.continuation_ref === parameters[1] ? [row] : [] };
      }
      if (sql.includes("SET state='READY',claim_started_at=NULL") && parameters.length === 2) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("SET state='IN_PROGRESS',claim_started_at=clock_timestamp()")) {
        if (!row || row.tenant_id !== parameters[0] || row.continuation_ref !== parameters[1] ||
            row.state !== "READY") return { rowCount: 0, rows: [] };
        row = { ...row, state: "IN_PROGRESS", claim_started_at: new Date() };
        return { rowCount: 1, rows: [row] };
      }
      if (sql.includes("SELECT request_digest FROM connected_ai_typed_request")) {
        return { rows: exactBinding(parameters) && row.state === "IN_PROGRESS"
          ? [{ request_digest: row.request_digest }] : [] };
      }
      if (sql.includes("SET state='CONSUMED',final_result=")) {
        if (!exactBinding(parameters) || row.state !== "IN_PROGRESS") {
          return { rowCount: 0, rows: [] };
        }
        row = { ...row, state: "CONSUMED", final_result: JSON.parse(parameters[7]),
          final_result_signature: parameters[8], claim_started_at: null };
        return { rowCount: 1, rows: [{ final_result: row.final_result }] };
      }
      if (sql.includes("SET state='READY',claim_started_at=NULL")) {
        if (!exactBinding(parameters) || row.state !== "IN_PROGRESS") {
          return { rowCount: 0, rows: [] };
        }
        row = { ...row, state: "READY", claim_started_at: null };
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected_typed_store_sql:${sql.slice(0, 80)}`);
    },
  };
}

test("shared typed contract rejects lexical and unknown operations", () => {
  assert.throws(() => normalizeConnectedAiTypedRequest({ schema_version: "connected_ai_typed_request_v1",
    operation: "CHAT", request: {} }), /connected_ai_typed_request_invalid/);
});

test("published typed delegation schema matches the shared Core boundary", () => {
  const schema = TOOLS.find((tool) => tool.name === "core_typed_request").inputSchema;
  const delegation = schema.properties.request.oneOf.find((candidate) =>
    candidate.required.includes("release_policy"));
  assert.equal(delegation.properties.ttl_seconds.maximum, 3_600);
  assert.equal(delegation.properties.allowed_branches.maxItems, 30);
  assert.equal(delegation.properties.protected_branches.minItems, 1);
  assert.equal(delegation.properties.allowed_actions.maxItems, 50);
  assert.deepEqual([...delegation.properties.budget.required].sort(),
    Object.keys(delegationGovernance.budget).sort());
  assert.deepEqual([...delegation.properties.release_policy.required].sort(),
    Object.keys(delegationGovernance.release_policy).sort());
});

test("extracts the exact canonical Work binding from a V2 directive envelope", () => {
  const work = {
    work_id: "11111111-1111-4111-8111-111111111111",
    intent_digest: D,
  };
  assert.deepEqual(canonicalWorkBindingFromDirectiveContext({
    schema_version: "nyra_directive_context_v2",
    work,
    work_id: "22222222-2222-4222-8222-222222222222",
    intent_digest: "f".repeat(64),
  }), work);
  assert.deepEqual(canonicalWorkBindingFromDirectiveContext({
    schema_version: "nyra_directive_context_v2",
  }), { work_id: undefined, intent_digest: undefined });
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
  let issued;
  const handler = createCoreTypedRequestHandler({
    store: { recordConnectedAiTypedRequest: async (value) => (persisted = value, {
      canonical_request_ref: `cair1_${"c".repeat(40)}`, continuation_ref: `nyc1_${"d".repeat(40)}`,
      expires_at: "2030-01-01T00:00:00.000Z",
    }) },
    issueDelegation: async (request) => (issued = request,
      { structuredContent: { ok: true, tenant_id: "tenant-a",
        delegation: { delegation_id: "secret-server-result" } } }),
    authorizeAction: async () => { throw new Error("wrong_route"); },
    reviewWorkBootstrap: async () => { throw new Error("wrong_route"); },
    resolveWorkBinding: async (work_id) => ({ work_id, intent_digest: D }),
  });
  const result = await handler({ schema_version: "connected_ai_typed_request_v1",
    operation: "DELEGATION_REQUEST", request: { work_id: "11111111-1111-4111-8111-111111111111",
      repository: "owner/repo", audience: ["agent-a"], allowed_branches: ["feature/x"],
      protected_branches: ["main"], allowed_path_prefixes: ["services/"],
      allowed_actions: ["git.commit"], ...delegationGovernance,
      ttl_seconds: 300, idempotency_key: "typed-test-1" } }, identity);
  assert.equal(result.structuredContent.authority, "UNIVERSAL_CORE");
  assert.equal(result.structuredContent.requester, "AI_HOST");
  assert.equal(JSON.stringify(result).includes("secret-server-result"), false);
  assert.equal(persisted.core_result.delegation.delegation_id, "secret-server-result");
  assert.deepEqual(issued.budget, delegationGovernance.budget);
  assert.deepEqual(issued.release_policy, delegationGovernance.release_policy);
  assert.equal(issued.intent_anchor_digest, D);
});

test("typed delegation fails before Core when budget or release policy is omitted", async () => {
  const base = { schema_version: "connected_ai_typed_request_v1",
    operation: "DELEGATION_REQUEST", request: {
      work_id: "11111111-1111-4111-8111-111111111111", repository: "owner/repo",
      audience: ["codex_native"], allowed_branches: ["feature/x"], protected_branches: ["main"],
      allowed_path_prefixes: ["services/"], allowed_actions: ["git.commit"],
      ttl_seconds: 300, idempotency_key: "typed-missing-governance",
    } };
  assert.throws(() => normalizeConnectedAiTypedRequest(base),
    /connected_ai_delegation_request_invalid/);
  assert.throws(() => normalizeConnectedAiTypedRequest({
    ...base, request: { ...base.request, budget: delegationGovernance.budget },
  }), /connected_ai_delegation_request_invalid/);
  assert.throws(() => normalizeConnectedAiTypedRequest({
    ...base, request: { ...base.request, ...delegationGovernance,
      budget: { ...delegationGovernance.budget, max_pushes: 0 } },
  }), /connected_ai_delegation_request_invalid/);
  assert.throws(() => normalizeConnectedAiTypedRequest({
    ...base, request: { ...base.request, ...delegationGovernance,
      release_policy: { ...delegationGovernance.release_policy,
        independent_verifier_required: "yes" } },
  }), /connected_ai_delegation_request_invalid/);
});

test("typed delegation rejects contract drift before Work lookup or Core", async () => {
  let downstreamCalls = 0;
  const handler = createCoreTypedRequestHandler({
    store: { recordConnectedAiTypedRequest: async () => { downstreamCalls += 1; } },
    issueDelegation: async () => { downstreamCalls += 1; },
    authorizeAction: async () => { downstreamCalls += 1; },
    reviewWorkBootstrap: async () => { downstreamCalls += 1; },
    resolveWorkBinding: async () => { downstreamCalls += 1; },
  });
  const valid = {
    schema_version: "connected_ai_typed_request_v1", operation: "DELEGATION_REQUEST",
    request: {
      work_id: "11111111-1111-4111-8111-111111111111", repository: "owner/repo",
      audience: ["codex_native"], allowed_branches: ["feature/x"],
      protected_branches: ["main"], allowed_path_prefixes: ["services/"],
      allowed_actions: ["git.commit"], ...delegationGovernance,
      ttl_seconds: 300, idempotency_key: "typed-contract-drift",
    },
  };
  const invalidRequests = [
    { ...valid.request, ttl_seconds: 3_601 },
    { ...valid.request, allowed_branches: Array.from({ length: 31 }, (_, i) => `branch-${i}`) },
    { ...valid.request, allowed_actions: Array.from({ length: 51 }, (_, i) => `action.${i}`) },
    { ...valid.request, allowed_path_prefixes: "services/" },
    { ...valid.request, protected_branches: ["main", " main "] },
    { ...valid.request, audience: [" codex_native "] },
    { ...valid.request, allowed_actions: [" git.commit "] },
    { ...valid.request, release_policy: { ...valid.request.release_policy,
      required_checks: [" core-mcp "] } },
    { ...valid.request, release_policy: { ...valid.request.release_policy,
      required_checks: ["core-mcp", "core-mcp"] } },
    { ...valid.request, release_policy: { ...valid.request.release_policy,
      required_checks: ["x".repeat(241)] } },
    { ...valid.request, unexpected_client_field: true },
  ];
  for (const request of invalidRequests) {
    await assert.rejects(handler({ ...valid, request }, identity),
      /connected_ai_delegation_request_invalid/);
  }
  assert.equal(downstreamCalls, 0);
});

test("core_typed_request fails closed for mismatched Core tenant", async () => {
  let released = false;
  const handler = createCoreTypedRequestHandler({
    store: {
      recordConnectedAiTypedRequest: async () => ({
        canonical_request_ref: `cair1_${"c".repeat(40)}`,
        continuation_ref: `nyc1_${"d".repeat(40)}`,
        expires_at: "2030-01-01T00:00:00.000Z",
      }),
      consumeConnectedAiTypedRequest: async () => ({
        continuation_ref: `nyc1_${"d".repeat(40)}`, request_digest: D,
        server_idempotency_key: "server-action-tenant", issued_at: new Date().toISOString(),
        replay: false,
      }),
      completeConnectedAiTypedRequest: async () => assert.fail("must not complete"),
      releaseConnectedAiTypedRequest: async () => { released = true; },
    },
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
  assert.equal(released, true);
});

test("typed action persists a server-owned pending record and exact replay does not reauthorize", async () => {
  const continuation_ref = `nyc1_${"e".repeat(40)}`;
  let finalResult = null;
  let authorizeCalls = 0;
  let pendingRecord;
  const store = {
    recordConnectedAiTypedRequest: async (input) => {
      pendingRecord ||= input;
      return { canonical_request_ref: `cair1_${"f".repeat(40)}`,
        continuation_ref, expires_at: "2030-01-01T00:00:00.000Z" };
    },
    consumeConnectedAiTypedRequest: async () => ({
      continuation_ref, request_digest: D, server_idempotency_key: "server-action-replay",
      issued_at: new Date().toISOString(), replay: finalResult !== null, final_result: finalResult,
    }),
    completeConnectedAiTypedRequest: async ({ final_result }) => { finalResult = final_result; },
    releaseConnectedAiTypedRequest: async () => assert.fail("must not release"),
  };
  const handler = createCoreTypedRequestHandler({
    store,
    issueDelegation: async () => assert.fail("wrong_route"),
    reviewWorkBootstrap: async () => assert.fail("wrong_route"),
    resolveWorkBinding: async (work_id) => ({ work_id, intent_digest: D,
      directive_context: { available: true } }),
    authorizeAction: async (request, _identity, context) => {
      authorizeCalls += 1;
      assert.equal(context.typed_record.continuation_ref, continuation_ref);
      assert.equal(context.work_binding.intent_digest, D);
      assert.equal(request.intent_anchor_digest, D);
      return { structuredContent: { ok: true, tenant_id: "tenant-a",
        action_ticket: { ticket: { ticket_id: "hnt_server_owned" } } } };
    },
  });
  const input = { schema_version: "connected_ai_typed_request_v1",
    operation: "ACTION_TICKET_REQUEST", request: {
      work_id: "11111111-1111-4111-8111-111111111111", delegation_id: "hnd_x",
      repository: "owner/repo", action: { kind: "git.commit", repository: "owner/repo" },
      evidence_digest: D, idempotency_key: "typed-action-replay",
    } };
  const first = await handler(input, identity);
  const replay = await handler(input, identity);
  assert.equal(authorizeCalls, 1);
  assert.equal(first.structuredContent.continuation_ref, continuation_ref);
  assert.equal(replay.structuredContent.continuation_ref, continuation_ref);
  assert.equal(pendingRecord.core_result.schema_version, "connected_ai_core_pending_v1");
  assert.equal(pendingRecord.core_result.state, "PENDING");
});

test("typed action releases the pending record when authorization fails", async () => {
  let released = 0;
  const handler = createCoreTypedRequestHandler({
    store: {
      recordConnectedAiTypedRequest: async () => ({
        canonical_request_ref: `cair1_${"a".repeat(40)}`,
        continuation_ref: `nyc1_${"b".repeat(40)}`,
        expires_at: "2030-01-01T00:00:00.000Z",
      }),
      consumeConnectedAiTypedRequest: async () => ({
        continuation_ref: `nyc1_${"b".repeat(40)}`, request_digest: D,
        server_idempotency_key: "server-action-failure", issued_at: new Date().toISOString(),
        replay: false,
      }),
      completeConnectedAiTypedRequest: async () => assert.fail("must not complete"),
      releaseConnectedAiTypedRequest: async () => { released += 1; },
    },
    issueDelegation: async () => assert.fail("wrong_route"),
    reviewWorkBootstrap: async () => assert.fail("wrong_route"),
    resolveWorkBinding: async (work_id) => ({ work_id, intent_digest: D }),
    authorizeAction: async () => { throw Object.assign(new Error("core_denied"), { status: 403 }); },
  });
  await assert.rejects(handler({ schema_version: "connected_ai_typed_request_v1",
    operation: "ACTION_TICKET_REQUEST", request: {
      work_id: "11111111-1111-4111-8111-111111111111", delegation_id: "hnd_x",
      repository: "owner/repo", action: { kind: "git.commit", repository: "owner/repo" },
      evidence_digest: D, idempotency_key: "typed-action-failure",
    } }, identity), /core_denied/);
  assert.equal(released, 1);
});

test("Nyra refuses to expose a pending typed Core request", async () => {
  let released = 0;
  const store = {
    claim: async () => assert.fail("legacy claim must not run"), complete: async () => {},
    readCompletedOperation: async () => {},
    consumeConnectedAiTypedRequest: async () => ({
      operation: "ACTION_TICKET_REQUEST", replay: false,
      core_result: { schema_version: "connected_ai_core_pending_v1", state: "PENDING" },
    }),
    completeConnectedAiTypedRequest: async () => assert.fail("must not complete"),
    releaseConnectedAiTypedRequest: async () => { released += 1; },
  };
  const handler = createNyraGovernedContinueHandler({ store,
    readDirectiveContext: async () => ({}), normalizeDirectiveContext: () => ({}),
    issueDelegation: async () => {}, authorizeAction: async () => {},
    reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
  });
  await assert.rejects(handler({ operation: "consume_core_typed_request",
    continuation_ref: `nyc1_${"c".repeat(40)}`, idempotency_key: "pending-consume" }, identity),
  /connected_ai_core_request_pending/);
  assert.equal(released, 1);
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

test("typed bootstrap review reads the immutable Core result before owner-confirmed create", async () => {
  const spec = { project_id: "project-a", request_id: "request-a", work_name: "Work",
    work_type: "software_git", idea: "Idea", objective: "Objective", architecture: {},
    next_action: "Review", acceptance_criteria: ["Pass"], constraints: [],
    tasks: [{ title: "Build", weight: 1, required: true }], parent_work_id: null };
  const review = { review_id: "review-a", review_digest: "9".repeat(64),
    requires_owner_decision: false };
  let releases = 0;
  let creates = 0;
  const store = {
    claim: async () => assert.fail("legacy claim must not run"), complete: async () => {},
    readCompletedOperation: async () => {},
    consumeConnectedAiTypedRequest: async () => ({
      tenant_id: "tenant-a", operation: "WORK_CREATE_OR_RECONCILE",
      continuation_ref: `nyc1_${"r".repeat(40)}`,
      canonical_request: { request: { create_request: spec } },
      core_result: { ok: true, tenant_id: "tenant-a", result: review },
      replay: false, server_idempotency_key: "core_typed_stable_idempotency",
    }),
    completeConnectedAiTypedRequest: async () => {},
    releaseConnectedAiTypedRequest: async () => { releases += 1; },
  };
  const handler = createNyraGovernedContinueHandler({ store,
    readDirectiveContext: async () => ({}), normalizeDirectiveContext: () => ({}),
    issueDelegation: async () => {}, authorizeAction: async () => {},
    reviewWorkBootstrap: async () => assert.fail("Core review must not be recomputed"),
    createWorkBootstrap: async (request) => {
      creates += 1;
      assert.equal(request.review_id, review.review_id);
      assert.equal(request.review_digest, review.review_digest);
      assert.equal(request.objective, spec.objective);
      return { structuredContent: { ok: true, result: {
        work: { work_id: "11111111-1111-4111-8111-111111111111" },
      } } };
    },
  });
  const continuation_ref = `nyc1_${"r".repeat(40)}`;
  const reviewed = await handler({ operation: "review_work_bootstrap", continuation_ref,
    idempotency_key: "typed-review-replay" }, identity);
  assert.equal(reviewed.structuredContent.work_bootstrap_reviewed, true);
  assert.equal(reviewed.structuredContent.review_id, review.review_id);
  assert.equal(releases, 1);
  assert.equal(creates, 0);

  const created = await handler({ operation: "create_work", continuation_ref,
    idempotency_key: "typed-create-after-review", owner_confirmed: true,
    confirmation_reference: "owner-confirmed-bootstrap" }, { ...identity, ownerConfirmed: true });
  assert.equal(created.structuredContent.result.work.work_id,
    "11111111-1111-4111-8111-111111111111");
  assert.equal(creates, 1);
});

test("typed bootstrap crosses the signed store for review, create, replay and exact identity binding", async () => {
  const pool = typedRequestStorePool();
  const store = createNyraGovernedContinuationStore({
    pool,
    signingSecret: "typed-bootstrap-integration-secret-0123456789abcdef",
    now: () => Date.parse("2026-09-24T18:00:00.000Z"),
  });
  await store.initialize();
  const spec = { project_id: "project-a", request_id: "request-signed-store",
    work_name: "Signed typed bootstrap", work_type: "software_git", idea: "Idea",
    objective: "Create exactly one Work from the immutable typed record", architecture: {},
    next_action: "Review", acceptance_criteria: ["Pass"], constraints: [],
    tasks: [{ title: "Build", weight: 1, required: true }], parent_work_id: null };
  const review = { review_id: "review-signed-store", review_digest: "9".repeat(64),
    requires_owner_decision: false };
  let reviewCalls = 0;
  let createCalls = 0;
  const issue = createCoreTypedRequestHandler({
    store,
    issueDelegation: async () => assert.fail("wrong route"),
    authorizeAction: async () => assert.fail("wrong route"),
    resolveWorkBinding: async () => assert.fail("wrong route"),
    reviewWorkBootstrap: async () => {
      reviewCalls += 1;
      return { structuredContent: { ok: true, tenant_id: identity.tenantId, result: review } };
    },
  });
  const continuation = createNyraGovernedContinueHandler({
    store,
    readDirectiveContext: async () => ({}), normalizeDirectiveContext: () => ({}),
    issueDelegation: async () => assert.fail("wrong route"),
    authorizeAction: async () => assert.fail("wrong route"),
    reviewWorkBootstrap: async () => assert.fail("review must come from the signed record"),
    createWorkBootstrap: async (request) => {
      createCalls += 1;
      assert.equal(request.objective, spec.objective);
      assert.equal(request.review_id, review.review_id);
      assert.equal(request.review_digest, review.review_digest);
      assert.match(request.idempotency_key, /^work_bootstrap_[a-f0-9]{48}$/);
      return { structuredContent: { ok: true, tenant_id: identity.tenantId, result: {
        work: { work_id: "11111111-1111-4111-8111-111111111111" },
        idempotent_replay: false,
      } }, content: [] };
    },
  });
  const issued = await issue({ schema_version: "connected_ai_typed_request_v1",
    operation: "WORK_CREATE_OR_RECONCILE", request: {
      create_request: spec, idempotency_key: "typed-signed-store-issue",
    } }, identity);
  const continuationRef = issued.structuredContent.continuation_ref;
  assert.match(continuationRef, /^nyc1_/);
  assert.equal(reviewCalls, 1);
  assert.equal(pool.row.state, "READY");

  const mismatchIdentities = [
    { ...identity, tenantId: "tenant-b" },
    { ...identity, subject: "owner-b" },
    { ...identity, authenticatedHostPrincipal: { ...identity.authenticatedHostPrincipal,
      app_id: "chatgpt" } },
    { ...identity, authenticatedHostPrincipal: { ...identity.authenticatedHostPrincipal,
      host_kind: "chatgpt_native" } },
    { ...identity, authenticatedHostPrincipal: { ...identity.authenticatedHostPrincipal,
      registry_revision: "r2" } },
    { ...identity, agentPresence: { session_fingerprint: "c".repeat(64) } },
  ];
  for (const mismatched of mismatchIdentities) {
    await assert.rejects(store.consumeConnectedAiTypedRequest({
      identity: mismatched, continuation_ref: continuationRef,
    }), /connected_ai_continuation_binding_mismatch/);
    assert.equal(pool.row.state, "READY");
  }

  const reviewed = await continuation({ operation: "review_work_bootstrap",
    continuation_ref: continuationRef, idempotency_key: "typed-signed-store-review" },
  structuredClone(identity));
  assert.equal(reviewed.structuredContent.work_bootstrap_reviewed, true);
  assert.equal(reviewed.structuredContent.review_id, review.review_id);
  assert.equal(pool.row.state, "READY");

  const owner = { ...structuredClone(identity), ownerConfirmed: true };
  const createArgs = { operation: "create_work", continuation_ref: continuationRef,
    idempotency_key: "typed-signed-store-create", owner_confirmed: true,
    confirmation_reference: "owner-confirmed-signed-store" };
  const created = await continuation(createArgs, owner);
  const replayed = await continuation(createArgs, owner);
  assert.equal(created.structuredContent.result.work.work_id,
    "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(replayed, created);
  assert.equal(pool.row.state, "CONSUMED");
  assert.equal(reviewCalls, 1);
  assert.equal(createCalls, 1);
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

test("fresh typed continuations derive one Work key despite caller key drift", async () => {
  const stableSpec = {
    project_id: "project-a", request_id: "request-stable-replay",
    work_name: "Stable replay", work_type: "software_git", idea: "Idea",
    objective: "Recover the same canonical Work", architecture: {},
    next_action: "Create", acceptance_criteria: ["One Work"], constraints: [],
    tasks: [{ title: "Build", weight: 1, required: true }], parent_work_id: null,
  };
  const observed = [];
  let attempt = 0;
  const store = {
    claim: async () => assert.fail("legacy claim must not run"), complete: async () => {},
    readCompletedOperation: async () => {},
    consumeConnectedAiTypedRequest: async ({ continuation_ref }) => ({
      operation: "WORK_CREATE_OR_RECONCILE",
      continuation_ref,
      canonical_request: { request: { create_request: {
        ...stableSpec,
        idempotency_key: `caller-shaped-inner-key-${attempt + 1}`,
      } } },
      core_result: { result: { review_id: "review-stable", review_digest: "9".repeat(64) } },
      replay: false,
      server_idempotency_key: `core_typed_attempt_${++attempt}`,
    }),
    completeConnectedAiTypedRequest: async () => {},
    releaseConnectedAiTypedRequest: async () => {},
  };
  const handler = createNyraGovernedContinueHandler({ store,
    readDirectiveContext: async () => ({}), normalizeDirectiveContext: () => ({}),
    issueDelegation: async () => {}, authorizeAction: async () => {},
    reviewWorkBootstrap: async () => assert.fail("review is server-owned"),
    createWorkBootstrap: async (request) => {
      observed.push(request.idempotency_key);
      return { structuredContent: { ok: true, result: {
        work: { work_id: "11111111-1111-4111-8111-111111111111" },
      } } };
    },
  });
  const owner = { ...identity, ownerConfirmed: true };
  for (const suffix of ["k", "l"]) {
    await handler({ operation: "create_work", continuation_ref: `nyc1_${suffix.repeat(40)}`,
      idempotency_key: `client-attempt-${suffix}`, owner_confirmed: true,
      confirmation_reference: "owner-confirmed-stable-replay" }, owner);
  }
  assert.equal(observed.length, 2);
  assert.match(observed[0], /^work_bootstrap_[a-f0-9]{48}$/);
  assert.equal(observed[1], observed[0]);
});
