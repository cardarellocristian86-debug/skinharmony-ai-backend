import assert from "node:assert/strict";
import test from "node:test";
import { attachWorkPreflight, buildCallIdentity, TOOLS } from "../src/app.js";

test("preserves providerExecutionConfirmed only after server-side challenge consumption", () => {
  const identity = buildCallIdentity({ kind: "oauth", providerExecutionConfirmed: true, godMode: false }, { session_id: "mcp-session" }, { owner_confirmed: false, confirmation_reference: "forged" });
  assert.equal(identity.providerExecutionConfirmed, true);
  const forged = buildCallIdentity({ kind: "oauth", providerExecutionConfirmed: false, godMode: false }, { session_id: "mcp-session" }, { owner_confirmed: true, confirmation_reference: "forged" });
  assert.equal(forged.providerExecutionConfirmed, false);
  assert.equal(Object.hasOwn(identity, "ownerConfirmed"), false);
});

test("advertises explicit confirmation fields only on write tools", () => {
  const readTools = TOOLS.filter((tool) => tool.annotations.readOnlyHint === true);
  const writeTools = TOOLS.filter((tool) => tool.annotations.readOnlyHint === false);
  assert(writeTools.length > 0);
  assert(writeTools.every((tool) => tool.inputSchema.properties.owner_confirmed?.type === "boolean"));
  assert(writeTools.every((tool) => tool.inputSchema.properties.confirmation_reference?.type === "string"));
  assert(readTools.every((tool) => tool.inputSchema.properties.owner_confirmed === undefined));
});

test("does not expose client-selectable product packs on horizontal Core tools", () => {
  for (const name of ["work_preflight", "nyra_runtime_context", "nyra_interpret_request"]) {
    const definition = TOOLS.find((tool) => tool.name === name);
    assert(definition, `missing tool definition ${name}`);
    assert.equal(definition.inputSchema.properties.domain_pack, undefined);
  }
});

test("reports a completed read-only preflight as executable", () => {
  const result = attachWorkPreflight(
    { structuredContent: { documents: [] }, content: [] },
    {
      work_preflight: {
        preflight_id: "preflight-read",
        state: "ready_read_only",
        tool_routing: { preferred_route: { id: "tenant_shared_workspace" } },
        governance: { execution_allowed_by_preflight: true },
      },
    },
  );
  assert.equal(result.structuredContent.work_preflight.state, "completed_read_only");
  assert.equal(JSON.parse(result.content.at(-1).text).mandatory_work_preflight.execution_allowed, true);
});

test("reports a confirmed Core-gated write as completed", () => {
  const result = attachWorkPreflight(
    {
      structuredContent: {
        gate: {
          allowed: true,
          owner_confirmation_required: true,
          confirmation_satisfied: true,
        },
      },
      content: [],
    },
    {
      work_preflight: {
        preflight_id: "preflight-write",
        state: "routed_owner_confirmed_waiting_for_core_verdict",
        tool_routing: { preferred_route: { id: "tenant_shared_workspace" } },
        governance: { execution_allowed_by_preflight: false, owner_confirmation_satisfied: true },
      },
    },
  );
  assert.equal(result.structuredContent.work_preflight.state, "completed_after_core_gate");
  assert.equal(result.structuredContent.work_preflight.governance.execution_authorized_by_core_gate, true);
  assert.equal(result.structuredContent.work_preflight.governance.owner_confirmation_required, false);
  assert.equal(JSON.parse(result.content.at(-1).text).mandatory_work_preflight.execution_allowed, true);
});
