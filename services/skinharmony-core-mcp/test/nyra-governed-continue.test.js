import assert from "node:assert/strict";
import test from "node:test";

import {
  createNyraContinuationOpener,
  createNyraGovernedContinueHandler,
} from "../src/nyra-governed-continue.js";
import {
  createNyraGovernedContinuationStore,
  NYRA_GOVERNED_CONTINUATION_SCHEMA,
} from "../src/nyra-governed-continuation-store.js";
import { HOST_APP_CAPABILITIES } from "../src/host-app-registry.js";
import { TOOLS } from "../src/tool-definitions.js";
import {
  governedWorkBootstrapDigest,
  materializeGovernedWorkBootstrapRequest,
} from "../src/work-bootstrap-contract.js";

const SECRET_DIGEST = "a".repeat(64);
const CONTEXT_DIGEST = "b".repeat(64);
const REGISTRY_REVISION = "c".repeat(64);
const WORK_ID = "11111111-1111-4111-8111-111111111111";
const CONTINUATION_REF = `nyc1_${"z".repeat(40)}`;

function identity(overrides = {}) {
  return {
    kind: "oauth",
    tenantId: "tenant-a",
    subject: "owner-a",
    ownerConfirmed: true,
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      registry_revision: REGISTRY_REVISION,
      app_id: "chatgpt_prod",
      auth_kind: "oauth",
      host_kind: "chatgpt_native",
      client_type: "chatgpt",
      interaction_mode: "nyra_conversational",
      capabilities: Object.values(HOST_APP_CAPABILITIES),
    },
    agentPresence: {
      session_fingerprint: "d".repeat(32),
      client_type: "chatgpt",
      session_id: "chatgpt-session",
      agent_id: "chatgpt-agent",
    },
    ...overrides,
  };
}

function bootstrapSpec() {
  return {
    request_id: "nyra-core-layering-v1",
    work_name: "Nyra Core layering",
    work_type: "software_git",
    idea: "Make Nyra the only conversational control plane",
    objective: "Persist opaque Nyra continuation references behind Universal Core",
    architecture: { layers: ["ai", "nyra", "core"] },
    next_action: "Review the bounded implementation",
    acceptance_criteria: ["The connected AI never receives a Core attestation"],
    constraints: ["Universal Core remains final authority"],
    tasks: [{ title: "Verify the continuation boundary", required: true }],
  };
}

function bootstrapDirective(caller = identity()) {
  const request = materializeGovernedWorkBootstrapRequest({
    spec: bootstrapSpec(), identity: caller, projectId: "nyra_core",
  });
  return {
    directive_id: "nyra_dir_1234567890abcdef12345678",
    request_digest: CONTEXT_DIGEST,
    ticket_request: {
      required: true,
      state: "WORK_BOOTSTRAP_READY",
      action_class: "WORK_BOOTSTRAP",
      merge_policy: "NOT_APPLICABLE",
      request_digest: SECRET_DIGEST,
      work_bootstrap_request_digest: governedWorkBootstrapDigest(request),
      binding: {
        tenant_id: caller.tenantId,
        work_id: null,
        project_id: "nyra_core",
        work_revision: null,
        intent_digest: null,
        context_digest: null,
      },
    },
  };
}

function actionRecord(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    continuation_ref: CONTINUATION_REF,
    directive_id: "nyra_dir_1234567890abcdef12345678",
    host_kind: "chatgpt_native",
    candidate_kind: "work_action",
    action_class: "GIT_PUSH",
    merge_policy: "NOT_APPLICABLE",
    work_id: WORK_ID,
    project_id: "nyra_core",
    work_revision: 7,
    intent_digest: SECRET_DIGEST,
    context_digest: CONTEXT_DIGEST,
    issued_at: "2026-08-28T21:00:00.000Z",
    expires_at: "2026-08-28T21:05:00.000Z",
    ...overrides,
  };
}

function precommitGate(overrides = {}) {
  return {
    schema_version: "precommit_ticket_gate_v1",
    tenant_id: "tenant-a",
    work_id: WORK_ID,
    action_kind: "git.commit",
    gate_kind: "ticket_acquisition",
    task_id: "22222222-2222-4222-8222-222222222222",
    plan_id: "33333333-3333-4333-8333-333333333333",
    evaluation_id: "44444444-4444-4444-8444-444444444444",
    evaluation_digest: "e".repeat(64),
    workspace_digest: "f".repeat(64),
    supersession_digest: "1".repeat(64),
    reconciliation_digest: "2".repeat(64),
    legacy_evidence_ids: ["55555555-5555-4555-8555-555555555555"],
    replacement_evidence_ids: ["66666666-6666-4666-8666-666666666666"],
    fulfilled: false,
    ticket_id: null,
    fresh: true,
    drift_codes: [],
    projection_digest: "3".repeat(64),
    ...overrides,
  };
}

function commitContext(gate = precommitGate()) {
  return {
    available: true,
    work_id: WORK_ID,
    project_id: "nyra_core",
    work_revision: 7,
    intent_digest: SECRET_DIGEST,
    context_digest: CONTEXT_DIGEST,
    status: "ACTIVE",
    precommit_ticket_gate: gate,
    precommit_ticket_gate_applicable: true,
  };
}

function commitRequest(gate = precommitGate()) {
  return {
    work_id: WORK_ID,
    intent_anchor_digest: SECRET_DIGEST,
    delegation_id: "hnd_commit-delegation-001",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    action: { kind: "git.commit", branch: "fix/nyra-conversation-quality-v1" },
    evidence_digest: gate.projection_digest,
  };
}

function commitTicket(request, gate = precommitGate(), overrides = {}) {
  const ticket = {
    schema_version: "host_native_action_ticket_v1",
    ticket_id: `hnt_${"4".repeat(64)}`,
    delegation_id: request.delegation_id,
    tenant_id: "tenant-a",
    work_id: WORK_ID,
    intent_anchor_digest: SECRET_DIGEST,
    repository: request.repository,
    host_kind: "chatgpt_native",
    host_session_fingerprint: "d".repeat(32),
    action: request.action,
    evidence_digest: gate.projection_digest,
    issued_at: "2026-08-28T21:00:10.000Z",
    expires_at: "2026-08-28T21:05:10.000Z",
    max_uses: 1,
    provider_execution: false,
    host_policy_override: false,
    host_policy_must_allow: true,
    signature: `hnt_${"5".repeat(64)}`,
    ...overrides,
  };
  return {
    schema_version: "host_native_action_ticket_record_v1",
    tenant_id: "tenant-a",
    state: "issued",
    uses: 0,
    ticket,
  };
}

function commitHandler({ ticketOverrides = {}, includeReadback = true } = {}) {
  const gate = precommitGate();
  const request = commitRequest(gate);
  const record = commitTicket(request, gate, ticketOverrides);
  const store = fakeStore(actionRecord({ action_class: "GIT_COMMIT" }));
  const fulfillments = [];
  const handler = createNyraGovernedContinueHandler({
    store,
    readDirectiveContext: async () => commitContext(gate),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    reviewWorkBootstrap: async () => { throw new Error("unexpected_review"); },
    createWorkBootstrap: async () => { throw new Error("unexpected_create"); },
    authorizeAction: async () => ({ structuredContent: { action_ticket: record } }),
    ...(includeReadback ? {
      readActionTicket: async ({ ticket_id }) => {
        assert.equal(ticket_id, record.ticket.ticket_id);
        return { structuredContent: { ok: true, tenant_id: "tenant-a", action_ticket: record } };
      },
    } : {}),
    fulfillPrecommitTicketTask: async (input) => {
      fulfillments.push(input);
      return { idempotent_replay: false };
    },
    now: () => Date.parse("2026-08-28T21:00:20.000Z"),
  });
  return { handler, request, gate, record, fulfillments };
}

function bootstrapRecord() {
  const directive = bootstrapDirective();
  return actionRecord({
    candidate_kind: "work_bootstrap",
    action_class: "WORK_BOOTSTRAP",
    work_id: null,
    work_revision: null,
    intent_digest: null,
    context_digest: null,
    work_bootstrap_request_digest: directive.ticket_request.work_bootstrap_request_digest,
  });
}

function fakeStore(record) {
  const completed = new Map();
  const calls = [];
  return {
    calls,
    async open({ identity: caller, directive }) {
      calls.push(["open", caller.tenantId, directive.directive_id]);
      return {
        schema_version: "nyra_continuation_ref_v1",
        available: true,
        continuation_ref: CONTINUATION_REF,
        expires_at: "2026-08-28T22:00:00.000Z",
        state: "READY",
        reason: null,
      };
    },
    async claim({ identity: caller, continuation_ref, operation, request_digest, validate }) {
      assert.equal(caller.tenantId, record.tenant_id);
      assert.equal(continuation_ref, record.continuation_ref);
      if (typeof validate === "function") await validate(record);
      calls.push(["claim", operation, request_digest]);
      const prior = completed.get(operation);
      return {
        record,
        operation,
        request_digest,
        idempotency_key: `core_${operation}`,
        replay: Boolean(prior),
        completed_result: prior || null,
      };
    },
    async readCompletedOperation({ operation }) {
      const result = completed.get(operation);
      if (!result) throw Object.assign(new Error("nyra_continuation_predecessor_incomplete"), { code: "nyra_continuation_predecessor_incomplete" });
      return result;
    },
    async complete({ operation, internal_result }) {
      calls.push(["complete", operation]);
      completed.set(operation, internal_result);
      return internal_result;
    },
  };
}

function bootstrapHandler(store, calls) {
  return createNyraGovernedContinueHandler({
    store,
    readDirectiveContext: async () => { throw new Error("unexpected_work_read"); },
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    authorizeAction: async () => { throw new Error("unexpected_authorization"); },
    reviewWorkBootstrap: async (args) => {
      calls.push(["review", args.idempotency_key]);
      return { structuredContent: { result: {
        review_id: "22222222-2222-4222-8222-222222222222",
        review_digest: CONTEXT_DIGEST,
        requires_owner_decision: false,
      } } };
    },
    createWorkBootstrap: async (args) => {
      calls.push(["create", args.idempotency_key, args.review_id]);
      return { structuredContent: { result: { work: { work_id: WORK_ID } } } };
    },
  });
}

test("the public continuation contract is opaque and the schema contains no bearer attestation", async () => {
  assert.match(NYRA_GOVERNED_CONTINUATION_SCHEMA, /nyra_governed_continuation/);
  assert.match(NYRA_GOVERNED_CONTINUATION_SCHEMA, /PRIMARY KEY \(tenant_id, continuation_ref\)/);
  assert.doesNotMatch(NYRA_GOVERNED_CONTINUATION_SCHEMA, /candidate_attestation|submit_tool|ngc1/);

  const store = fakeStore(bootstrapRecord());
  const opener = createNyraContinuationOpener({ store });
  const opened = await opener({ identity: identity(), directive: bootstrapDirective() });
  assert.equal(opened.available, true);
  assert.equal(opened.continuation_ref, CONTINUATION_REF);
  assert.equal(Object.hasOwn(opened, "candidate_attestation"), false);
  assert.deepEqual(store.calls[0], ["open", "tenant-a", "nyra_dir_1234567890abcdef12345678"]);
});

test("the durable continuation store fails closed until PostgreSQL schema readiness is verified", async () => {
  const statements = [];
  const pool = {
    query: async (statement) => {
      statements.push(String(statement));
      if (String(statement).includes("to_regclass")) {
        return { rows: [{
          continuation_table: true,
          operation_table: true,
          open_index: true,
          operation_index: true,
        }] };
      }
      return { rows: [] };
    },
  };
  const store = createNyraGovernedContinuationStore({
    pool,
    signingSecret: "continuation-store-test-secret-0123456789abcdef",
  });
  await assert.rejects(
    store.open({ identity: identity(), directive: bootstrapDirective() }),
    /nyra_continuation_store_unavailable/,
  );
  assert.deepEqual(await store.initialize(), {
    ready: true, distributed: true, restart_durable: true,
  });
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS nyra_governed_continuation/);
  assert.match(statements[1], /to_regclass/);
});

test("an expired open reference is atomically retired before the same Nyra binding is reissued", async () => {
  const statements = [];
  const client = {
    query: async (statement, parameters = []) => {
      const sql = String(statement);
      statements.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("SET state='EXPIRED'")) return { rowCount: 1, rows: [] };
      if (sql.includes("SELECT * FROM nyra_governed_continuation")) return { rows: [] };
      if (sql.includes("INSERT INTO nyra_governed_continuation")) {
        return { rows: [{
          continuation_ref: parameters[1],
          expires_at: parameters[23],
          state: parameters[20],
        }] };
      }
      throw new Error(`unexpected_sql:${sql.slice(0, 48)}`);
    },
    release: () => {},
  };
  const pool = {
    query: async (statement) => {
      const sql = String(statement);
      statements.push(sql);
      if (sql.includes("to_regclass")) {
        return { rows: [{
          continuation_table: true,
          operation_table: true,
          open_index: true,
          operation_index: true,
        }] };
      }
      return { rows: [] };
    },
    connect: async () => client,
  };
  const store = createNyraGovernedContinuationStore({
    pool,
    signingSecret: "continuation-store-test-secret-0123456789abcdef",
    now: () => Date.parse("2026-08-28T21:00:00.000Z"),
  });
  await store.initialize();
  const reopened = await store.open({ identity: identity(), directive: bootstrapDirective() });
  assert.match(reopened.continuation_ref, /^nyc1_/);
  assert.equal(reopened.state, "READY");
  const expiry = statements.findIndex((sql) => sql.includes("SET state='EXPIRED'"));
  const insert = statements.findIndex((sql) => sql.includes("INSERT INTO nyra_governed_continuation"));
  assert(expiry >= 0, "the transaction retires an expired OPEN row");
  assert(insert > expiry, "the fresh reference is inserted only after expiry retirement");
});

test("Nyra performs the Core bootstrap review then creates one Work using the persisted reference", async () => {
  const store = fakeStore(bootstrapRecord());
  const coreCalls = [];
  const handler = bootstrapHandler(store, coreCalls);
  const args = {
    operation: "review_work_bootstrap",
    continuation_ref: CONTINUATION_REF,
    work_bootstrap: bootstrapSpec(),
    idempotency_key: "caller-review-key",
  };
  const review = await handler(args, identity());
  assert.equal(review.structuredContent.work_bootstrap_reviewed, true);
  assert.equal(review.structuredContent.execution_authorized, false);
  assert.deepEqual(coreCalls, [["review", "core_review_work_bootstrap"]]);

  const created = await handler({
    ...args,
    operation: "create_work",
    idempotency_key: "caller-create-key",
    owner_confirmed: true,
    review_decision: "CONTINUE_NEW_WORK",
  }, identity());
  assert.equal(created.structuredContent.work_created, true);
  assert.equal(created.structuredContent.work_id, WORK_ID);
  assert.deepEqual(coreCalls[1], ["create", "core_create_work", "22222222-2222-4222-8222-222222222222"]);
  assert.equal(created.structuredContent.core_authority, "UNIVERSAL_CORE");
});

test("a completed continuation replays a stored Nyra result without calling Core again", async () => {
  const store = fakeStore(bootstrapRecord());
  const coreCalls = [];
  const handler = bootstrapHandler(store, coreCalls);
  const args = {
    operation: "review_work_bootstrap",
    continuation_ref: CONTINUATION_REF,
    work_bootstrap: bootstrapSpec(),
    idempotency_key: "caller-review-key",
  };
  await handler(args, identity());
  const replay = await handler(args, identity());
  assert.equal(replay.structuredContent.replay, true);
  assert.equal(coreCalls.length, 1);
});

test("Nyra rejects a continuation request whose bootstrap differs from the server-bound request", async () => {
  const store = fakeStore(bootstrapRecord());
  const handler = bootstrapHandler(store, []);
  await assert.rejects(handler({
    operation: "review_work_bootstrap",
    continuation_ref: CONTINUATION_REF,
    work_bootstrap: { ...bootstrapSpec(), objective: "A different Work" },
    idempotency_key: "caller-review-key",
  }, identity()), /nyra_continue_work_bootstrap_binding_mismatch/);
});

test("Nyra validates a continuation before it can consume the durable reference", async () => {
  const store = fakeStore(bootstrapRecord());
  const handler = bootstrapHandler(store, []);
  await assert.rejects(handler({
    operation: "review_work_bootstrap",
    continuation_ref: CONTINUATION_REF,
    work_bootstrap: { ...bootstrapSpec(), objective: "A different Work" },
    idempotency_key: "caller-preclaim-validation-key",
  }, identity()), /nyra_continue_work_bootstrap_binding_mismatch/);
  assert.equal(store.calls.some(([kind]) => kind === "claim"), false);
});

test("a bounded action continuation requires the matching host delegation and fresh Work context", async () => {
  const store = fakeStore(actionRecord());
  const calls = [];
  const handler = createNyraGovernedContinueHandler({
    store,
    readDirectiveContext: async () => ({
      available: true, work_id: WORK_ID, project_id: "nyra_core", work_revision: 7,
      intent_digest: SECRET_DIGEST, context_digest: CONTEXT_DIGEST, status: "ACTIVE",
    }),
    normalizeDirectiveContext: (value) => value,
    reviewWorkBootstrap: async () => { throw new Error("unexpected_review"); },
    createWorkBootstrap: async () => { throw new Error("unexpected_create"); },
    authorizeAction: async () => { throw new Error("unexpected_authorization"); },
    issueDelegation: async (args) => {
      calls.push(args);
      return { structuredContent: { delegation: { delegation_id: "delegation-1" } } };
    },
  });
  const response = await handler({
    operation: "issue_delegation",
    continuation_ref: CONTINUATION_REF,
    idempotency_key: "caller-delegation-key",
    owner_confirmed: true,
    delegation_request: {
      work_id: WORK_ID,
      intent_anchor_digest: SECRET_DIGEST,
      audience: ["chatgpt_native"],
      allowed_actions: ["git.push.branch"],
    },
  }, identity());
  assert.equal(response.structuredContent.delegation_issued, true);
  assert.equal(response.structuredContent.external_action_authorized, false);
  assert.equal(calls[0].idempotency_key, "core_issue_delegation");
});

test("git.commit is admitted by the bounded continuation delegation schema", () => {
  const tool = TOOLS.find((item) => item.name === "nyra_continue");
  const kinds = tool.inputSchema.properties.delegation_request
    .properties.allowed_actions.items.enum;
  assert(kinds.includes("git.commit"));
  assert.equal(kinds.includes("github.commit"), false);
});

test("a git.commit task is fulfilled only after trusted and fresh Core ticket readback", async () => {
  const { handler, request, gate, record, fulfillments } = commitHandler();
  const response = await handler({
    operation: "authorize_action",
    continuation_ref: CONTINUATION_REF,
    idempotency_key: "caller-commit-authorization-key",
    action_request: request,
  }, identity());
  assert.equal(response.structuredContent.ticket_issued, true);
  assert.equal(response.structuredContent.ticket_id, record.ticket.ticket_id);
  assert.equal(fulfillments.length, 1);
  assert.equal(fulfillments[0].gate_projection_digest, gate.projection_digest);
  assert.equal(fulfillments[0].action_ticket, record);
});

test("git.commit fulfillment rejects temporally stale or cross-bound Core readback", async (t) => {
  const cases = [
    ["expired", { expires_at: "2026-08-28T21:00:19.000Z" }],
    ["future issuance", { issued_at: "2026-08-28T21:01:00.001Z" }],
    ["wrong delegation", { delegation_id: "hnd_wrong-delegation-001" }],
    ["wrong host session", { host_session_fingerprint: "9".repeat(32) }],
    ["changed action", { action: { kind: "git.commit", branch: "main" } }],
  ];
  for (const [name, ticketOverrides] of cases) {
    await t.test(name, async () => {
      const { handler, request, fulfillments } = commitHandler({ ticketOverrides });
      await assert.rejects(handler({
        operation: "authorize_action",
        continuation_ref: CONTINUATION_REF,
        idempotency_key: `caller-commit-negative-${name.replaceAll(" ", "-")}`,
        action_request: request,
      }, identity()), /nyra_continue_commit_ticket_readback_invalid/);
      assert.equal(fulfillments.length, 0);
    });
  }
});

test("git.commit fails closed when trusted Core ticket readback is unavailable", async () => {
  const { handler, request, fulfillments } = commitHandler({ includeReadback: false });
  await assert.rejects(handler({
    operation: "authorize_action",
    continuation_ref: CONTINUATION_REF,
    idempotency_key: "caller-commit-no-readback",
    action_request: request,
  }, identity()), /nyra_continue_commit_ticket_readback_unavailable/);
  assert.equal(fulfillments.length, 0);
});
