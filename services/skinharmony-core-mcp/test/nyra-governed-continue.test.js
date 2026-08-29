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
    ...overrides,
  };
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
