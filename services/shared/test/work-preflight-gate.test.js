import test from "node:test";
import assert from "node:assert/strict";
import {
  validateWorkPreflightEnvelope,
  workPreflightFailure,
} from "../work-preflight-gate.mjs";

function validPreflight(tenantId = "tenant-a") {
  return {
    schema_version: "skinharmony_work_preflight_v1",
    preflight_id: "preflight_gate_test",
    mandatory: true,
    tenant_id: tenantId,
    operational_surface: "tenant_work_gallery",
    tenant_work_gallery: {
      schema_version: "tenant_work_gallery_v1",
      tenant_id: tenantId,
      available: true,
      state: "ready",
    },
    memory_first: { status: "recalled" },
    governance: { execution_allowed_by_preflight: true },
  };
}

test("accepts a tenant-bound Gallery and memory preflight", () => {
  const result = validateWorkPreflightEnvelope({ work_preflight: validPreflight() }, "tenant-a");
  assert.equal(result.ok, true);
  assert.equal(result.execution_allowed, true);
});

test("rejects missing Gallery, memory recall, and tenant binding", () => {
  const preflight = validPreflight("tenant-b");
  preflight.tenant_work_gallery.available = false;
  preflight.memory_first.status = "required_from_tenant_memory_provider";
  const result = validateWorkPreflightEnvelope({ work_preflight: preflight }, "tenant-a");
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    "work_preflight_tenant_mismatch",
    "work_gallery_required",
    "work_memory_recall_required",
  ]);
  const failure = workPreflightFailure(result.errors);
  assert.equal(failure.code, "WORK_PREFLIGHT_INVALID");
  assert.equal(failure.execution_allowed, false);
});

test("missing envelope is a distinct fail-closed condition", () => {
  const result = validateWorkPreflightEnvelope({}, "tenant-a");
  assert.deepEqual(result.errors, ["work_preflight_required"]);
  assert.equal(workPreflightFailure(result.errors).code, "WORK_PREFLIGHT_REQUIRED");
});
