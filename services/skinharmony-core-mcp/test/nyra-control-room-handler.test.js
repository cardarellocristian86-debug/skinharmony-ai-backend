import assert from "node:assert/strict";
import test from "node:test";

import { createCoreHandlers } from "../src/core-handlers.js";

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
