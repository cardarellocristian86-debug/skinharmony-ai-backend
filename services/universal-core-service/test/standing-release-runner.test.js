import assert from "node:assert/strict";
import test from "node:test";

import {
  STANDING_RELEASE_ADAPTER_LANES,
  advanceStandingReleaseRun,
  bindStandingReleaseRunTicket,
  cancelStandingReleaseRun,
  createStandingReleaseRun,
  quarantineExpiredStandingReleaseRun,
} from "../src/standingReleaseRunner.js";

const H = (character) => character.repeat(64);
const G = (character) => character.repeat(40);
const WORK = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-08-14T10:00:00.000Z");
const FILES = ["services/example/src/index.js", "services/example/test/index.test.js"];
const SERVICES = [
  { service_id: "api", environment: "production", health_contract_digest: H("a") },
  { service_id: "worker", environment: "production", health_contract_digest: H("b") },
];

function input(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    work_id: WORK,
    intent_anchor_digest: H("1"),
    mandate_id: "srm_1234567890123456789012345678901234567890",
    mandate_digest: H("2"),
    mandate_revision: 1,
    revocation_epoch: 0,
    delegation_id: "hnd_delegation-12345678",
    repository: "owner/repo",
    base_branch: "main",
    delivery_branch: "agent/release-1",
    base_commit: G("1"),
    changed_files: FILES,
    services: SERVICES,
    host_kind: "codex_native",
    host_session_fingerprint: "9".repeat(16),
    max_repair_attempts: 2,
    ...overrides,
  };
}

let sequence = 0;
function issued(action, overrides = {}) {
  sequence += 1;
  const ticket = {
    schema_version: "host_native_action_ticket_v1",
    ticket_id: `hnt_ticket-${String(sequence).padStart(8, "0")}`,
    delegation_id: "hnd_delegation-12345678",
    tenant_id: "tenant-a",
    work_id: WORK,
    intent_anchor_digest: H("1"),
    repository: "owner/repo",
    host_kind: "codex_native",
    host_session_fingerprint: "9".repeat(16),
    action,
    evidence_digest: H("e"),
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    max_uses: 1,
    host_policy_override: false,
    host_policy_must_allow: true,
    provider_execution: false,
    signature: `hnt_${H("f")}`,
    ...overrides.ticket,
  };
  return { state: "issued", uses: 0, ticket, ...overrides.record };
}

function completed(record, result = {}) {
  return {
    ...record,
    state: "completed",
    uses: 1,
    outcome: "success",
    result_digest: H("d"),
    result_commit_verified: false,
    completed_at: new Date(NOW + 1_000).toISOString(),
    ...result,
  };
}

function finalizedObservation(record, mergeCommit, liveServices = SERVICES) {
  return completed(record, {
    result_commit: null,
    finalize_authorization: {
      schema_version: "host_native_finalize_authorization_v1",
      trusted: true,
      allowed: true,
      decision: "ALLOW_FINALIZE",
      decision_id: record.ticket.ticket_id,
      tenant_id: "tenant-a",
      work_id: WORK,
      repository: "owner/repo",
      target_commit: mergeCommit,
      action_ticket_id: record.ticket.ticket_id,
      action_ticket_digest: H("a"),
      release_manifest_digest: record.ticket.action.release_manifest_digest,
      host_kind: "codex_native",
      host_session_fingerprint: "9".repeat(16),
      result_commit_verified: true,
      verification_scope: "full_release",
      services_verified: true,
      live_services: liveServices.map((service, index) => ({
        service_id: service.service_id,
        environment: service.environment,
        live_commit: mergeCommit,
        health_status: "healthy",
        health_contract_digest: service.health_contract_digest,
        readback_digest: index === 0 ? H("c") : H("d"),
      })),
      host_policy_override: false,
      host_policy_must_allow: true,
      external_execution_allowed: false,
      host_execution_required: true,
      provider_execution: false,
      authorization_digest: H("e"),
      signature: `hnf_${H("f")}`,
    },
  });
}

function bind(run, record, step = 0) {
  return bindStandingReleaseRunTicket(run, record, {
    expected_version: run.version,
    now: NOW + step,
  });
}

function advance(run, record, step = 0) {
  return advanceStandingReleaseRun(run, record, {
    expected_version: run.version,
    now: NOW + step,
  });
}

function commitAction(parent, tree, repair = false) {
  return {
    kind: "git.commit",
    repository: "owner/repo",
    branch: "agent/release-1",
    parent_commit: parent,
    tree_sha: tree,
    diff_digest: H("3"),
    changed_files: FILES,
    message_digest: H("4"),
    builder_agent_id: "builder",
    ...(repair ? {
      repair_class: "deterministic_test",
      failed_check: "unit-tests",
      failure_evidence_digest: H("5"),
    } : {}),
    provider_execution: false,
  };
}

function pushAction(head, remote) {
  return {
    kind: "git.push.branch",
    repository: "owner/repo",
    branch: "agent/release-1",
    source_commit: head,
    expected_remote_commit: remote,
    changed_files: FILES,
    force: false,
    delete_ref: false,
    tags: false,
    induced_effects: [],
    provider_execution: false,
  };
}

function draftAction(head) {
  return {
    kind: "github.draft_pr",
    repository: "owner/repo",
    head_branch: "agent/release-1",
    base_branch: "main",
    head_commit: head,
    expected_base_commit: G("1"),
    changed_files: FILES,
    title_digest: H("6"),
    body_digest: H("7"),
    draft: true,
    force: false,
    delete_ref: false,
    tags: false,
    provider_execution: false,
  };
}

function readyAction(head, pullRequest, originDraftTicketId) {
  return {
    kind: "github.ready",
    repository: "owner/repo",
    head_branch: "agent/release-1",
    base_branch: "main",
    pull_request: pullRequest,
    head_commit: head,
    draft_before: true,
    ready_for_review: true,
    force: false,
    delete_ref: false,
    tags: false,
    ...(originDraftTicketId ? {
      expected_base_commit: G("1"),
      origin_draft_ticket_id: originDraftTicketId,
    } : {}),
    provider_execution: false,
  };
}

function mergeAction(head, pullRequest) {
  return {
    kind: "github.merge",
    repository: "owner/repo",
    head_branch: "agent/release-1",
    base_branch: "main",
    pull_request: pullRequest,
    head_commit: head,
    expected_base_commit: G("1"),
    merge_method: "merge",
    checks_verified: true,
    checks_commit: head,
    force: false,
    delete_ref: false,
    tags: false,
    induced_effects: SERVICES.map((service) => ({
      service_id: service.service_id,
      environment: service.environment,
      trigger: "github_auto_deploy",
    })),
    provider_execution: false,
  };
}

function observeAction(service, merge, mergeTicket) {
  return {
    kind: "render.observe",
    repository: "owner/repo",
    branch: "main",
    service_id: service.service_id,
    environment: service.environment,
    target_commit: merge,
    parent_release_ticket_id: mergeTicket,
    parent_release_ticket_digest: H("8"),
    release_manifest_digest: H("9"),
    provider_execution: false,
  };
}

function throughCiWait() {
  let run = createStandingReleaseRun(input(), { now: NOW });
  const commitTicket = issued(commitAction(G("1"), G("2")));
  run = advance(bind(run, commitTicket), completed(commitTicket, { result_commit: G("2") }));
  const pushTicket = issued(pushAction(G("2"), G("1")));
  run = advance(bind(run, pushTicket), completed(pushTicket, { result_commit: G("2") }));
  const draftTicket = issued(draftAction(G("2")));
  run = advance(bind(run, draftTicket), completed(draftTicket, { result_pull_request: 17 }));
  return { run, draftTicket };
}

test("happy path coordinates peer adapters and verifies every exact service", () => {
  let { run } = throughCiWait();
  assert.equal(run.state, "CI_WAIT");
  assert.equal(run.coordination_model, "horizontal_peer_adapters_v1");
  assert.deepEqual(run.adapter_lanes, STANDING_RELEASE_ADAPTER_LANES);
  assert.deepEqual(run.adapter_lanes.map(({ relationship }) => relationship), ["peer", "peer", "peer"]);
  assert.equal(run.provider_execution, false);
  assert.equal(run.connected_host_required, true);
  assert.equal(run.background_execution, false);

  const ready = issued(readyAction(G("2"), 17));
  run = advance(bind(run, ready), completed(ready));
  assert.equal(run.state, "MERGE_PENDING");
  assert.throws(() => bind(run, issued({
    ...mergeAction(G("2"), 17),
    induced_effects: [],
  })), /induced_effects_invalid/);
  const merge = issued(mergeAction(G("2"), 17));
  run = advance(bind(run, merge), completed(merge, { result_commit: G("3") }));
  assert.equal(run.state, "LIVE_VERIFY_PENDING");

  const observation = issued(observeAction(SERVICES[0], G("3"), merge.ticket.ticket_id));
  run = advance(bind(run, observation), finalizedObservation(observation, G("3")));
  assert.equal(run.state, "COMPLETED");
  assert.equal(run.observed_services.length, 2);
});

test("a signed native precommit replacement remains valid for the standing runner", () => {
  const run = createStandingReleaseRun(input(), { now: NOW });
  const predecessor = {
    schema_version: "native_precommit_ticket_predecessor_v1",
    ticket_id: "hnt_predecessor-00000001",
    ticket_digest: H("a"),
  };
  const replacement = issued(commitAction(G("1"), G("2")), {
    ticket: { native_precommit_predecessor: predecessor },
  });
  assert.equal(bind(run, replacement).state, "ACTION_IN_PROGRESS");
  assert.throws(() => bind(run, {
    ...replacement,
    ticket: {
      ...replacement.ticket,
      native_precommit_predecessor: { ...predecessor, ticket_digest: "invalid" },
    },
  }), /standing_release_ticket_predecessor_invalid/);
});

test("two bounded CI repairs are allowed and a third is quarantined", () => {
  let { run, draftTicket } = throughCiWait();
  let head = G("2");
  let remote = G("2");
  for (const nextHead of [G("3"), G("4")]) {
    const repair = issued(commitAction(head, nextHead, true));
    run = advance(bind(run, repair), completed(repair, { result_commit: nextHead }));
    const push = issued(pushAction(nextHead, remote));
    run = advance(bind(run, push), completed(push, { result_commit: nextHead }));
    head = nextHead;
    remote = nextHead;
  }
  assert.equal(run.state, "CI_WAIT");
  assert.equal(run.repair_attempts, 2);
  const readyWithoutOrigin = issued(readyAction(head, 17));
  assert.throws(() => bind(run, readyWithoutOrigin), /repair_origin_invalid/);
  const ready = issued(readyAction(head, 17, draftTicket.ticket.ticket_id));
  assert.equal(bind(run, ready).state, "ACTION_IN_PROGRESS");

  const third = issued(commitAction(head, G("5"), true));
  run = bind(run, third);
  assert.equal(run.state, "QUARANTINED");
  assert.match(run.terminal_reason_digest, /^[a-f0-9]{64}$/);
});

test("a ready pull request accepts bounded repairs and merges directly after CI recovers", () => {
  let { run } = throughCiWait();
  assert.equal(run.pull_request_ready, false);
  assert.throws(() => bind(run, issued(mergeAction(G("2"), 17))), /sequence_invalid/);

  const ready = issued(readyAction(G("2"), 17));
  run = advance(bind(run, ready), completed(ready));
  assert.equal(run.state, "MERGE_PENDING");
  assert.equal(run.pull_request_ready, true);

  let head = G("2");
  for (const nextHead of [G("3"), G("4")]) {
    const repair = issued(commitAction(head, nextHead, true));
    run = advance(bind(run, repair), completed(repair, { result_commit: nextHead }));
    assert.equal(run.state, "PUSH_PENDING");
    assert.equal(run.pull_request_ready, true);

    const push = issued(pushAction(nextHead, head));
    run = advance(bind(run, push), completed(push, { result_commit: nextHead }));
    assert.equal(run.state, "CI_WAIT");
    assert.equal(run.pull_request_ready, true);
    head = nextHead;
  }

  assert.throws(() => bind(run, issued(readyAction(head, 17))), /sequence_invalid/);
  assert.throws(() => bind(run, issued(mergeAction(G("3"), 17))), /head_mismatch/);
  const thirdRepair = bind(run, issued(commitAction(head, G("5"), true)));
  assert.equal(thirdRepair.state, "QUARANTINED");

  const merge = issued(mergeAction(head, 17));
  run = advance(bind(run, merge), completed(merge, { result_commit: G("6") }));
  assert.equal(run.state, "LIVE_VERIFY_PENDING");
  assert.equal(run.pull_request_ready, true);
});

test("ticket tenant, session, head and service must match the bound cone", () => {
  const base = createStandingReleaseRun(input(), { now: NOW });
  const initial = issued(commitAction(G("1"), G("2")));
  assert.throws(() => bind(base, {
    ...initial,
    ticket: { ...initial.ticket, tenant_id: "tenant-b" },
  }), /binding_mismatch/);
  assert.throws(() => bind(base, {
    ...initial,
    ticket: { ...initial.ticket, host_session_fingerprint: "8".repeat(16) },
  }), /binding_mismatch/);
  assert.throws(() => bind(base, issued(commitAction(G("7"), G("2")))), /sequence_invalid/);

  let { run } = throughCiWait();
  const ready = issued(readyAction(G("2"), 17));
  run = advance(bind(run, ready), completed(ready));
  const merge = issued(mergeAction(G("2"), 17));
  run = advance(bind(run, merge), completed(merge, { result_commit: G("3") }));
  const wrongService = issued(observeAction({ service_id: "other", environment: "production" }, G("3"), merge.ticket.ticket_id));
  assert.throws(() => bind(run, wrongService), /service_mismatch/);

  const observation = issued(observeAction(SERVICES[0], G("3"), merge.ticket.ticket_id));
  const active = bind(run, observation);
  assert.throws(() => advance(active, finalizedObservation(observation, G("3"), [SERVICES[0]])), /service_set_mismatch/);
});

test("unknown outcomes wait for reconciliation and failures block", () => {
  const run = createStandingReleaseRun(input(), { now: NOW });
  const ticket = issued(commitAction(G("1"), G("2")));
  const active = bind(run, ticket);
  const unknown = {
    ...ticket,
    state: "reconciliation_required",
    uses: 1,
    outcome: "unknown",
    result_digest: H("a"),
    reservation_id: "reservation-1",
    reservation_expires_at: new Date(NOW - 1).toISOString(),
  };
  assert.equal(advance(active, unknown), active);
  const reconciled = {
    ...unknown,
    state: "reconciled",
    observed_outcome: "success",
    observed_commit: G("2"),
    reconciled_at: new Date(NOW).toISOString(),
  };
  assert.equal(advance(active, reconciled).state, "PUSH_PENDING");
  const failed = completed(ticket, { outcome: "failure" });
  assert.equal(advance(active, failed).state, "BLOCKED");
});

test("duplicate binding is idempotent, replay and stale CAS fail closed", () => {
  let run = createStandingReleaseRun(input(), { now: NOW });
  const ticket = issued(commitAction(G("1"), G("2")));
  const active = bind(run, ticket);
  assert.equal(bind(active, ticket), active);
  assert.equal(bindStandingReleaseRunTicket(active, ticket, {
    now: NOW + 120_000,
    expected_version: active.version,
  }), active);
  assert.throws(() => bindStandingReleaseRunTicket(run, ticket, {
    now: NOW,
    expected_version: run.version + 1,
  }), /version_conflict/);
  run = advance(active, completed(ticket, { result_commit: G("2") }));
  assert.throws(() => bind(run, ticket), /replayed/);
});

test("cancellation is terminal and cannot hide an in-progress unknown effect", () => {
  const run = createStandingReleaseRun(input(), { now: NOW });
  const cancelled = cancelStandingReleaseRun(run, {
    reason_digest: H("c"),
    expected_version: run.version,
    now: NOW + 1,
  });
  assert.equal(cancelled.state, "CANCELLED");
  assert.throws(() => cancelStandingReleaseRun(cancelled, {
    reason_digest: H("c"), expected_version: cancelled.version, now: NOW + 2,
  }), /terminal/);
  const active = bind(createStandingReleaseRun(input(), { now: NOW }), issued(commitAction(G("1"), G("2"))));
  assert.throws(() => cancelStandingReleaseRun(active, {
    reason_digest: H("c"), expected_version: active.version, now: NOW + 2,
  }), /reconciliation_required/);
});

test("an expired unknown reservation can only terminate in quarantine", () => {
  const ticket = issued(commitAction(G("1"), G("2")));
  const active = bind(createStandingReleaseRun(input(), { now: NOW }), ticket);
  const reservationId = "hnr_expired-reservation-1";
  assert.throws(() => quarantineExpiredStandingReleaseRun(active, {
    ticket_id: "hnt_wrong-ticket-12345678",
    reservation_id: reservationId,
    expected_version: active.version,
    now: NOW + 1,
  }), /expired_reservation_mismatch/);
  const quarantined = quarantineExpiredStandingReleaseRun(active, {
    ticket_id: ticket.ticket.ticket_id,
    reservation_id: reservationId,
    expected_version: active.version,
    now: NOW + 1,
  });
  assert.equal(quarantined.state, "QUARANTINED");
  assert.equal(quarantined.active_action, null);
  assert.equal(quarantined.resume_state, null);
  assert.match(quarantined.terminal_reason_digest, /^[a-f0-9]{64}$/);
  assert.throws(() => quarantineExpiredStandingReleaseRun(quarantined, {
    ticket_id: ticket.ticket.ticket_id,
    reservation_id: reservationId,
    expected_version: quarantined.version,
    now: NOW + 2,
  }), /terminal/);
});
