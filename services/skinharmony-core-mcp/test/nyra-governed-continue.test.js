import assert from "node:assert/strict";
import crypto from "node:crypto";
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
import {
  bindNyraCanonicalIntent,
  finalizeNyraCanonicalIntent,
  nyraCanonicalIntentMessageDigest,
} from "../../shared/nyra-canonical-intent.mjs";
import { coreOrchestrationVerdictDigest } from "../../shared/nyra-core-orchestration-verdict.mjs";

const SECRET_DIGEST = "a".repeat(64);
const CONTEXT_DIGEST = "b".repeat(64);

function deterministicDigest(value) {
  const stable = (item) => Array.isArray(item)
    ? item.map(stable)
    : item && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])]))
      : item;
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
const BOOTSTRAP_MESSAGE = "Crea un nuovo Work governato per la continuità Nyra.";
const BOOTSTRAP_CANONICAL_INTENT = finalizeNyraCanonicalIntent({
  schema_version: "nyra_canonical_intent_v1",
  requested_now: ["work_bootstrap"],
  future_goals: [],
  constraints: [],
  prohibited_actions: [],
  referenced_actions: ["work_bootstrap"],
  owner_reserved_actions: [],
  speech_act: "REQUEST",
  operation_class: "READ_ONLY",
  scope: "WORK",
  target: "work_create",
  work_requirement: "NEW",
  consequential_intent: false,
  confidence: 0.99,
  ambiguity: false,
  safety_signals: [],
  provenance: {
    source: "nyra_dialogue_semantic_intake",
    reason_code: "test_new_work",
    semantic_hint_state: "NOT_PROVIDED",
    raw_text_digest: nyraCanonicalIntentMessageDigest(BOOTSTRAP_MESSAGE),
  },
}, { message: BOOTSTRAP_MESSAGE });
const BOOTSTRAP_CANONICAL_BINDING = bindNyraCanonicalIntent(
  BOOTSTRAP_CANONICAL_INTENT,
  { message: BOOTSTRAP_MESSAGE },
);
const CORE_VERDICT_MATERIAL = {
  schema_version: "core_orchestration_verdict_v1",
  authority: "UNIVERSAL_CORE",
  verdict: "HOLD",
  reason_codes: ["new_work_identity_required"],
  canonical_intent_binding: BOOTSTRAP_CANONICAL_BINDING,
  required_nyra_branches: [{
    id: "quality_verification",
    work_phase: "verification",
    core_branch_bindings: ["test.read"],
  }],
  denied_nyra_branches: [],
  required_roles: ["memory_curator", "planner", "executor_specialist", "independent_verifier"],
  task_graph_digest: "8".repeat(64),
  maximum_parallel_assignments: 2,
  independent_verifier_required: true,
  nyra_materializes_branches: true,
  core_join_required: true,
  permitted_progress: ["ANALYSIS", "PLANNING", "EVIDENCE", "BOUNDED_WORKSPACE"],
  external_execution_authorized: false,
};
const CORE_ORCHESTRATION_VERDICT = Object.freeze({
  ...CORE_VERDICT_MATERIAL,
  verdict_digest: coreOrchestrationVerdictDigest(CORE_VERDICT_MATERIAL),
});
const CANONICAL_INTENT_DIGEST = BOOTSTRAP_CANONICAL_INTENT.intent_digest;
const CORE_ORCHESTRATION_VERDICT_DIGEST = CORE_ORCHESTRATION_VERDICT.verdict_digest;
const REGISTRY_REVISION = "c".repeat(64);
const WORK_ID = "11111111-1111-4111-8111-111111111111";
const CONTINUATION_REF = `nyc1_${"z".repeat(40)}`;

test("finalizes a verified Work through the published Nyra continuation front door", async () => {
  const sequence = [];
  const bindings = [];
  const finalized = [];
  const unused = async () => ({ structuredContent: {} });
  const handler = createNyraGovernedContinueHandler({
    store: {
      claim: async () => { throw new Error("continuation store must not be used"); },
      complete: unused,
      readCompletedOperation: unused,
    },
    readDirectiveContext: unused,
    normalizeDirectiveContext: (value) => value,
    issueDelegation: unused,
    authorizeAction: unused,
    reviewWorkBootstrap: unused,
    createWorkBootstrap: unused,
    ensureFinalizeWorkBinding: async (args, caller) => {
      sequence.push("binding");
      bindings.push({ args, caller });
      return { schema_version: "nyra_read_binding_v1", state: "created" };
    },
    finalizeVerifiedWork: async (args, caller) => {
      sequence.push("finalize");
      finalized.push({ args, caller });
      return { structuredContent: { ok: true, result: { closure_verified: true } }, content: [] };
    },
  });

  const result = await handler({
    operation: "finalize_verified_work",
    work_id: WORK_ID,
    idempotency_key: "finalize-through-front-door",
    owner_confirmed: true,
    confirmation_reference: "owner-confirmed-finalize",
  }, identity());

  assert.equal(result.structuredContent.result.closure_verified, true);
  assert.deepEqual(sequence, ["binding", "finalize"]);
  assert.deepEqual(bindings.map(({ args }) => args), [{ work_id: WORK_ID }]);
  assert.deepEqual(finalized.map(({ args }) => args), [{
    work_id: WORK_ID,
    idempotency_key: "finalize-through-front-door",
  }]);
  await assert.rejects(handler({
    operation: "finalize_verified_work",
    work_id: WORK_ID,
    idempotency_key: "finalize-without-owner",
    owner_confirmed: false,
  }, identity({ ownerConfirmed: false })), /nyra_continue_verified_finalize_binding_mismatch/);
});

test("fails closed before verified finalization when logical lease binding is unavailable", async () => {
  let finalized = false;
  const unused = async () => ({ structuredContent: {} });
  const handler = createNyraGovernedContinueHandler({
    store: {
      claim: async () => { throw new Error("continuation store must not be used"); },
      complete: unused,
      readCompletedOperation: unused,
    },
    readDirectiveContext: unused,
    normalizeDirectiveContext: (value) => value,
    issueDelegation: unused,
    authorizeAction: unused,
    reviewWorkBootstrap: unused,
    createWorkBootstrap: unused,
    finalizeVerifiedWork: async () => {
      finalized = true;
      return { structuredContent: { ok: true }, content: [] };
    },
  });

  await assert.rejects(handler({
    operation: "finalize_verified_work",
    work_id: WORK_ID,
    idempotency_key: "finalize-without-logical-lease-binding",
    owner_confirmed: true,
    confirmation_reference: "owner-confirmed-finalize",
  }, identity()), /nyra_continue_verified_finalize_lease_binding_unavailable/);
  assert.equal(finalized, false);
});

test("replays a terminal verified Work when its read lease correctly rejects a new binding", async () => {
  const sequence = [];
  const unused = async () => ({ structuredContent: {} });
  const handler = createNyraGovernedContinueHandler({
    store: {
      claim: async () => { throw new Error("continuation store must not be used"); },
      complete: unused,
      readCompletedOperation: unused,
    },
    readDirectiveContext: unused,
    normalizeDirectiveContext: (value) => value,
    issueDelegation: unused,
    authorizeAction: unused,
    reviewWorkBootstrap: unused,
    createWorkBootstrap: unused,
    ensureFinalizeWorkBinding: async () => {
      sequence.push("binding");
      throw new Error("continuity_work_terminal");
    },
    finalizeVerifiedWork: async () => {
      sequence.push("finalize");
      return { structuredContent: { ok: true, result: { terminal_replay: true } }, content: [] };
    },
  });

  const result = await handler({
    operation: "finalize_verified_work",
    work_id: WORK_ID,
    idempotency_key: "replay-terminal-verified-work",
    owner_confirmed: true,
    confirmation_reference: "owner-confirmed-terminal-replay",
  }, identity());

  assert.equal(result.structuredContent.result.terminal_replay, true);
  assert.deepEqual(sequence, ["binding", "finalize"]);
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
    canonicalIntentDigest: CANONICAL_INTENT_DIGEST,
    coreOrchestrationVerdictDigest: CORE_ORCHESTRATION_VERDICT_DIGEST,
    coreOrchestrationVerdict: CORE_ORCHESTRATION_VERDICT,
  });
  return {
    directive_id: "nyra_dir_1234567890abcdef12345678",
    request_digest: CONTEXT_DIGEST,
    core_orchestration_verdict: CORE_ORCHESTRATION_VERDICT,
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
        canonical_intent_digest: CANONICAL_INTENT_DIGEST,
        canonical_intent_binding_digest: BOOTSTRAP_CANONICAL_BINDING.binding_digest,
        core_orchestration_verdict_digest: CORE_ORCHESTRATION_VERDICT_DIGEST,
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
    canonical_intent_digest: CANONICAL_INTENT_DIGEST,
    core_orchestration_verdict_digest: CORE_ORCHESTRATION_VERDICT_DIGEST,
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

function nativePrecommitGate(overrides = {}) {
  const material = {
    schema_version: "precommit_ticket_gate_v2",
    gate_source: "native_closure_evaluation",
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
    v2_scope_snapshot_digest: "4".repeat(64),
    v2_scope_tasks: [],
    legacy_evidence_ids: [],
    replacement_evidence_ids: [],
    fulfilled: false,
    ticket_id: null,
    fresh: true,
    drift_codes: [],
    ...overrides,
  };
  return { ...material, projection_digest: deterministicDigest(material) };
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

function fulfilledCommitContext(gate, {
  contextDigest = "9".repeat(64),
  predecessorContextDigest = CONTEXT_DIGEST,
} = {}) {
  return {
    ...commitContext(gate),
    context_digest: contextDigest,
    precommit_ticket_gate_applicable: false,
    fulfilled_precommit_predecessor_context_digest: predecessorContextDigest,
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
    // Universal Core's default idFactory uses randomBytes(16), so the live
    // ticket locator contains 32 hexadecimal characters. Legacy 64-character
    // locators remain covered by the other ticket fixtures in this suite.
    ticket_id: `hnt_${"4".repeat(32)}`,
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

function pushRequest() {
  return {
    work_id: WORK_ID,
    intent_anchor_digest: SECRET_DIGEST,
    delegation_id: "hnd_push-delegation-001",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    action: { kind: "git.push.branch", branch: "fix/nyra-conversation-quality-v1", commit: "8".repeat(40) },
    evidence_digest: "9".repeat(64),
  };
}

function pushTicket(request, overrides = {}) {
  const ticket = {
    schema_version: "host_native_action_ticket_v1",
    ticket_id: `hnt_${"8".repeat(64)}`,
    delegation_id: request.delegation_id,
    tenant_id: "tenant-a",
    work_id: WORK_ID,
    intent_anchor_digest: SECRET_DIGEST,
    repository: request.repository,
    host_kind: "chatgpt_native",
    host_session_fingerprint: "d".repeat(32),
    action: request.action,
    evidence_digest: request.evidence_digest,
    issued_at: "2026-08-28T21:00:10.000Z",
    expires_at: "2026-08-28T21:05:10.000Z",
    max_uses: 1,
    provider_execution: false,
    host_policy_override: false,
    host_policy_must_allow: true,
    signature: `hnt_${"9".repeat(64)}`,
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

function pullRequestRequest(kind = "github.draft_pr") {
  const materialization = pullRequestMaterialization();
  return {
    work_id: WORK_ID,
    intent_anchor_digest: SECRET_DIGEST,
    delegation_id: "hnd_pr-delegation-001",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    action: {
      kind,
      head_branch: "fix/nyra-pr",
      base_branch: "main",
      head_commit: "8".repeat(40),
      expected_base_commit: "7".repeat(40),
      changed_files: ["services/skinharmony-core-mcp/src/nyra-governed-continue.js"],
      title_digest: crypto.createHash("sha256").update(materialization.title).digest("hex"),
      body_digest: crypto.createHash("sha256").update(materialization.body).digest("hex"),
      draft: true,
      force: false,
    },
    evidence_digest: "9".repeat(64),
  };
}

function pullRequestMaterialization() {
  return {
    title: "fix(nyra): restore canonical orchestration",
    body: "Core-bound draft PR prepared by Nyra after independent verification.",
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
    intent_digest: CANONICAL_INTENT_DIGEST,
    context_digest: CORE_ORCHESTRATION_VERDICT_DIGEST,
    work_bootstrap_request_digest: directive.ticket_request.work_bootstrap_request_digest,
    core_orchestration_verdict: CORE_ORCHESTRATION_VERDICT,
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
          core_verdict_column: true,
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
  assert.match(statements[1], /atttypid='jsonb'::regtype/);
  assert.match(statements[1], /NOT attnotnull/);
});

test("the durable continuation store rejects a drifted Core verdict column", async () => {
  const pool = {
    query: async (statement) => {
      if (String(statement).includes("to_regclass")) {
        return { rows: [{
          continuation_table: true,
          operation_table: true,
          open_index: true,
          operation_index: true,
          core_verdict_column: false,
        }] };
      }
      return { rows: [] };
    },
  };
  const store = createNyraGovernedContinuationStore({
    pool,
    signingSecret: "continuation-store-test-secret-0123456789abcdef",
  });
  await assert.rejects(store.initialize(), /nyra_continuation_schema_unverified/);
});

test("an expired open reference is atomically retired before the same Nyra binding is reissued", async () => {
  const statements = [];
  const client = {
    query: async (statement, parameters = []) => {
      if (statement && typeof statement === "object") {
        parameters = statement.values || [];
        statement = statement.text;
      }
      const sql = String(statement);
      statements.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" ||
          sql.startsWith("SET LOCAL ") || sql.includes("CREATE TABLE IF NOT EXISTS nyra_governed_continuation")) {
        return { rows: [] };
      }
      if (sql.includes("SET state='EXPIRED'")) return { rowCount: 1, rows: [] };
      if (sql.includes("SELECT * FROM nyra_governed_continuation")) return { rows: [] };
      if (sql.includes("INSERT INTO nyra_governed_continuation")) {
        return { rows: [{
          continuation_ref: parameters[1],
          expires_at: parameters[24],
          state: parameters[21],
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
          core_verdict_column: true,
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

test("native precommit gate is CAS-claimed before authorization and fulfilled from trusted readback", async () => {
  const gate = nativePrecommitGate();
  const request = commitRequest(gate);
  const record = commitTicket(request, gate);
  const order = [];
  let claimReceipt;
  let recoveryLookups = 0;
  const handler = createNyraGovernedContinueHandler({
    store: fakeStore(actionRecord({ action_class: "GIT_COMMIT" })),
    readDirectiveContext: async () => commitContext(gate),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    reviewWorkBootstrap: async () => { throw new Error("unexpected_review"); },
    createWorkBootstrap: async () => { throw new Error("unexpected_create"); },
    claimPrecommitTicketGate: async (binding) => {
      order.push("claim");
      assert.equal(binding.work_id, WORK_ID);
      assert.equal(binding.continuation_ref, CONTINUATION_REF);
      assert.match(binding.request_digest, /^[a-f0-9]{64}$/);
      assert.equal(binding.delegation_id, request.delegation_id);
      assert.equal(binding.action_digest, deterministicDigest(request.action));
      assert.equal(binding.gate_projection_digest, gate.projection_digest);
      assert.equal(binding.host_session_fingerprint, "d".repeat(32));
      assert.equal(binding.idempotency_key, "core_authorize_action");
      const material = {
        schema_version: "precommit_ticket_gate_claim_v1",
        claim_id: "precommit-claim-native-001",
        ...binding,
        replay: false,
      };
      claimReceipt = { ...material, claim_digest: deterministicDigest(material) };
      return claimReceipt;
    },
    readPrecommitTicketGateClaimRecovery: async () => {
      recoveryLookups += 1;
      return null;
    },
    releaseOrReconcilePrecommitTicketGateClaim: async () => {
      throw new Error("unexpected_claim_recovery");
    },
    authorizeAction: async () => {
      order.push("authorize");
      return { structuredContent: { action_ticket: record } };
    },
    readActionTicket: async () => {
      order.push("readback");
      return { structuredContent: { ok: true, tenant_id: "tenant-a", action_ticket: record } };
    },
    fulfillPrecommitTicketTask: async (input) => {
      order.push("fulfill");
      assert.equal(input.action_ticket, record);
      assert.equal(input.gate_projection_digest, gate.projection_digest);
      assert.deepEqual(input.gate_claim, claimReceipt);
    },
    now: () => Date.parse("2026-08-28T21:00:20.000Z"),
  });
  const response = await handler({
    operation: "authorize_action",
    continuation_ref: CONTINUATION_REF,
    idempotency_key: "caller-native-commit-authorization",
    action_request: request,
  }, identity());
  assert.equal(response.structuredContent.ticket_id, record.ticket.ticket_id);
  assert.deepEqual(order, ["claim", "authorize", "readback", "fulfill"]);
  assert.equal(recoveryLookups, 1, "the post-claim path must not recover a newly created claim");
});

test("native precommit retry after fulfilled replays the prior ticket through Core without fulfill", async () => {
  const originalGate = nativePrecommitGate();
  const request = commitRequest(originalGate);
  const record = commitTicket(request, originalGate);
  let authorizations = 0;
  let fulfillments = 0;
  const handler = createNyraGovernedContinueHandler({
    store: fakeStore(actionRecord({ action_class: "GIT_COMMIT" })),
    readDirectiveContext: async () => fulfilledCommitContext(nativePrecommitGate({
      fulfilled: true, ticket_id: record.ticket.ticket_id,
    })),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => {}, reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
    readPrecommitTicketGateClaimRecovery: async (binding) => {
      const { fulfilled: _fulfilled, ...claimBinding } = binding;
      const claimMaterial = { schema_version: "precommit_ticket_gate_claim_v1",
        claim_id: "11111111-1111-4111-8111-111111111111", ...claimBinding,
        continuation_ref: CONTINUATION_REF,
        gate_projection_digest: originalGate.projection_digest,
        idempotency_key: "core_authorize_action", replay: true };
      return { schema_version: "precommit_ticket_gate_recovery_v1", ticket_id: record.ticket.ticket_id,
        gate_claim: { ...claimMaterial, claim_digest: deterministicDigest(claimMaterial) } };
    },
    authorizeAction: async () => {
      authorizations += 1;
      return { structuredContent: { action_ticket: record } };
    },
    readActionTicket: async () => ({ structuredContent: { ok: true, tenant_id: "tenant-a", action_ticket: record } }),
    fulfillPrecommitTicketTask: async () => { fulfillments += 1; },
    now: () => Date.parse("2026-08-28T21:00:20.000Z"),
  });
  const result = await handler({ operation: "authorize_action", continuation_ref: CONTINUATION_REF,
    idempotency_key: "caller-crash-retry", action_request: request }, identity());
  assert.equal(result.structuredContent.ticket_id, record.ticket.ticket_id);
  assert.equal(authorizations, 1);
  assert.equal(fulfillments, 0);
});

test("native precommit fulfilled recovery rejects unrelated Work context drift", async () => {
  const originalGate = nativePrecommitGate();
  const request = commitRequest(originalGate);
  const record = commitTicket(request, originalGate);
  let authorizations = 0;
  const handler = createNyraGovernedContinueHandler({
    store: fakeStore(actionRecord({ action_class: "GIT_COMMIT" })),
    readDirectiveContext: async () => fulfilledCommitContext(nativePrecommitGate({
      fulfilled: true, ticket_id: record.ticket.ticket_id,
    }), { predecessorContextDigest: "a".repeat(64) }),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => {}, reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
    readPrecommitTicketGateClaimRecovery: async (binding) => {
      const { fulfilled: _fulfilled, ...claimBinding } = binding;
      const claimMaterial = { schema_version: "precommit_ticket_gate_claim_v1",
        claim_id: "11111111-1111-4111-8111-111111111111", ...claimBinding,
        continuation_ref: CONTINUATION_REF,
        gate_projection_digest: originalGate.projection_digest,
        idempotency_key: "core_authorize_action", replay: true };
      return { schema_version: "precommit_ticket_gate_recovery_v1", ticket_id: record.ticket.ticket_id,
        recovery_source: "fulfillment",
        gate_claim: { ...claimMaterial, claim_digest: deterministicDigest(claimMaterial) } };
    },
    authorizeAction: async () => { authorizations += 1; },
  });
  await assert.rejects(handler({ operation: "authorize_action", continuation_ref: CONTINUATION_REF,
    idempotency_key: "caller-fulfilled-context-drift", action_request: request }, identity()),
  /nyra_continue_work_drift/);
  assert.equal(authorizations, 0);
});

test("native precommit fulfilled recovery renews an expired root through the exact replay claim", async () => {
  const originalGate = nativePrecommitGate();
  const request = commitRequest(originalGate);
  const expired = commitTicket(request, originalGate, {
    issued_at: "2026-08-28T21:00:10.000Z",
    expires_at: "2026-08-28T21:00:19.000Z",
  });
  const successor = commitTicket(request, originalGate, {
    ticket_id: `hnt_${"e".repeat(32)}`,
    issued_at: "2026-08-28T21:00:19.000Z",
    expires_at: "2026-08-28T21:05:19.000Z",
  });
  const order = [];
  let recoveredClaim;
  let fulfillments = 0;
  const handler = createNyraGovernedContinueHandler({
    store: fakeStore(actionRecord({ action_class: "GIT_COMMIT" })),
    readDirectiveContext: async () => fulfilledCommitContext(nativePrecommitGate({
      fulfilled: true, ticket_id: expired.ticket.ticket_id,
    })),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => {}, reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
    readPrecommitTicketGateClaimRecovery: async (binding) => {
      order.push("recover");
      const { fulfilled: _fulfilled, ...claimBinding } = binding;
      const material = {
        schema_version: "precommit_ticket_gate_claim_v1",
        claim_id: "11111111-1111-4111-8111-111111111111",
        ...claimBinding,
        continuation_ref: CONTINUATION_REF,
        gate_projection_digest: originalGate.projection_digest,
        idempotency_key: "core_authorize_action_prior", replay: true,
      };
      recoveredClaim = { ...material, claim_digest: deterministicDigest(material) };
      return {
        schema_version: "precommit_ticket_gate_recovery_v1",
        ticket_id: expired.ticket.ticket_id,
        recovery_source: "fulfillment",
        gate_claim: recoveredClaim,
      };
    },
    authorizeAction: async (args, _identity, nativeClaim) => {
      order.push("authorize");
      assert.equal(args.idempotency_key, recoveredClaim.idempotency_key);
      assert.deepEqual(nativeClaim, recoveredClaim);
      return { structuredContent: { action_ticket: successor } };
    },
    readActionTicket: async ({ ticket_id }) => {
      order.push("readback");
      assert.equal(ticket_id, successor.ticket.ticket_id);
      return { structuredContent: { ok: true, tenant_id: "tenant-a", action_ticket: successor } };
    },
    fulfillPrecommitTicketTask: async () => { fulfillments += 1; },
    now: () => Date.parse("2026-08-28T21:00:20.000Z"),
  });
  const result = await handler({ operation: "authorize_action", continuation_ref: CONTINUATION_REF,
    idempotency_key: "caller-fulfilled-expired-retry", action_request: request }, identity());
  assert.equal(result.structuredContent.ticket_id, successor.ticket.ticket_id);
  assert.deepEqual(order, ["recover", "authorize", "readback"]);
  assert.equal(fulfillments, 0);
});

test("native precommit retry adopts a naked prior claim before its first reconciliation", async () => {
  const gate = nativePrecommitGate();
  const request = commitRequest(gate);
  const record = commitTicket(request, gate);
  const order = [];
  let recoveredClaim;
  const handler = createNyraGovernedContinueHandler({
    store: fakeStore(actionRecord({ action_class: "GIT_COMMIT" })),
    readDirectiveContext: async () => commitContext(gate),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => {}, reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
    readPrecommitTicketGateClaimRecovery: async (binding) => {
      order.push("recover");
      const material = {
        schema_version: "precommit_ticket_gate_claim_v1",
        claim_id: "11111111-1111-4111-8111-111111111111",
        work_id: WORK_ID,
        continuation_ref: "nyc_prior-naked-claim-0001",
        request_digest: binding.request_digest,
        delegation_id: request.delegation_id,
        action_digest: deterministicDigest(request.action),
        gate_projection_digest: gate.projection_digest,
        host_session_fingerprint: "d".repeat(32),
        idempotency_key: "core_authorize_action_prior_naked",
        replay: true,
      };
      recoveredClaim = { ...material, claim_digest: deterministicDigest(material) };
      return { schema_version: "precommit_ticket_gate_recovery_v1", ticket_id: null,
        recovery_source: "claim", gate_claim: recoveredClaim };
    },
    claimPrecommitTicketGate: async () => { throw new Error("unexpected_new_claim"); },
    authorizeAction: async (args, _identity, nativeClaim) => {
      order.push("authorize");
      assert.equal(args.idempotency_key, recoveredClaim.idempotency_key);
      assert.deepEqual(nativeClaim, recoveredClaim);
      return { structuredContent: { action_ticket: record } };
    },
    readActionTicket: async () => {
      order.push("readback");
      return { structuredContent: { ok: true, tenant_id: "tenant-a", action_ticket: record } };
    },
    fulfillPrecommitTicketTask: async () => { order.push("fulfill"); },
    releaseOrReconcilePrecommitTicketGateClaim: async () => {
      throw new Error("unexpected_reconciliation");
    },
    now: () => Date.parse("2026-08-28T21:00:20.000Z"),
  });
  const result = await handler({ operation: "authorize_action", continuation_ref: CONTINUATION_REF,
    idempotency_key: "caller-naked-claim-recovery", action_request: request }, identity());
  assert.equal(result.structuredContent.ticket_id, record.ticket.ticket_id);
  assert.deepEqual(order, ["recover", "authorize", "readback", "fulfill"]);
});

test("native precommit retry adopts an exact prior continuation and fulfills a replacement ticket", async () => {
  const gate = nativePrecommitGate();
  const request = commitRequest(gate);
  const replacement = commitTicket(request, gate, {
    ticket_id: `hnt_${"e".repeat(32)}`,
    issued_at: "2026-08-28T21:00:19.000Z",
    expires_at: "2026-08-28T21:05:19.000Z",
  });
  const order = [];
  let recoveredClaim;
  let fulfilled;
  const handler = createNyraGovernedContinueHandler({
    store: fakeStore(actionRecord({ action_class: "GIT_COMMIT" })),
    readDirectiveContext: async () => commitContext(gate),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => {}, reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
    readPrecommitTicketGateClaimRecovery: async (binding) => {
      order.push("recover");
      assert.equal(binding.gate_projection_digest, gate.projection_digest);
      const material = {
        schema_version: "precommit_ticket_gate_claim_v1",
        claim_id: "11111111-1111-4111-8111-111111111111",
        work_id: WORK_ID,
        continuation_ref: "nyc_prior-continuation-0001",
        request_digest: binding.request_digest,
        delegation_id: request.delegation_id,
        action_digest: deterministicDigest(request.action),
        gate_projection_digest: gate.projection_digest,
        host_session_fingerprint: "d".repeat(32),
        idempotency_key: "core_authorize_action_prior",
        replay: true,
      };
      recoveredClaim = { ...material, claim_digest: deterministicDigest(material) };
      return {
        schema_version: "precommit_ticket_gate_recovery_v1",
        ticket_id: `hnt_${"4".repeat(32)}`,
        recovery_source: "reconciliation",
        gate_claim: recoveredClaim,
      };
    },
    claimPrecommitTicketGate: async () => { throw new Error("unexpected_new_claim"); },
    authorizeAction: async (args, _identity, nativeClaim) => {
      order.push("authorize");
      assert.equal(args.idempotency_key, "core_authorize_action_prior");
      assert.deepEqual(nativeClaim, recoveredClaim);
      return { structuredContent: { action_ticket: replacement } };
    },
    readActionTicket: async ({ ticket_id }) => {
      order.push("readback");
      assert.equal(ticket_id, replacement.ticket.ticket_id);
      return { structuredContent: { ok: true, tenant_id: "tenant-a", action_ticket: replacement } };
    },
    fulfillPrecommitTicketTask: async (input) => {
      order.push("fulfill");
      fulfilled = input;
    },
    releaseOrReconcilePrecommitTicketGateClaim: async () => {
      throw new Error("unexpected_reconciliation_overwrite");
    },
    now: () => Date.parse("2026-08-28T21:00:20.000Z"),
  });
  const result = await handler({ operation: "authorize_action", continuation_ref: CONTINUATION_REF,
    idempotency_key: "caller-cross-continuation-recovery", action_request: request }, identity());
  assert.equal(result.structuredContent.ticket_id, replacement.ticket.ticket_id);
  assert.deepEqual(order, ["recover", "authorize", "readback", "fulfill"]);
  assert.equal(fulfilled.gate_projection_digest, gate.projection_digest);
  assert.deepEqual(fulfilled.gate_claim, recoveredClaim);
});

test("native precommit recovery accepts the exact still-valid cached ticket older than the new continuation", async () => {
  const gate = nativePrecommitGate();
  const request = commitRequest(gate);
  const cached = commitTicket(request, gate, {
    issued_at: "2026-08-28T21:00:00.000Z",
    expires_at: "2026-08-28T21:10:00.000Z",
  });
  const order = [];
  const handler = createNyraGovernedContinueHandler({
    store: fakeStore(actionRecord({
      action_class: "GIT_COMMIT",
      issued_at: "2026-08-28T21:05:00.000Z",
      expires_at: "2026-08-28T21:15:00.000Z",
    })),
    readDirectiveContext: async () => commitContext(gate),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => {}, reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
    readPrecommitTicketGateClaimRecovery: async (binding) => {
      order.push("recover");
      const material = {
        schema_version: "precommit_ticket_gate_claim_v1",
        claim_id: "11111111-1111-4111-8111-111111111111",
        work_id: WORK_ID,
        continuation_ref: "nyc_prior-continuation-0002",
        request_digest: binding.request_digest,
        delegation_id: request.delegation_id,
        action_digest: deterministicDigest(request.action),
        gate_projection_digest: gate.projection_digest,
        host_session_fingerprint: "d".repeat(32),
        idempotency_key: "core_authorize_action_prior_cached",
        replay: true,
      };
      return {
        schema_version: "precommit_ticket_gate_recovery_v1",
        ticket_id: cached.ticket.ticket_id,
        recovery_source: "reconciliation",
        gate_claim: { ...material, claim_digest: deterministicDigest(material) },
      };
    },
    authorizeAction: async () => {
      order.push("authorize");
      return { structuredContent: { action_ticket: cached } };
    },
    readActionTicket: async () => {
      order.push("readback");
      return { structuredContent: { ok: true, tenant_id: "tenant-a", action_ticket: cached } };
    },
    fulfillPrecommitTicketTask: async () => { order.push("fulfill"); },
    releaseOrReconcilePrecommitTicketGateClaim: async () => {
      throw new Error("unexpected_reconciliation_overwrite");
    },
    now: () => Date.parse("2026-08-28T21:06:00.000Z"),
  });
  const result = await handler({ operation: "authorize_action", continuation_ref: CONTINUATION_REF,
    idempotency_key: "caller-cached-cross-continuation-recovery", action_request: request }, identity());
  assert.equal(result.structuredContent.ticket_id, cached.ticket.ticket_id);
  assert.deepEqual(order, ["recover", "authorize", "readback", "fulfill"]);
});

test("native precommit recovery rejects a request bound to a superseded gate before lookup", async () => {
  const supersededGate = nativePrecommitGate();
  const currentGate = nativePrecommitGate({ workspace_digest: "9".repeat(64) });
  const request = commitRequest(supersededGate);
  let recoveries = 0;
  let authorizations = 0;
  const handler = createNyraGovernedContinueHandler({
    store: fakeStore(actionRecord({ action_class: "GIT_COMMIT" })),
    readDirectiveContext: async () => commitContext(currentGate),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => {}, reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
    readPrecommitTicketGateClaimRecovery: async () => { recoveries += 1; },
    authorizeAction: async () => { authorizations += 1; },
  });
  await assert.rejects(handler({ operation: "authorize_action", continuation_ref: CONTINUATION_REF,
    idempotency_key: "caller-superseded-gate-recovery", action_request: request }, identity()),
  /nyra_continue_precommit_evidence_mismatch/);
  assert.equal(recoveries, 0);
  assert.equal(authorizations, 0);
});

test("native precommit gate fails closed before authorization without an exact claim receipt", async (t) => {
  const gate = nativePrecommitGate();
  const request = commitRequest(gate);
  for (const [name, claimCallback, expected] of [
    ["missing callback", null, /nyra_continue_precommit_claim_unavailable/],
    ["mismatched receipt", async (binding) => {
      const material = {
        schema_version: "precommit_ticket_gate_claim_v1",
        claim_id: "precommit-claim-native-002",
        ...binding,
        delegation_id: "hnd_attacker-substitution",
        replay: false,
      };
      return { ...material, claim_digest: deterministicDigest(material) };
    }, /nyra_continue_precommit_claim_invalid/],
  ]) {
    await t.test(name, async () => {
      let authorizations = 0;
      const handler = createNyraGovernedContinueHandler({
        store: fakeStore(actionRecord({ action_class: "GIT_COMMIT" })),
        readDirectiveContext: async () => commitContext(gate),
        normalizeDirectiveContext: (value) => value,
        issueDelegation: async () => {}, reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
        authorizeAction: async () => { authorizations += 1; },
        claimPrecommitTicketGate: claimCallback,
        releaseOrReconcilePrecommitTicketGateClaim: async () => {},
      });
      await assert.rejects(handler({
        operation: "authorize_action", continuation_ref: CONTINUATION_REF,
        idempotency_key: `caller-native-claim-${name.replace(" ", "-")}`,
        action_request: request,
      }, identity()), expected);
      assert.equal(authorizations, 0);
    });
  }
});

test("native precommit gate rejects source, mapping and projection widening before claim", async (t) => {
  const valid = nativePrecommitGate();
  const cases = [
    ["wrong source", { ...valid, gate_source: "caller_reconciliation" }],
    ["non-empty mappings", nativePrecommitGate({
      legacy_evidence_ids: ["55555555-5555-4555-8555-555555555555"],
      replacement_evidence_ids: ["66666666-6666-4666-8666-666666666666"],
    })],
    ["tampered projection", { ...valid, projection_digest: "9".repeat(64) }],
  ];
  for (const [name, gate] of cases) {
    await t.test(name, async () => {
      let claims = 0;
      let authorizations = 0;
      const request = commitRequest(gate);
      const handler = createNyraGovernedContinueHandler({
        store: fakeStore(actionRecord({ action_class: "GIT_COMMIT" })),
        readDirectiveContext: async () => commitContext(gate),
        normalizeDirectiveContext: (value) => value,
        issueDelegation: async () => {}, reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
        claimPrecommitTicketGate: async () => { claims += 1; },
        releaseOrReconcilePrecommitTicketGateClaim: async () => {},
        authorizeAction: async () => { authorizations += 1; },
      });
      await assert.rejects(handler({
        operation: "authorize_action", continuation_ref: CONTINUATION_REF,
        idempotency_key: `native-gate-widen-${name.replaceAll(" ", "-")}`,
        action_request: request,
      }, identity()), /nyra_continue_precommit_evidence_mismatch/);
      assert.equal(claims, 0);
      assert.equal(authorizations, 0);
    });
  }
});

test("native precommit claim is reconciled when authorization fails after CAS claim", async () => {
  const gate = nativePrecommitGate();
  const request = commitRequest(gate);
  const recoveries = [];
  const handler = createNyraGovernedContinueHandler({
    store: fakeStore(actionRecord({ action_class: "GIT_COMMIT" })),
    readDirectiveContext: async () => commitContext(gate),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => {}, reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
    claimPrecommitTicketGate: async (binding) => {
      const material = { schema_version: "precommit_ticket_gate_claim_v1",
        claim_id: "precommit-claim-native-003", ...binding, replay: true };
      return { ...material, claim_digest: deterministicDigest(material) };
    },
    authorizeAction: async () => { throw new Error("core_authorize_unavailable"); },
    releaseOrReconcilePrecommitTicketGateClaim: async (input) => { recoveries.push(input); },
  });
  await assert.rejects(handler({
    operation: "authorize_action", continuation_ref: CONTINUATION_REF,
    idempotency_key: "caller-native-claim-recovery", action_request: request,
  }, identity()), /core_authorize_unavailable/);
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].stage, "before_ticket_locator");
  assert.equal(recoveries[0].ticket_id, null);
  assert.equal(recoveries[0].gate_claim.replay, true);
});

test("git.commit fulfillment rejects temporally stale or cross-bound Core readback", async (t) => {
  const cases = [
    ["expired", { expires_at: "2026-08-28T21:00:19.000Z" }],
    ["future issuance", { issued_at: "2026-08-28T21:01:00.001Z" }],
    ["predates candidate outside skew", {
      issued_at: "2026-08-28T20:59:29.000Z", expires_at: "2026-08-28T21:05:10.000Z",
    }],
    ["wrong delegation", { delegation_id: "hnd_wrong-delegation-001" }],
    ["wrong host session", { host_session_fingerprint: "9".repeat(32) }],
    ["changed action", { action: { kind: "git.commit", branch: "main" } }],
    ["short signature", { signature: `hnt_${"7".repeat(32)}` }],
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

test("owner-reserved GIT_MERGE cannot issue a delegation or authorize an action", async (t) => {
  for (const operation of ["issue_delegation", "authorize_action"]) {
    for (const ownerConfirmed of [false, true]) {
      await t.test(`${operation} owner_confirmed=${ownerConfirmed}`, async () => {
        const calls = [];
        const store = fakeStore(actionRecord({ action_class: "GIT_MERGE", merge_policy: "MANUAL_OWNER_ONLY" }));
        const handler = createNyraGovernedContinueHandler({
          store,
          readDirectiveContext: async () => { calls.push("readDirectiveContext"); },
          normalizeDirectiveContext: (value) => value,
          issueDelegation: async () => { calls.push("issueDelegation"); },
          authorizeAction: async () => { calls.push("authorizeAction"); },
          readActionTicket: async () => { calls.push("readActionTicket"); },
          reviewWorkBootstrap: async () => { calls.push("reviewWorkBootstrap"); },
          createWorkBootstrap: async () => { calls.push("createWorkBootstrap"); },
        });
        const action = {
          operation,
          continuation_ref: CONTINUATION_REF,
          idempotency_key: `merge-${operation}-${ownerConfirmed}`,
          owner_confirmed: ownerConfirmed,
          ...(operation === "issue_delegation" ? { delegation_request: {
            work_id: WORK_ID, intent_anchor_digest: SECRET_DIGEST,
            audience: ["chatgpt_native"], allowed_actions: ["github.merge"],
          } } : { action_request: {
            work_id: WORK_ID, intent_anchor_digest: SECRET_DIGEST,
            delegation_id: "hnd_merge-delegation-001",
            repository: "cardarellocristian86-debug/skinharmony-ai-backend",
            action: { kind: "github.merge", pull_request: 413 }, evidence_digest: "9".repeat(64),
          } }),
        };
        await assert.rejects(handler(action, identity({ ownerConfirmed })), /nyra_continue_manual_merge_only/);
        assert.deepEqual(calls, []);
        assert.equal(store.calls.some(([kind]) => kind === "claim"), false);
      });
    }
  }
});

test("a non-commit action does not trust the immediate adapter ticket without trusted readback", async () => {
  const request = pushRequest();
  const record = pushTicket(request);
  const store = fakeStore(actionRecord({ action_class: "GIT_PUSH" }));
  const handler = createNyraGovernedContinueHandler({
    store,
    readDirectiveContext: async () => ({
      available: true, work_id: WORK_ID, project_id: "nyra_core", work_revision: 7,
      intent_digest: SECRET_DIGEST, context_digest: CONTEXT_DIGEST, status: "ACTIVE",
    }),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    reviewWorkBootstrap: async () => { throw new Error("unexpected_review"); },
    createWorkBootstrap: async () => { throw new Error("unexpected_create"); },
    authorizeAction: async () => ({ structuredContent: { action_ticket: record } }),
    now: () => Date.parse("2026-08-28T21:00:20.000Z"),
  });
  await assert.rejects(handler({
    operation: "authorize_action", continuation_ref: CONTINUATION_REF,
    idempotency_key: "push-without-trusted-readback", action_request: request,
  }, identity()), /nyra_continue_action_ticket_readback_unavailable/);
});

test("a non-commit action accepts only an exact trusted Core ticket readback", async (t) => {
  const request = pushRequest();
  for (const [name, ticketOverrides, accepted] of [
    ["exact", {}, true],
    ["changed branch", { action: { ...request.action, branch: "main" } }, false],
    ["wrong repository", { repository: "attacker/example" }, false],
    ["wrong host session", { host_session_fingerprint: "0".repeat(32) }, false],
  ]) {
    await t.test(name, async () => {
      const immediate = pushTicket(request);
      const trusted = pushTicket(request, ticketOverrides);
      const store = fakeStore(actionRecord({ action_class: "GIT_PUSH" }));
      const handler = createNyraGovernedContinueHandler({
        store,
        readDirectiveContext: async () => ({
          available: true, work_id: WORK_ID, project_id: "nyra_core", work_revision: 7,
          intent_digest: SECRET_DIGEST, context_digest: CONTEXT_DIGEST, status: "ACTIVE",
        }),
        normalizeDirectiveContext: (value) => value,
        issueDelegation: async () => { throw new Error("unexpected_delegation"); },
        reviewWorkBootstrap: async () => { throw new Error("unexpected_review"); },
        createWorkBootstrap: async () => { throw new Error("unexpected_create"); },
        authorizeAction: async () => ({ structuredContent: { action_ticket: immediate } }),
        readActionTicket: async ({ ticket_id }) => {
          assert.equal(ticket_id, immediate.ticket.ticket_id);
          return { structuredContent: { ok: true, tenant_id: "tenant-a", action_ticket: trusted } };
        },
        now: () => Date.parse("2026-08-28T21:00:20.000Z"),
      });
      const invoke = () => handler({
        operation: "authorize_action", continuation_ref: CONTINUATION_REF,
        idempotency_key: `push-trusted-${name.replaceAll(" ", "-")}`, action_request: request,
      }, identity());
      if (accepted) {
        const response = await invoke();
        assert.equal(response.structuredContent.ticket_id, trusted.ticket.ticket_id);
      } else {
        await assert.rejects(invoke(), /nyra_continue_action_ticket_readback_invalid/);
      }
    });
  }
});

test("a trusted draft PR ticket reaches the injected standing-release coordinator after readback", async () => {
  const request = pullRequestRequest();
  const record = pushTicket(request);
  const calls = [];
  const store = fakeStore(actionRecord({ action_class: "PULL_REQUEST_OPEN" }));
  const handler = createNyraGovernedContinueHandler({
    store,
    readDirectiveContext: async () => ({
      available: true, work_id: WORK_ID, project_id: "nyra_core", work_revision: 7,
      intent_digest: SECRET_DIGEST, context_digest: CONTEXT_DIGEST, status: "ACTIVE",
    }),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => { throw new Error("unexpected_delegation"); },
    reviewWorkBootstrap: async () => { throw new Error("unexpected_review"); },
    createWorkBootstrap: async () => { throw new Error("unexpected_create"); },
    authorizeAction: async () => { calls.push("authorize"); return { structuredContent: { action_ticket: record } }; },
    readActionTicket: async () => {
      calls.push("trusted_readback");
      return { structuredContent: { ok: true, tenant_id: "tenant-a", action_ticket: record } };
    },
    coordinatePullRequest: async (input) => {
      calls.push("coordinate");
      assert.deepEqual(input.action_request, request);
      assert.deepEqual(input.action_ticket, record);
      assert.deepEqual(input.materialization, pullRequestMaterialization());
      assert.equal(input.idempotency_key, "core_authorize_action");
      return { structuredContent: { standing_release_run: { run_id: `srr_${"a".repeat(40)}` } } };
    },
    now: () => Date.parse("2026-08-28T21:00:20.000Z"),
  });
  const response = await handler({
    operation: "authorize_action", continuation_ref: CONTINUATION_REF,
    idempotency_key: "draft-pr-trusted-handoff", action_request: request,
    pull_request_materialization: pullRequestMaterialization(),
  }, identity());
  assert.deepEqual(calls, ["authorize", "trusted_readback", "coordinate"]);
  assert.equal(response.structuredContent.ticket_id, record.ticket.ticket_id);
  assert.equal(response.structuredContent.pull_request_handoff_started, true);
  assert.match(response.structuredContent.host_response_contract.reply_seed, /standing-release/);
});

test("draft PR continuation fails closed without coordinator and rejects action widening", async (t) => {
  for (const widenedKind of ["github.ready", "github.merge"]) {
    await t.test(`rejects ${widenedKind}`, async () => {
      const request = pullRequestRequest(widenedKind);
      const calls = [];
      const handler = createNyraGovernedContinueHandler({
        store: fakeStore(actionRecord({ action_class: "PULL_REQUEST_OPEN" })),
        readDirectiveContext: async () => ({
          available: true, work_id: WORK_ID, project_id: "nyra_core", work_revision: 7,
          intent_digest: SECRET_DIGEST, context_digest: CONTEXT_DIGEST, status: "ACTIVE",
        }),
        normalizeDirectiveContext: (value) => value,
        issueDelegation: async () => { calls.push("delegation"); },
        authorizeAction: async () => { calls.push("authorize"); },
        reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
      });
      await assert.rejects(handler({
        operation: "authorize_action", continuation_ref: CONTINUATION_REF,
        idempotency_key: `pr-widen-${widenedKind}`, action_request: request,
      }, identity()), /nyra_continue_action_binding_mismatch/);
      assert.deepEqual(calls, []);
    });
  }

  const request = pullRequestRequest();
  const record = pushTicket(request);
  const handler = createNyraGovernedContinueHandler({
    store: fakeStore(actionRecord({ action_class: "PULL_REQUEST_OPEN" })),
    readDirectiveContext: async () => ({
      available: true, work_id: WORK_ID, project_id: "nyra_core", work_revision: 7,
      intent_digest: SECRET_DIGEST, context_digest: CONTEXT_DIGEST, status: "ACTIVE",
    }),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => {}, reviewWorkBootstrap: async () => {}, createWorkBootstrap: async () => {},
    authorizeAction: async () => ({ structuredContent: { action_ticket: record } }),
    readActionTicket: async () => ({ structuredContent: { ok: true, tenant_id: "tenant-a", action_ticket: record } }),
    now: () => Date.parse("2026-08-28T21:00:20.000Z"),
  });
  await assert.rejects(handler({
    operation: "authorize_action", continuation_ref: CONTINUATION_REF,
    idempotency_key: "draft-pr-no-coordinator", action_request: request,
    pull_request_materialization: pullRequestMaterialization(),
  }, identity()), /nyra_continue_pull_request_coordinator_unavailable/);
});

test("draft PR materialization is digest-bound and rejected before claim or Core on drift", async () => {
  const request = pullRequestRequest();
  const store = fakeStore(actionRecord({ action_class: "PULL_REQUEST_OPEN" }));
  const callbacks = [];
  const handler = createNyraGovernedContinueHandler({
    store,
    readDirectiveContext: async () => ({
      available: true, work_id: WORK_ID, project_id: "nyra_core", work_revision: 7,
      intent_digest: SECRET_DIGEST, context_digest: CONTEXT_DIGEST, status: "ACTIVE",
    }),
    normalizeDirectiveContext: (value) => value,
    issueDelegation: async () => { callbacks.push("delegation"); },
    authorizeAction: async () => { callbacks.push("authorize"); },
    reviewWorkBootstrap: async () => { callbacks.push("review"); },
    createWorkBootstrap: async () => { callbacks.push("create"); },
    coordinatePullRequest: async () => { callbacks.push("coordinate"); },
  });
  await assert.rejects(handler({
    operation: "authorize_action",
    continuation_ref: CONTINUATION_REF,
    idempotency_key: "draft-pr-materialization-drift",
    action_request: request,
    pull_request_materialization: {
      ...pullRequestMaterialization(),
      title: "tampered title",
    },
  }, identity()), /nyra_continue_pull_request_materialization_invalid/);
  assert.deepEqual(store.calls, []);
  assert.deepEqual(callbacks, []);
});
