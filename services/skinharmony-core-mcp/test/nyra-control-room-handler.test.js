import assert from "node:assert/strict";
import test from "node:test";

import { createCoreHandlers } from "../src/core-handlers.js";
import { projectNyraConversationControlRoomReadback } from "../src/nyra-control-room.js";

const WORK_ID = "9fd0c7f0-d796-4d95-93d0-f5388f55c507";

function health() {
  return {
    ok: true,
    entity_360: { mode: "SHADOW", bitemporal_mode: "SHADOW", deployment_mode_ceiling: "SHADOW", ready: true },
    host_native_governance: { semantic_scope_guard_mode: "SHADOW", semantic_scope_guard_configured: true },
    causal_continuity: { ready: true, state: "ready" },
  };
}

function workContext() {
  return {
    available: true,
    work_id: WORK_ID,
    project_id: "nyra_conversational_runtime",
    work_revision: 4,
    required_task_count: 4,
    pending_required_task_count: 1,
    required_evidence_count: 3,
    unverified_required_evidence_count: 1,
    closure_verified: false,
    next_required_task: { task_id: "f50d7c94-4f76-49c0-b511-640a683fb7af", title: "Independent verification" },
  };
}

test("Control Room handler derives Work status from the server V2 reader without a work preflight", async () => {
  const requests = [];
  const reads = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    nyraDialogueEnabled: false,
  }, {
    fetchImpl: async (url, init) => {
      requests.push({ pathname: new URL(url).pathname, method: init.method });
      return new Response(JSON.stringify(health()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    readControlRoomWorkContext: async (identity, args) => {
      reads.push({ identity, args });
      return workContext();
    },
  });

  const result = await handlers.nyra_control_room_status({
    work_id: WORK_ID,
    project_id: "nyra_conversational_runtime",
  }, { tenantId: "tenant-a" });

  assert.deepEqual(requests, [{ pathname: "/healthz", method: "GET" }]);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].identity.tenantId, "tenant-a");
  assert.deepEqual(reads[0].args, {
    work_id: WORK_ID,
    project_id: "nyra_conversational_runtime",
  });
  assert.equal(result.structuredContent.control_room.work_progress.percent, 62);
  assert.equal(result.structuredContent.control_room.work_progress.next_action.title, "Independent verification");
});

test("Control Room scopes coordination to the canonical Work project, not a stale caller hint", async () => {
  const coordinationReads = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async () => new Response(JSON.stringify(health()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    readControlRoomWorkContext: async () => workContext(),
    readControlRoomCoordinationOverview: async (_identity, args) => {
      coordinationReads.push(args);
      return { available: true, active_session_count: 0, active_logical_agent_count: 0, sessions: [] };
    },
  });

  await handlers.nyra_control_room_status({
    work_id: WORK_ID,
    project_id: "stale-caller-project",
  }, { tenantId: "tenant-a" });
  assert.deepEqual(coordinationReads, [{ project_id: "nyra_conversational_runtime" }]);
});

test("Control Room preserves the tenant-bound V2 reader denial", async () => {
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async () => new Response(JSON.stringify(health()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    readControlRoomWorkContext: async (identity) => {
      assert.equal(identity.tenantId, "tenant-a");
      const error = new Error("continuity_work_acl_denied");
      error.code = "continuity_work_acl_denied";
      throw error;
    },
  });

  await assert.rejects(
    () => handlers.nyra_control_room_status({ work_id: WORK_ID }, { tenantId: "tenant-a" }),
    /continuity_work_acl_denied/,
  );
});

test("Control Room reports an explicit missing Work instead of an empty successful projection", async () => {
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async () => new Response(JSON.stringify(health()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    readControlRoomWorkContext: async () => null,
  });

  await assert.rejects(
    () => handlers.nyra_control_room_status({ work_id: WORK_ID }, { tenantId: "tenant-a" }),
    (error) => error?.code === "nyra_converse_work_not_found" && error?.status === 404,
  );
});

test("Control Room degrades a stalled coordination read without hiding Core health", async () => {
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async () => new Response(JSON.stringify(health()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    readControlRoomCoordinationOverview: async () => new Promise(() => {}),
    controlRoomCoordinationTimeoutMs: 10,
  });
  const started = Date.now();
  const result = await handlers.nyra_control_room_status({}, { tenantId: "tenant-a" });
  assert.equal(result.structuredContent.ok, true);
  const continuity = result.structuredContent.control_room.domains
    .find((domain) => domain.id === "work_continuity");
  assert.equal(continuity.detail.coordination.available, false);
  assert(Date.now() - started < 500);
});

test("Control Room never converts a coordination ACL denial into unavailable", async () => {
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async () => new Response(JSON.stringify(health()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    readControlRoomCoordinationOverview: async () => {
      const error = new Error("continuity_work_acl_denied");
      error.code = "continuity_work_acl_denied";
      throw error;
    },
    controlRoomCoordinationTimeoutMs: 10,
  });
  await assert.rejects(
    () => handlers.nyra_control_room_status({}, { tenantId: "tenant-a" }),
    /continuity_work_acl_denied/,
  );
});

test("conversational Control Room exposes coordination counts without participant identifiers", async () => {
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async () => new Response(JSON.stringify(health()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    readControlRoomCoordinationOverview: async () => ({
      available: true, active_session_count: 1, active_logical_agent_count: 1,
      sessions: [{
        session_id: "private-session", agent_id: "private-agent", client_type: "chatgpt",
        transport_bound: true, state: "WORKING", joined_at: "2026-09-02T09:00:00.000Z",
        last_heartbeat_at: "2026-09-02T09:01:00.000Z",
        presence_expires_at: "2026-09-02T10:00:00.000Z", active_lease_count: 1,
        work_memberships_truncated: false,
        work_memberships: [{ work_id: WORK_ID, project_id: "private-project", work_status: "active", branch_id: null, active_lease_count: 1 }],
      }],
    }),
  });
  const direct = await handlers.nyra_control_room_status({}, { tenantId: "tenant-a" });
  const conversational = projectNyraConversationControlRoomReadback(direct.structuredContent.control_room);
  const serialized = JSON.stringify(conversational);
  assert.match(serialized, /"active_session_count":1/);
  assert.doesNotMatch(serialized, /private-session|private-agent|private-project/);
  assert.doesNotMatch(serialized, /transport_session_fingerprint|work_memberships/);
});
