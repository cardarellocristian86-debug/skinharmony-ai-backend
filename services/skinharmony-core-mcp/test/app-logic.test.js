import assert from "node:assert/strict";
import test from "node:test";
import { attachWorkPreflight, toolFailure, TOOLS } from "../src/app.js";

test("advertises explicit confirmation fields only on write tools", () => {
  const readTools = TOOLS.filter((tool) => tool.annotations.readOnlyHint === true);
  const writeTools = TOOLS.filter((tool) => tool.annotations.readOnlyHint === false);
  assert(writeTools.length > 0);
  const confirmedWrites = writeTools.filter((tool) => tool._meta?.["skinharmony/ownerConfirmationRequired"] !== false);
  const advisoryWrites = writeTools.filter((tool) => tool._meta?.["skinharmony/ownerConfirmationRequired"] === false);
  assert(confirmedWrites.every((tool) => tool.inputSchema.properties.owner_confirmed?.type === "boolean"));
  assert(confirmedWrites.every((tool) => tool.inputSchema.properties.confirmation_reference?.type === "string"));
  assert(advisoryWrites.every((tool) => tool.inputSchema.properties.owner_confirmed === undefined));
  assert(advisoryWrites.every((tool) => tool.inputSchema.properties.confirmation_reference === undefined));
  assert.deepEqual(advisoryWrites.map((tool) => tool.name), ["orchestration_dtt_core_join"]);
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

test("maps deterministic coordination failures to non-retryable public statuses", () => {
  for (const [code, status] of [
    ["collaboration_receipt_expired_or_replayed", 409],
    ["workspace_lock_conflict", 409],
    ["workspace_version_conflict", 409],
    ["idempotency_conflict", 409],
    ["core_gate_denied", 403],
    ["collaboration_receipt_signature_invalid", 403],
    ["collaboration_binding_invalid", 400],
  ]) {
    const result = toolFailure(Object.assign(new Error(code), { code }));
    assert.equal(result.structuredContent.error.code, code);
    assert.equal(result.structuredContent.error.status, status);
    assert.equal(result.structuredContent.error.retryable, false);
  }
});

test("preserves bounded Core error codes and explicit issuer retryability", () => {
  const core = toolFailure(new Error("core_request_failed:409:conflict.with.detail"));
  assert.deepEqual(core.structuredContent.error, {
    code: "conflict.with.detail",
    message: "The governed request was rejected.",
    retryable: false,
    status: 409,
  });
  const outage = toolFailure(Object.assign(new Error("nyra_collaboration_issuer_unavailable"), {
    code: "nyra_collaboration_issuer_unavailable",
    status: 503,
    retryable: true,
  }));
  assert.equal(outage.structuredContent.error.status, 503);
  assert.equal(outage.structuredContent.error.retryable, true);
});
