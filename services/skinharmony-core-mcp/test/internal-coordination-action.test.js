import assert from "node:assert/strict";
import test from "node:test";

import {
  internalCoordinationActionType,
  tenantWorkCoordinationActions,
} from "../src/internal-coordination-action.js";

test("maps only the seven exact Tenant Work Gallery mutation tools", () => {
  const expected = {
    tenant_work_gallery_join: "work.participant.join",
    tenant_work_gallery_heartbeat: "work.participant.heartbeat",
    tenant_work_branch_open: "work.branch.open",
    tenant_work_lease_acquire: "work.lease.acquire",
    tenant_work_lease_renew: "work.lease.renew",
    tenant_work_lease_release: "work.lease.release",
    tenant_work_message_post: "work.message.post",
  };
  assert.deepEqual(tenantWorkCoordinationActions(), expected);
  for (const [toolName, actionType] of Object.entries(expected)) {
    assert.equal(internalCoordinationActionType(toolName), actionType);
  }
});

test("keeps near-miss Gallery tools outside the autonomous work action set", () => {
  for (const toolName of [
    "tenant_work_gallery_delete",
    "tenant_work_lease_promote",
    "tenant_work_message_publish",
  ]) {
    assert.equal(internalCoordinationActionType(toolName), "continuity.update");
  }
});

test("preserves existing continuity action mappings", () => {
  assert.equal(
    internalCoordinationActionType("work_continuity_native_plan"),
    "native_agent.plan",
  );
  assert.equal(
    internalCoordinationActionType("work_continuity_closure_evaluate"),
    "native_agent.verify",
  );
  assert.equal(
    internalCoordinationActionType("work_continuity_incident_record"),
    "incident.record",
  );
  assert.equal(
    internalCoordinationActionType("work_continuity_checkpoint"),
    "continuity.update",
  );
});
