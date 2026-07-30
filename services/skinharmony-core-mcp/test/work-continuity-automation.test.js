import assert from "node:assert/strict";
import test from "node:test";
import { createWorkContinuityAutomation } from "../src/work-continuity-automation.js";

const TENANT = "tenant-automation";
const WORK_ID = "11111111-1111-4111-8111-111111111111";
const COMMIT = "c".repeat(40);
const HASH = "a".repeat(64);

function identity() {
  return {
    tenantId: TENANT,
    subject: "codex|automation",
    agentPresence: { agent_id: "root-coordinator" },
  };
}

function ticketRecord(overrides = {}) {
  const action = {
    kind: "git.commit",
    repository: "owner/repo",
    branch: "agent/continuity",
    parent_commit: "b".repeat(40),
    tree_sha: "d".repeat(40),
    diff_digest: "e".repeat(64),
    changed_files: ["services/api/src/app.js", "services/api/test/app.test.js"],
    message_digest: "f".repeat(64),
    builder_agent_id: "builder",
    provider_execution: false,
    ...(overrides.action || {}),
  };
  return {
    schema_version: "host_native_action_ticket_record_v1",
    tenant_id: TENANT,
    state: "completed",
    outcome: "success",
    observed_outcome: null,
    result_commit: COMMIT,
    observed_commit: null,
    result_digest: HASH,
    readback_digest: "2".repeat(64),
    ticket: {
      schema_version: "bounded_host_action_ticket_v1",
      ticket_id: "hnt_ticket-automation-12345678",
      tenant_id: TENANT,
      work_id: WORK_ID,
      repository: action.repository,
      action,
      action_digest: "3".repeat(64),
      signature: `hnt_${"4".repeat(64)}`,
      host_policy_override: false,
      host_policy_must_allow: true,
      provider_execution: false,
      ...overrides.ticket,
    },
    ...overrides.record,
  };
}

function coreResult(record, overrides = {}) {
  return {
    structuredContent: {
      ok: true,
      tenant_id: TENANT,
      action_ticket: record,
      dedicated_core_gate: {
        authorized: true,
        authority: "universal_core",
        route: "/v1/host-native/actions/ticket/complete",
        provider_execution: false,
        host_policy_override: false,
      },
      ...overrides,
    },
  };
}

function fakeRuntime(options = {}) {
  const calls = { incidents: [], operationalIncidents: [], atlases: [] };
  return {
    calls,
    runtime: {
      async recordIncident(eventIdentity, input) {
        calls.incidents.push({ identity: eventIdentity, input });
        if (options.incidentError) throw options.incidentError;
        return { status: "candidate", fingerprint: "4".repeat(64) };
      },
      async recordOperationalIncident(eventIdentity, input) {
        calls.operationalIncidents.push({ identity: eventIdentity, input });
        if (options.operationalIncidentError) throw options.operationalIncidentError;
        return { status: "candidate", fingerprint: "5".repeat(64) };
      },
      async upsertAtlas(eventIdentity, input) {
        calls.atlases.push({ identity: eventIdentity, input });
        if (options.atlasError) throw options.atlasError;
        return { revision: 1 };
      },
    },
  };
}

test("indexes verifier dissent without trusting raw error text", async () => {
  const fake = fakeRuntime();
  const hook = createWorkContinuityAutomation({ runtime: fake.runtime });
  const result = await hook({
    identity: identity(),
    toolName: "core_capability_invoke",
    args: {
      capability_id: "work_continuity_native_report",
      arguments: {
        work_id: WORK_ID,
        plan_id: "22222222-2222-4222-8222-222222222222",
        native_agent_id: "verifier",
        status: "completed",
        report: {
          summary: "token=ghp_12345678901234567890",
          verdict: "rejected",
        },
      },
    },
    result: {
      structuredContent: {
        ok: true,
        result: {
          work_id: WORK_ID,
          status: "completed",
          report_digest: HASH,
        },
        dynamic_capability: {
          capability_id: "work_continuity_native_report",
        },
      },
    },
  });

  assert.equal(result.projections[0].kind, "incident");
  assert.equal(fake.calls.operationalIncidents.length, 1);
  const input = fake.calls.operationalIncidents[0].input;
  assert.equal(input.error_code, "NATIVE_VERIFIER_REJECTED");
  assert.doesNotMatch(JSON.stringify(input), /ghp_12345678901234567890/);
  assert.match(input.idempotency_key, /^incident-operational-[a-f0-9]{64}$/);
});

test("indexes deterministic closure gaps and replays the same checkpoint", async () => {
  const fake = fakeRuntime();
  const hook = createWorkContinuityAutomation({ runtime: fake.runtime });
  const event = {
    identity: identity(),
    toolName: "work_continuity_closure_evaluate",
    args: {
      work_id: WORK_ID,
      plan_id: "22222222-2222-4222-8222-222222222222",
    },
    result: {
      structuredContent: {
        ok: true,
        result: {
          work_id: WORK_ID,
          closed: false,
          missing: ["verifier_approval_missing", "required_check:core-mcp"],
        },
      },
    },
  };

  await hook(event);
  await hook(event);

  assert.equal(fake.calls.operationalIncidents.length, 2);
  assert.deepEqual(
    fake.calls.operationalIncidents[0].input,
    fake.calls.operationalIncidents[1].input,
  );
  assert.equal(
    fake.calls.operationalIncidents[0].input.error_code,
    "NATIVE_CLOSURE_GAPS",
  );
});

test("indexes lease and finalize errors but never masks the original failure", async () => {
  const fake = fakeRuntime({
    operationalIncidentError: new Error("incident_projection_unavailable"),
  });
  const hook = createWorkContinuityAutomation({ runtime: fake.runtime });
  const original = new Error("native_agent_binding_expired_replan_required");
  original.code = "native_agent_binding_expired_replan_required";
  const result = await hook({
    identity: identity(),
    toolName: "work_continuity_native_bind",
    args: {
      work_id: WORK_ID,
      plan_id: "22222222-2222-4222-8222-222222222222",
    },
    error: original,
  });

  assert.equal(fake.calls.operationalIncidents.length, 1);
  assert.equal(
    fake.calls.operationalIncidents[0].input.error_code,
    "NATIVE_AGENT_BINDING_EXPIRED_REPLAN_REQUIRED",
  );
  assert.equal(result.projections[0].ok, false);
  assert.equal(original.message, "native_agent_binding_expired_replan_required");
});

test("records a redacted exact-scope incident for a thrown completion error without masking it", async () => {
  const fake = fakeRuntime({ incidentError: new Error("continuity_work_not_found") });
  const hook = createWorkContinuityAutomation({ runtime: fake.runtime });
  const original = new Error("token=ghp_12345678901234567890 password=hunter2 connector failed");
  original.code = "connector_failed";
  const result = await hook({
    identity: identity(),
    toolName: "host_native_action_complete",
    args: { ticket_id: "hnt_error-ticket-12345678" },
    error: original,
    preflight: {
      work_preflight: {
        continuity: {
          work_id: WORK_ID,
          project_id: "owner/repo",
        },
      },
    },
  });

  assert.equal(result.projections[0].ok, false);
  assert.equal(fake.calls.incidents.length, 1);
  assert.equal(fake.calls.atlases.length, 0);
  assert.equal(original.message.includes("connector failed"), true);
  const serialized = JSON.stringify(fake.calls.incidents[0].input);
  assert.doesNotMatch(serialized, /ghp_12345678901234567890|hunter2/);
  assert.equal(fake.calls.incidents[0].input.project_id, "owner/repo");
  assert.equal(fake.calls.incidents[0].input.scope.error_code, "CONNECTOR_FAILED");
  assert.equal(fake.calls.incidents[0].input.scope.repository, "ticket:hnt_error-ticket-12345678");
});

test("preserves a custom continuity project and exact structured Core error on thrown failures", async () => {
  const fake = fakeRuntime();
  const hook = createWorkContinuityAutomation({ runtime: fake.runtime });
  const coreError = new Error(
    "core_request_failed:409:action_ticket_reservation_expired",
  );
  coreError.code = "action_ticket_reservation_expired";
  coreError.statusCode = 409;

  await hook({
    identity: identity(),
    toolName: "host_native_action_reconcile",
    args: { ticket_id: "hnt_expired-ticket-12345678" },
    error: coreError,
    preflight: {
      continuity: {
        work_id: WORK_ID,
        project_id: "customer-custom-project",
      },
    },
  });

  assert.equal(fake.calls.incidents.length, 1);
  assert.equal(fake.calls.atlases.length, 0);
  const incident = fake.calls.incidents[0].input;
  assert.equal(incident.work_id, WORK_ID);
  assert.equal(incident.project_id, "customer-custom-project");
  assert.equal(incident.scope.error_code, "ACTION_TICKET_RESERVATION_EXPIRED");
  assert.equal(
    incident.scope.repository,
    "ticket:hnt_expired-ticket-12345678",
  );
});

test("records a candidate for a Core-confirmed 200 failure and never updates Atlas", async () => {
  const fake = fakeRuntime();
  const hook = createWorkContinuityAutomation({ runtime: fake.runtime });
  const record = ticketRecord({
    record: { state: "failed", outcome: "failure", result_commit: null },
  });
  const result = await hook({
    identity: identity(),
    toolName: "host_native_action_complete",
    args: { outcome: "success", result_commit: "9".repeat(40) },
    result: coreResult(record),
  });

  assert.equal(result.projections[0].kind, "incident");
  assert.equal(fake.calls.incidents.length, 1);
  assert.equal(fake.calls.atlases.length, 0);
  assert.equal(fake.calls.incidents[0].input.work_id, WORK_ID);
  assert.equal(fake.calls.incidents[0].input.project_id, "owner/repo");
  assert.equal(fake.calls.incidents[0].input.scope.error_code, "ACTION_COMPLETED_FAILURE");
});

test("replay produces the same incident fingerprint scope, runbook and idempotency key", async () => {
  const fake = fakeRuntime();
  const hook = createWorkContinuityAutomation({ runtime: fake.runtime });
  const event = {
    identity: identity(),
    toolName: "host_native_action_reconcile",
    result: coreResult(ticketRecord({
      record: {
        state: "reconciled",
        outcome: "unknown",
        observed_outcome: "failure",
        result_commit: null,
      },
    })),
  };
  await hook(event);
  await hook(event);

  assert.equal(fake.calls.incidents.length, 2);
  assert.deepEqual(fake.calls.incidents[0].input, fake.calls.incidents[1].input);
  assert.match(fake.calls.incidents[0].input.idempotency_key, /^incident-auto-[a-f0-9]{64}$/);
});

test("Core-confirmed commit success emits a deterministic repository-to-commit-to-file Atlas delta", async () => {
  const fake = fakeRuntime();
  const hook = createWorkContinuityAutomation({ runtime: fake.runtime });
  const event = {
    identity: identity(),
    toolName: "host_native_action_complete",
    args: {
      outcome: "failure",
      result_commit: "9".repeat(40),
      repository: "attacker/args",
    },
    result: coreResult(ticketRecord()),
  };
  await hook(event);
  await hook(event);

  assert.equal(fake.calls.incidents.length, 0);
  assert.equal(fake.calls.atlases.length, 2);
  const first = fake.calls.atlases[0].input;
  const second = fake.calls.atlases[1].input;
  assert.deepEqual(first, second);
  assert.equal(first.work_id, WORK_ID);
  assert.equal(first.replace, false);
  assert.equal(first.nodes.filter((node) => node.node_kind === "repository").length, 1);
  assert.equal(first.nodes.filter((node) => node.node_kind === "commit").length, 1);
  assert.equal(first.nodes.filter((node) => node.node_kind === "file").length, 2);
  assert.equal(first.nodes.find((node) => node.node_kind === "repository").metadata.repository, "owner/repo");
  assert.equal(first.nodes.find((node) => node.node_kind === "commit").metadata.commit_sha, COMMIT);
  assert.equal(first.edges.filter((edge) => edge.edge_type === "contains_commit").length, 1);
  assert.equal(first.edges.filter((edge) => edge.edge_type === "changes_file").length, 2);
  assert.match(first.source_hash, /^[a-f0-9]{64}$/);
  assert.equal(first.idempotency_key, `atlas-auto-${first.source_hash}`);
});

test("failure and untrusted caller arguments cannot create an Atlas delta", async () => {
  const fake = fakeRuntime();
  const hook = createWorkContinuityAutomation({ runtime: fake.runtime });
  await hook({
    identity: identity(),
    toolName: "host_native_action_complete",
    args: {
      outcome: "success",
      result_commit: COMMIT,
      action: {
        kind: "git.commit",
        repository: "attacker/repo",
        changed_files: ["secrets/runtime.env"],
      },
    },
    result: {
      structuredContent: {
        ok: true,
        tenant_id: TENANT,
        dedicated_core_gate: {
          authorized: false,
          authority: "universal_core",
          host_policy_override: false,
        },
      },
    },
  });

  assert.equal(fake.calls.atlases.length, 0);
});

test("Core-confirmed induced service is included without trusting caller service arguments", async () => {
  const fake = fakeRuntime();
  const hook = createWorkContinuityAutomation({ runtime: fake.runtime });
  const record = ticketRecord({
    action: {
      kind: "git.push.branch",
      changed_files: undefined,
      source_commit: COMMIT,
      induced_effects: [{
        service_id: "srv-core",
        environment: "production",
        target_commit: COMMIT,
        trigger: "github_auto_deploy",
      }],
    },
    record: { result_commit: null },
  });
  await hook({
    identity: identity(),
    toolName: "host_native_action_complete",
    args: { service_id: "srv-attacker" },
    result: coreResult(record),
  });

  const atlas = fake.calls.atlases[0].input;
  const service = atlas.nodes.find((node) => node.node_kind === "service");
  assert.equal(service.metadata.service_id, "srv-core");
  assert.equal(service.metadata.environment, "production");
  assert.equal(atlas.edges.some((edge) => edge.edge_type === "induces_service"), true);
});

test("unwraps compact dynamic capability results before projecting a trusted Atlas delta", async () => {
  const fake = fakeRuntime();
  const hook = createWorkContinuityAutomation({ runtime: fake.runtime });
  await hook({
    identity: identity(),
    toolName: "core_capability_invoke",
    args: {
      capability_id: "host_native_action_complete",
      arguments: { ticket_id: "hnt_ticket-automation-12345678" },
    },
    result: coreResult(ticketRecord(), {
      dynamic_capability: {
        capability_id: "host_native_action_complete",
        access_mode: "invoke",
      },
    }),
  });

  assert.equal(fake.calls.atlases.length, 1);
  assert.equal(fake.calls.atlases[0].input.work_id, WORK_ID);
  assert.equal(fake.calls.incidents.length, 0);
});

test("uses a trusted Core ticket attached to a wrapped terminal error for exact incident scope", async () => {
  const fake = fakeRuntime();
  const hook = createWorkContinuityAutomation({ runtime: fake.runtime });
  const error = new Error("core_request_failed:503:connector_unavailable");
  error.code = "connector_unavailable";
  Object.defineProperties(error, {
    hostNativeTicketTrusted: { value: true },
    hostNativeTicketRecord: { value: ticketRecord() },
  });

  await hook({
    identity: identity(),
    toolName: "core_capability_invoke",
    args: {
      capability_id: "host_native_action_complete",
      arguments: { ticket_id: "hnt_ticket-automation-12345678" },
    },
    error,
  });

  assert.equal(fake.calls.incidents.length, 1);
  assert.equal(fake.calls.incidents[0].input.work_id, WORK_ID);
  assert.equal(fake.calls.incidents[0].input.project_id, "owner/repo");
  assert.equal(fake.calls.incidents[0].input.scope.error_code, "CONNECTOR_UNAVAILABLE");
  assert.equal(fake.calls.atlases.length, 0);
});
