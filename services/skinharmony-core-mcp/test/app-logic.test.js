import assert from "node:assert/strict";
import test from "node:test";
import { attachWorkPreflight, requiresGenericWorkPreflight, TOOLS } from "../src/app.js";

test("advertises explicit confirmation fields only on write tools", () => {
  const readTools = TOOLS.filter((tool) => tool.annotations.readOnlyHint === true);
  const writeTools = TOOLS.filter((tool) => tool.annotations.readOnlyHint === false);
  assert(writeTools.length > 0);
  const confirmedWrites = writeTools.filter((tool) => tool._meta?.["skinharmony/ownerConfirmationRequired"] !== false);
  const advisoryWrites = writeTools.filter((tool) => tool._meta?.["skinharmony/ownerConfirmationRequired"] === false);
  assert(confirmedWrites.every((tool) => tool.inputSchema.properties.owner_confirmed?.type === "boolean"));
  assert(confirmedWrites.every((tool) => tool.inputSchema.properties.confirmation_reference?.type === "string"));
  assert(advisoryWrites
    .filter((tool) => tool.name !== "core_capability_invoke")
    .every((tool) => tool.inputSchema.properties.owner_confirmed === undefined));
  assert(advisoryWrites
    .filter((tool) => tool.name !== "core_capability_invoke")
    .every((tool) => tool.inputSchema.properties.confirmation_reference === undefined));
  const dynamicInvoke = advisoryWrites.find((tool) => tool.name === "core_capability_invoke");
  assert.equal(dynamicInvoke.inputSchema.properties.owner_confirmed.type, "boolean");
  assert.equal(dynamicInvoke.inputSchema.properties.confirmation_reference.type, "string");
  assert.deepEqual(
    advisoryWrites.map((tool) => tool.name),
    [
      "core_capability_invoke",
      "orchestration_dtt_core_join",
      "ai_work_quality_observe",
      "nyra_research_airlock_plan",
      "nyra_research_airlock_open",
      "nyra_research_airlock_discover",
      "nyra_research_airlock_seal",
      "nyra_research_airlock_private_enter",
      "nyra_research_airlock_tool_authorize",
      "nyra_research_airlock_complete",
    ],
  );
  assert(readTools.every((tool) => tool.inputSchema.properties.owner_confirmed === undefined));
});

test("routes semantic selection through the mandatory generic preflight", () => {
  assert.equal(requiresGenericWorkPreflight("core_semantic_select"), true);
  assert.equal(requiresGenericWorkPreflight("core_health"), false);
  assert.equal(requiresGenericWorkPreflight("work_preflight"), false);
});

test("Airlock controls never invoke generic preflight before the public plan is open", () => {
  for (const name of [
    "nyra_research_airlock_status",
    "nyra_research_airlock_plan",
    "nyra_research_airlock_open",
    "nyra_research_airlock_discover",
    "nyra_research_airlock_seal",
    "nyra_research_airlock_private_enter",
    "nyra_research_airlock_tool_authorize",
    "nyra_research_airlock_complete",
  ]) assert.equal(requiresGenericWorkPreflight(name), false, `${name} must remain isolated from generic preflight`);
});

test("does not expose client-selectable product packs on horizontal Core tools", () => {
  for (const name of ["work_preflight", "nyra_runtime_context", "nyra_interpret_request"]) {
    const definition = TOOLS.find((tool) => tool.name === name);
    assert(definition, `missing tool definition ${name}`);
    assert.equal(definition.inputSchema.properties.domain_pack, undefined);
  }
});

test("aligns Nyra branch request limits with Universal Core", () => {
  for (const name of ["work_preflight", "nyra_interpret_request"]) {
    const definition = TOOLS.find((tool) => tool.name === name);
    assert(definition, `missing tool definition ${name}`);
    assert.equal(definition.inputSchema.properties.nyra_branches.maxItems, 64);
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
        operational_surface: "tenant_work_gallery",
        gallery_version: "tenant_work_gallery_v1",
        tenant_work_gallery: { state: "ready", work_count: 1 },
        governance: { execution_allowed_by_preflight: true },
      },
    },
  );
  assert.equal(result.structuredContent.work_preflight.state, "completed_read_only");
  assert.equal(result.structuredContent.work_preflight.operational_surface, "tenant_work_gallery");
  assert.equal(result.structuredContent.work_preflight.tenant_work_gallery.state, "ready");
  assert.equal(JSON.parse(result.content.at(-1).text).mandatory_work_preflight.gallery_state, "ready");
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
