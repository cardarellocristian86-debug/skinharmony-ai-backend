import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { createAgentPresence } from "../src/agent-presence.js";
import { createCoreHandlers } from "../src/core-handlers.js";
import {
  createWorkContinuityV2Store,
  deriveAuthenticatedTenantWorkAcl,
} from "../src/work-continuity-v2-store.js";
import { WORK_CONTINUITY_V2_SCHEMA_SQL } from "../src/work-continuity-v2.js";
import {
  buildHostNativeWorkPlan,
  createHostNativeGovernance,
  createInMemoryHostNativeGovernanceStore,
  hostNativeDigest,
} from "../../universal-core-service/src/hostNativeGovernance.js";

const H = (value) => String(value).repeat(64);
const WORK_ID = "22222222-2222-4222-8222-222222222222";
const WORK_DIGEST = H("4");
const CLOSURE_SECRET = "precommit-edge-closure-attestation-secret-at-least-32-bytes";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function identity() {
  const authenticatedHostPrincipal = {
    schema_version: "authenticated_host_principal_v1", registered: true,
    registry_revision: H("a"), app_id: "chatgpt_prod", host_kind: "chatgpt_native",
    client_type: "chatgpt",
  };
  const presence = createAgentPresence({
    agentSignatureSecret: "precommit-lifecycle-edge-presence-secret".repeat(2),
    agentPresenceSignatureVersion: "v2",
  }, { tenantId: "tenant-a", kind: "oauth", subject: "auth0|owner", authenticatedHostPrincipal }, {
    agent_id: "edge-agent", client_type: "chatgpt", session_id: "edge-session",
  });
  return {
    tenantId: "tenant-a", kind: "oauth", subject: "auth0|owner", role: "tenant_owner",
    oauthOwnerElevated: true, ownerConfirmed: true, confirmationReference: "bounded test release",
    authenticatedHostPrincipal,
    agentPresence: { ...presence, transport_bound: true, session_id: "edge-session",
      host_transport_session_fingerprint: H("8") },
  };
}

function intentBinding(workId = WORK_ID, intentAnchorDigest = WORK_DIGEST) {
  const instant = new Date().toISOString();
  const unsigned = {
    schema_version: "standing_release_intent_binding_v1",
    source: "mcp_work_continuity_postgres", tenant_id: "tenant-a", work_id: workId,
    project_id: "edge-project", work_status: "active", current_version: 1,
    work_updated_at: instant, intent_anchor_schema_version: "intent_anchor_v1",
    intent_anchor_immutable: true, intent_anchor_digest: intentAnchorDigest,
    intent_anchor_created_at: instant, verified_at: instant, provider_execution: false,
  };
  return { ...unsigned, binding_digest: canonicalDigest(unsigned) };
}

function trustedResolver(resolver) {
  Object.defineProperty(resolver, "trusted", { value: true });
  return resolver;
}

function lease(actor) {
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  return {
    schema_version: "dtt_work_lease_binding_v1", tenant_id: actor.tenantId, work_id: WORK_ID,
    lease_id: "33333333-3333-4333-8333-333333333333", expires_at: expiresAt,
    participant_expires_at: expiresAt, session_id: actor.agentPresence.session_id,
    agent_id: actor.agentPresence.agent_id, client_type: actor.agentPresence.client_type,
    session_fingerprint: actor.agentPresence.session_fingerprint,
    host_transport_session_fingerprint: actor.agentPresence.host_transport_session_fingerprint,
    presence_signature: actor.agentPresence.signature, opaque_agent_id: actor.agentPresence.opaque_agent_id,
    actor_provenance: actor.agentPresence.actor_provenance, execution_authorized: false,
  };
}

function handlerConfig(extra = {}) {
  return {
    universalCoreUrl: "https://core.test", githubStandingReleaseWorkerUrl: "https://worker.test",
    universalCoreKeys: { "tenant-a": "tenant-core-key" },
    tenantGatewayKey: "precommit-lifecycle-edge-gateway-key",
    tenantContextSigningSecret: "precommit-lifecycle-edge-tenant-secret-at-least-32-bytes",
    ownerContextSigningSecret: "precommit-lifecycle-edge-owner-secret-at-least-32-bytes",
    dttAgentIdentitySigningSecret: "precommit-lifecycle-edge-dtt-secret-at-least-32-bytes",
    ...extra,
  };
}

function runArgs(overrides = {}) {
  return {
    run_id: `srr_${"a".repeat(40)}`, work_id: WORK_ID, intent_anchor_digest: WORK_DIGEST,
    ticket_id: `hnt_${"b".repeat(40)}`, expected_version: 2,
    reservation_id: `hnr_${"c".repeat(40)}`, idempotency_key: "edge-run-lifecycle",
    ...overrides,
  };
}

function coreRecord(ticketId, state = "completed", action = { kind: "github.ready" }) {
  return {
    state, reservation_id: `hnr_${"c".repeat(40)}`,
    ticket: { ticket_id: ticketId, tenant_id: "tenant-a", work_id: WORK_ID, action },
  };
}

test("standing-release direct reserve, completion, reconciliation, and quarantine settle synchronously", async () => {
  const settled = [];
  const ticketId = runArgs().ticket_id;
  const actor = identity();
  let readCount = 0;
  const handlers = createCoreHandlers(handlerConfig(), {
    resolveStandingReleaseIntentBinding: trustedResolver(async () => intentBinding()),
    resolveDttWorkBinding: async (actor) => lease(actor),
    settlePrecommitEffectLifecycle: async (actor, input) => settled.push({ actor, input }),
    fetchImpl: async (url, init = {}) => {
      const path = new URL(url).pathname;
      if ((init.method || "GET") === "GET") {
        readCount += 1;
        return new Response(JSON.stringify({ ok: true, tenant_id: "tenant-a",
          action_ticket: trustedActionReadback(ticketId, actor,
            readCount === 1 ? "reserved" : "reconciliation_required"),
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const state = path.endsWith("/reserve") ? "reserved"
        : path.endsWith("/reconcile") ? "reconciled"
          : path.endsWith("/quarantine-expired") ? "quarantined" : "completed";
      return new Response(JSON.stringify({ ok: true, tenant_id: "tenant-a",
        action_ticket: coreRecord(ticketId, state) }), {
      status: 200, headers: { "content-type": "application/json" },
      });
    },
  });
  await handlers.host_native_standing_release_run_reserve(runArgs(), actor);
  await handlers.host_native_standing_release_run_complete({ ...runArgs(), outcome: "success",
    result_digest: H("1"), result_commit: "d".repeat(40) }, actor);
  await handlers.host_native_standing_release_run_reconcile({ ...runArgs(), observed_outcome: "success",
    readback_digest: H("2"), observed_commit: "d".repeat(40) }, actor);
  await handlers.host_native_standing_release_run_quarantine_expired(runArgs(), actor);
  assert.deepEqual(settled.map(({ actor: settledActor, input }) => [
    settledActor.tenantId, input.server_owned, input.core_record.state, input.core_record.ticket.ticket_id,
  ]), [
    ["tenant-a", true, "reserved", ticketId],
    ["tenant-a", true, "reserved", ticketId],
    ["tenant-a", true, "completed", ticketId],
    ["tenant-a", true, "reconciliation_required", ticketId],
    ["tenant-a", true, "reconciled", ticketId],
    ["tenant-a", true, "reconciliation_required", ticketId],
    ["tenant-a", true, "quarantined", ticketId],
  ]);
});

test("standing-release automatic coordinator settles reserve, unknown marker, and reconciliation", async () => {
  const settled = [];
  const args = runArgs({ idempotency_key: "edge-automatic-lifecycle" });
  const claim = {
    schema_version: "github_worker_execution_claim_v1", tenant_id: "tenant-a", work_id: WORK_ID,
    repository: "owner/repo", ticket_id: args.ticket_id, reservation_id: args.reservation_id,
    action: { kind: "github.ready", head_commit: "d".repeat(40) }, action_digest: H("3"),
    issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
    nonce: H("4"), provider_execution: false, signature: `gwe_${H("5")}`,
  };
  const handlers = createCoreHandlers(handlerConfig({ standingReleaseAutoCoordinatorEnabled: true }), {
    resolveStandingReleaseIntentBinding: trustedResolver(async () => intentBinding()),
    resolveDttWorkBinding: async (actor) => lease(actor),
    settlePrecommitEffectLifecycle: async (_actor, input) => settled.push(input),
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (url === "https://worker.test/v1/execute") return new Response(JSON.stringify({
        ok: true, provider_execution: true, execution: {
          schema_version: "github_worker_execution_record_v1", state: "succeeded", tenant_id: "tenant-a",
          repository: "owner/repo", ticket_id: args.ticket_id, reservation_id: args.reservation_id,
          action_digest: claim.action_digest, nonce: claim.nonce, claim_digest: canonicalDigest(claim),
          result: { outcome: "success", result_pull_request: 42 }, signature: `gwl_${H("6")}`,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
      const state = path.endsWith("/reserve") ? "reserved"
        : path.endsWith("/complete") ? "reconciliation_required" : "reconciled";
      return new Response(JSON.stringify({ ok: true, tenant_id: "tenant-a",
        action_ticket: coreRecord(args.ticket_id, state, claim.action),
        ...(path.endsWith("/reserve") ? { github_execution_claim: claim } : {}),
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await handlers.host_native_standing_release_run_reserve(args, identity());
  assert.deepEqual(settled.map((entry) => entry.core_record.state), [
    "reserved", "reconciliation_required", "reconciled",
  ]);
  assert(settled.every((entry) => entry.server_owned === true));
});

function commitAction() {
  return {
    kind: "git.commit", repository: "owner/repo", branch: "agent/edge",
    parent_commit: "1".repeat(40), tree_sha: "2".repeat(40), diff_digest: H("2"),
    changed_files: ["services/example.js"], message_digest: H("3"), builder_agent_id: "builder",
    provider_execution: false,
  };
}

function nativeClaim(input, replay) {
  const claim = {
    schema_version: "native_precommit_claim_attestation_v1",
    claim_id: "11111111-1111-4111-8111-111111111111", claim_digest: "", claim_replay: replay,
    gate_projection_digest: input.evidence_digest, continuation_ref: "edge-continuation",
    request_digest: H("b"), tenant_id: input.tenant_id, work_id: input.work_id,
    intent_anchor_digest: input.intent_anchor_digest, delegation_id: input.delegation_id,
    repository: input.repository, action_digest: hostNativeDigest(input.action),
    evidence_digest: input.evidence_digest, host_session_fingerprint: input.host_session_fingerprint,
    idempotency_key: input.idempotency_key,
  };
  claim.claim_digest = hostNativeDigest({
    schema_version: "precommit_ticket_gate_claim_v1", claim_id: claim.claim_id,
    work_id: claim.work_id, continuation_ref: claim.continuation_ref,
    request_digest: claim.request_digest, delegation_id: claim.delegation_id,
    action_digest: claim.action_digest, gate_projection_digest: claim.gate_projection_digest,
    host_session_fingerprint: claim.host_session_fingerprint, idempotency_key: claim.idempotency_key,
    replay,
  });
  return claim;
}

test("expired same-kind native ticket supersession converges on one successor and records its predecessor", async () => {
  let clock = Date.parse("2026-09-24T10:00:00.000Z");
  let sequence = 0;
  const governance = createHostNativeGovernance({
    store: createInMemoryHostNativeGovernanceStore(), signingSecret: "precommit-edge-signing-secret-at-least-32-bytes",
    closureAttestationSigningSecret: CLOSURE_SECRET, now: () => clock,
    idFactory: () => `edge-${++sequence}`, ticketTtlMs: 60_000,
  });
  const delegation = await governance.issueDelegation({
    tenant_id: "tenant-a", work_id: WORK_ID, intent_anchor_digest: WORK_DIGEST, repository: "owner/repo",
    owner_confirmation: { verified: true, request_bound: true, owner_subject_fingerprint: `osf_${H("a")}`,
      consent_nonce: "edge-owner-consent", confirmation_reference: "edge test" },
    audience: ["codex_native"], allowed_branches: ["agent/*"], protected_branches: ["main"],
    allowed_path_prefixes: ["services"], allowed_actions: ["git.commit"],
    budget: { max_agents: 1, max_parallel: 1, max_commits: 2, max_pushes: 1, max_deploys: 1,
      max_total_actions: 2 },
    release_policy: { manifest_required_for_protected_push: true, manifest_required_for_induced_deploy: true,
      manifest_required_for_deploy: true, independent_verifier_required: true, rollback_required: true,
      required_checks: ["unit-tests"] },
    expires_at: new Date(clock + 30 * 60_000).toISOString(), idempotency_key: "edge-delegation",
  });
  const input = {
    tenant_id: "tenant-a", delegation_id: delegation.delegation_id, work_id: WORK_ID,
    intent_anchor_digest: WORK_DIGEST, repository: "owner/repo", host_kind: "codex_native",
    host_session_fingerprint: "edge-native-session", action: commitAction(), evidence_digest: H("9"),
    idempotency_key: "edge-expired-same-kind",
  };
  const first = await governance.issueActionTicket(input, { native_precommit_claim: nativeClaim(input, false) });
  clock += 60_001;
  const successor = await governance.issueActionTicket(input, { native_precommit_claim: nativeClaim(input, true) });
  const converged = await governance.issueActionTicket(input, { native_precommit_claim: nativeClaim(input, true) });
  const predecessor = await governance.readActionTicket({ tenant_id: "tenant-a", ticket_id: first.ticket.ticket_id });
  assert.notEqual(successor.ticket.ticket_id, first.ticket.ticket_id);
  assert.equal(converged.ticket.ticket_id, successor.ticket.ticket_id);
  assert.equal(successor.ticket.native_precommit_predecessor.ticket_id, first.ticket.ticket_id);
  assert.equal(predecessor.state, "superseded");
  assert.equal(predecessor.superseded_by_ticket_id, successor.ticket.ticket_id);
});

class ManualObservationSettlementPool {
  constructor() {
    this.settlements = [];
    this.events = [];
    this.work = {
      tenant_id: "tenant-a", work_id: WORK_ID, legacy_work_id: WORK_ID,
      work_code: "EDGE-1", work_name: "Edge settlement", work_type: "software_git",
      project_id: "edge", owner_user_id: "owner", created_by_user_id: "owner",
      assigned_user_ids: [], supervising_user_ids: [], agent_ids: [], visibility_scope: "private",
      status: "ACTIVE", priority: "P2", priority_score: 300, progress_bp: 0,
      acceptance_criteria: ["terminal observation"], intent_digest: H("1"),
    };
    this.root = {
      claim_id: "11111111-1111-4111-8111-111111111111", gate_projection_digest: H("7"),
      root_ticket_id: `hnt_${"a".repeat(40)}`,
    };
  }
  async query(sql, parameters = []) {
    const q = String(typeof sql === "string" ? sql : sql.text).replace(/\s+/g, " ").trim();
    // Schema initialization is intentionally opaque to this behavioural fake.
    if (q.includes("CREATE TABLE IF NOT EXISTS tenant_work")) return { rows: [], rowCount: 0 };
    if (q.startsWith("SELECT c.claim_id,c.gate_projection_digest, f.ticket_id AS root_ticket_id") ||
        q.startsWith("SELECT c.claim_id,c.gate_projection_digest,f.ticket_id AS root_ticket_id")) {
      if (q.includes("f.ticket_id=$3")) {
        return parameters[2] === this.root.root_ticket_id
          ? { rows: [this.root], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (q.includes("governed_precommit_phase='POST_DEPLOY'")) {
        return { rows: [this.root], rowCount: 1 };
      }
    }
    if (q.startsWith("SELECT * FROM tenant_work WHERE")) {
      return { rows: [structuredClone(this.work)], rowCount: 1 };
    }
    if (q.startsWith("SELECT * FROM tenant_work_precommit_effect_settlement")) {
      return { rows: [], rowCount: 0 };
    }
    if (q.startsWith("INSERT INTO tenant_work_precommit_effect_settlement")) {
      this.settlements.push({ query: q, parameters: [...parameters] });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT sequence_number,event_hash FROM tenant_work_event")) {
      return { rows: [], rowCount: 0 };
    }
    if (q.startsWith("INSERT INTO tenant_work_event")) {
      this.events.push({ parameters: [...parameters] });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`manual_observation_settlement_query_unhandled:${q}`);
  }
}

function settlementIdentity() {
  const base = {
    tenantId: "tenant-a", subject: "owner", userId: "owner",
    agentPresence: { agent_id: "edge-agent", session_fingerprint: H("b") },
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1", authenticated: true, tenant_id: "tenant-a",
      subject: "owner", role: "tenant_owner", expires_at: "2030-01-01T00:00:00.000Z",
      team_ids: [], managed_team_ids: [], assigned_work_ids: [],
    },
  };
  return { ...base, tenant_work_acl: deriveAuthenticatedTenantWorkAcl(base, Date.now()) };
}

test("manual merge render.observe resolves the sole POST_DEPLOY claim without a predecessor ticket", async () => {
  const pool = new ManualObservationSettlementPool();
  const store = createWorkContinuityV2Store({ pool });
  const observationTicketId = `hnt_${"c".repeat(40)}`;
  const record = {
    state: "reconciled", uses: 1, reservation_id: `hnr_${"d".repeat(40)}`,
    lifecycle_digest: H("e"), lifecycle_signature: `hnl_${"f".repeat(32)}`,
    ticket: {
      schema_version: "host_native_action_ticket_v1", ticket_id: observationTicketId,
      tenant_id: "tenant-a", work_id: WORK_ID, action: { kind: "render.observe" },
      provider_execution: false, host_policy_override: false, host_policy_must_allow: true,
      signature: `hnt_${"1".repeat(64)}`,
      predecessor: { schema_version: "host_native_owner_manual_merge_predecessor_v2",
        predecessor_type: "owner_manual_github_merge_readback",
        manual_merge_readback_id: `hnmmr_${"2".repeat(40)}`,
        manual_merge_readback_digest: H("3") },
    },
  };
  const settled = await store.settlePrecommitEffectLifecycle(settlementIdentity(), {
    server_owned: true, settlement_source: "core_terminal_readback", core_record: record,
  });
  assert.equal(settled.applicable, true);
  assert.equal(settled.claim_id, pool.root.claim_id);
  assert.equal(settled.root_ticket_id, pool.root.root_ticket_id);
  assert.equal(settled.predecessor_ticket_id, pool.root.root_ticket_id);
  assert.equal(settled.lineage_kind, "manual_merge");
  assert.equal(settled.settlement_source, "core_terminal_readback");
  assert.equal(pool.settlements.length, 1);
  assert.equal(pool.settlements[0].parameters[6], pool.root.root_ticket_id);
});

test("historical fulfillment recovery ignores issuance and forwards terminal revocation idempotently", async () => {
  const settled = [];
  let state = "issued";
  const ticketId = `hnt_${"f".repeat(40)}`;
  const handlers = createCoreHandlers(handlerConfig(), {
    settlePrecommitEffectLifecycle: async (_actor, input) => settled.push(input),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, tenant_id: "tenant-a",
      action_ticket: coreRecord(ticketId, state, { kind: "render.observe" }),
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const actor = identity();
  await handlers.host_native_action_read({ ticket_id: ticketId }, actor);
  assert.equal(settled.length, 0, "issuance is not evidence of a post-deploy effect");
  state = "revoked";
  await handlers.host_native_action_read({ ticket_id: ticketId }, actor);
  await handlers.host_native_action_read({ ticket_id: ticketId }, actor);
  assert.deepEqual(settled.map((entry) => [entry.server_owned, entry.settlement_source,
    entry.core_record.state]), [
    [true, "core_terminal_readback", "revoked"],
    [true, "core_terminal_readback", "revoked"],
  ]);
});

test("revoked root ticket recovery is terminal without treating fulfillment as effect", async () => {
  const pool = new ManualObservationSettlementPool();
  const store = createWorkContinuityV2Store({ pool });
  const record = {
    state: "revoked", uses: 0, reservation_id: null,
    ticket: {
      schema_version: "host_native_action_ticket_v1", ticket_id: pool.root.root_ticket_id,
      tenant_id: "tenant-a", work_id: WORK_ID, action: { kind: "git.commit" },
      provider_execution: false, host_policy_override: false, host_policy_must_allow: true,
      signature: `hnt_${"4".repeat(64)}`,
    },
  };
  const settled = await store.settlePrecommitEffectLifecycle(settlementIdentity(), {
    server_owned: true, settlement_source: "core_terminal_readback", core_record: record,
  });
  assert.equal(settled.applicable, true);
  assert.equal(settled.lifecycle_state, "revoked");
  assert.equal(settled.terminal, true);
  assert.equal(settled.effect_unknown, true);
  assert.equal(settled.settlement_source, "core_terminal_readback");
  assert.equal(pool.settlements.length, 1);
});

test("scope-freeze upgrade validates phase and paired digest/revision constraints", () => {
  const upgrade = WORK_CONTINUITY_V2_SCHEMA_SQL;
  for (const [name, expression] of [
    ["phase", /governed_precommit_phase IN \('POST_COMMIT','POST_DEPLOY'\)/],
    ["task contract pairing", /\(task_contract_digest IS NULL\)=\(task_contract_revision IS NULL\)/],
    ["task contract revision", /task_contract_revision IS NULL OR task_contract_revision>0/],
    ["dependency pairing", /\(dependency_manifest_digest IS NULL\)=\(dependency_manifest_revision IS NULL\)/],
    ["dependency revision", /dependency_manifest_revision IS NULL OR dependency_manifest_revision>0/],
  ]) {
    assert.match(upgrade, expression, name);
  }
  assert.match(upgrade,
    /'tw_precommit_freeze_phase_ck'[\s\S]*ADD CONSTRAINT %I CHECK \(%s\) NOT VALID[\s\S]*VALIDATE CONSTRAINT tw_precommit_freeze_phase_ck/,
    "pre-upgrade phase rows are checked after the additive constraint is installed");
  assert.match(upgrade,
    /tw_precommit_freeze_task_contract_pair_ck[\s\S]*ADD CONSTRAINT %I CHECK \(%s\) NOT VALID[\s\S]*VALIDATE CONSTRAINT tw_precommit_freeze_task_contract_pair_ck/,
    "old rows cannot bypass the new task-contract pairing check");
  assert.match(upgrade,
    /tw_precommit_freeze_dependency_manifest_revision_ck[\s\S]*ADD CONSTRAINT %I CHECK \(%s\) NOT VALID[\s\S]*VALIDATE CONSTRAINT tw_precommit_freeze_dependency_manifest_revision_ck/,
    "old rows cannot bypass the dependency revision check");
});

test("terminal phase settlement is evaluated before the historical release freeze", () => {
  const schema = WORK_CONTINUITY_V2_SCHEMA_SQL;
  const functionStart = schema.indexOf(
    "CREATE OR REPLACE FUNCTION tenant_work_task_advance_revision()",
  );
  const functionEnd = schema.indexOf("$$ LANGUAGE plpgsql;", functionStart);
  const triggerFunction = schema.slice(functionStart, functionEnd);
  const settlementAuthorization = triggerFunction.indexOf(
    "INTO deferred_settlement_authorized",
  );
  const historicalReleaseFreeze = triggerFunction.indexOf(
    "to_regclass('public.core_continuity_release_joins')",
  );
  assert.ok(settlementAuthorization > 0 && historicalReleaseFreeze > settlementAuthorization,
    "the exact settlement exception must be known before the release-join freeze runs");
  assert.match(triggerFunction,
    /release_frozen AND NOT precommit_completion_authorized AND\s+NOT deferred_settlement_authorized/);
  assert.match(triggerFunction,
    /governed_precommit_phase=''POST_DEPLOY'' AND s\.action_kind IN\s+\(''render\.deploy'',''render\.promote'',''render\.rollback'',''render\.observe''\)/);
});

test("Universal Core accepts UUIDv7/v8 deferred task IDs and rejects non-UUID variants", () => {
  const plan = (taskId) => buildHostNativeWorkPlan({
    tenant_id: "tenant-a", work_id: WORK_ID, intent_anchor_digest: WORK_DIGEST,
    repository: "owner/repo", objective: "Validate deferred task identity.",
    required_checks: ["unit-tests"], precommit_deferred_v2_tasks: [
      { task_id: taskId, phase: "POST_DEPLOY" },
    ],
    agents: [
      { agent_id: "builder", role: "builder", task: "Build.", depends_on: [], capabilities: [] },
      { agent_id: "verifier", role: "verifier", task: "Verify.", depends_on: ["builder"], capabilities: [] },
    ],
  });
  const uuidV7 = "018f2f70-7c2a-7b5a-8b8c-0123456789ab";
  const uuidV8 = "018f2f70-8c2a-8b5a-8b8c-0123456789ab";
  assert.equal(plan(uuidV7).precommit_deferred_v2_tasks[0].task_id, uuidV7);
  assert.equal(plan(uuidV8).precommit_deferred_v2_tasks[0].task_id, uuidV8);
  for (const invalid of [
    "018f2f70-0c2a-0b5a-8b8c-0123456789ab",
    "018f2f70-7c2a-7b5a-7b8c-0123456789ab",
    "not-a-uuid",
  ]) {
    assert.throws(() => plan(invalid), /precommit_deferred_v2_tasks_invalid/);
  }
});

function trustedActionReadback(ticketId, actor, state) {
  return {
    state, uses: 1, reservation_id: `hnr_${"d".repeat(40)}`,
    ticket: {
      schema_version: "host_native_action_ticket_v1", tenant_id: "tenant-a", ticket_id: ticketId,
      delegation_id: `hnd_${"e".repeat(40)}`, work_id: WORK_ID, intent_anchor_digest: WORK_DIGEST,
      repository: "owner/repo", host_kind: "chatgpt_native",
      host_session_fingerprint: actor.agentPresence.session_fingerprint,
      action: { kind: "github.ready" }, evidence_digest: H("f"),
      issued_at: "2026-09-24T10:00:00.000Z", expires_at: "2026-09-24T11:00:00.000Z",
      max_uses: 1, provider_execution: false, host_policy_override: false,
      host_policy_must_allow: true, signature: `hnt_${"1".repeat(64)}`,
    },
  };
}

function transitionArgs(kind, ticketId, reservationId) {
  const common = { ticket_id: ticketId, reservation_id: reservationId };
  if (kind === "complete") return { ...common, outcome: "success", result_digest: H("2"),
    result_commit: "3".repeat(40), idempotency_key: "edge-direct-complete" };
  if (kind === "reconcile") return { ...common, observed_outcome: "success", readback_digest: H("4"),
    observed_commit: "3".repeat(40), idempotency_key: "edge-direct-reconcile" };
  return { ...common, readback_digest: H("5"), idempotency_key: "edge-direct-quarantine" };
}

test("direct and standing transitions seed a trusted readback before mutating pre-upgrade lifecycles", async (t) => {
  const variants = [
    { kind: "complete", seedState: "reserved", terminalState: "completed" },
    { kind: "reconcile", seedState: "reconciliation_required", terminalState: "reconciled" },
    { kind: "quarantine", seedState: "reconciliation_required", terminalState: "quarantined" },
  ];
  for (const surface of ["direct", "standing"]) {
    for (const variant of variants) await t.test(`${surface} ${variant.kind}`, async () => {
      const actor = identity();
      const ticketId = `hnt_${`${surface[0]}${variant.kind[0]}`.repeat(40)}`;
      const reservationId = `hnr_${"d".repeat(40)}`;
      const calls = [];
      const settlements = [];
      const handlers = createCoreHandlers(handlerConfig(), {
        resolveStandingReleaseIntentBinding: trustedResolver(async () => intentBinding()),
        resolveDttWorkBinding: async (boundActor) => lease(boundActor),
        settlePrecommitEffectLifecycle: async (_actor, input) => settlements.push(input),
        fetchImpl: async (url, init = {}) => {
          const path = new URL(url).pathname;
          calls.push([init.method || "GET", path]);
          if ((init.method || "GET") === "GET") return new Response(JSON.stringify({ ok: true,
            tenant_id: "tenant-a", action_ticket: trustedActionReadback(ticketId, actor, variant.seedState),
          }), { status: 200, headers: { "content-type": "application/json" } });
          return new Response(JSON.stringify({ ok: true, tenant_id: "tenant-a",
            action_ticket: coreRecord(ticketId, variant.terminalState),
          }), { status: 200, headers: { "content-type": "application/json" } });
        },
      });
      if (surface === "direct") {
        await handlers[`host_native_action_${variant.kind === "quarantine" ? "quarantine_expired" : variant.kind}`](
          transitionArgs(variant.kind, ticketId, reservationId), actor,
        );
      } else {
        const args = { ...runArgs({ ticket_id: ticketId, reservation_id: reservationId,
          idempotency_key: `edge-standing-${variant.kind}` }),
          ...transitionArgs(variant.kind, ticketId, reservationId) };
        await handlers[`host_native_standing_release_run_${variant.kind === "quarantine"
          ? "quarantine_expired" : variant.kind}`](args, actor);
      }
      assert.equal(calls[0][0], "GET");
      assert.equal(calls[1][0], "POST");
      assert.deepEqual(settlements.map((entry) => [entry.settlement_source, entry.core_record.state]), [
        ["core_terminal_readback", variant.seedState],
        ["lifecycle_transition", variant.terminalState],
      ]);
    });
  }
});

test("a failed pre-upgrade seed sends no direct or standing transition POST", async (t) => {
  const variants = ["complete", "reconcile", "quarantine"];
  for (const surface of ["direct", "standing"]) {
    for (const kind of variants) await t.test(`${surface} ${kind}`, async () => {
      const actor = identity();
      const ticketId = `hnt_${`${surface[0]}${kind[0]}`.repeat(40)}`;
      const reservationId = `hnr_${"d".repeat(40)}`;
      const calls = [];
      const seedState = kind === "complete" ? "reserved" : "reconciliation_required";
      const handlers = createCoreHandlers(handlerConfig(), {
        resolveStandingReleaseIntentBinding: trustedResolver(async () => intentBinding()),
        resolveDttWorkBinding: async (boundActor) => lease(boundActor),
        settlePrecommitEffectLifecycle: async (_actor, input) => {
          if (input.settlement_source === "core_terminal_readback") throw new Error("edge_seed_failed");
        },
        fetchImpl: async (url, init = {}) => {
          calls.push([init.method || "GET", new URL(url).pathname]);
          return new Response(JSON.stringify({ ok: true, tenant_id: "tenant-a",
            action_ticket: trustedActionReadback(ticketId, actor, seedState),
          }), { status: 200, headers: { "content-type": "application/json" } });
        },
      });
      let invoke;
      if (surface === "direct") {
        invoke = () => handlers[`host_native_action_${kind === "quarantine"
          ? "quarantine_expired" : kind}`](transitionArgs(kind, ticketId, reservationId), actor);
      } else {
        invoke = () => handlers[`host_native_standing_release_run_${kind === "quarantine"
          ? "quarantine_expired" : kind}`]({
          ...runArgs({ ticket_id: ticketId, reservation_id: reservationId,
            idempotency_key: `edge-standing-failed-${kind}` }),
          ...transitionArgs(kind, ticketId, reservationId),
        }, actor);
      }
      await assert.rejects(invoke, /edge_seed_failed/);
      assert.deepEqual(calls.map(([method]) => method), ["GET"]);
    });
  }
});
