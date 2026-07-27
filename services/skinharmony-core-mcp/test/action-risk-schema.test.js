import assert from "node:assert/strict";
import test from "node:test";
import { TOOLS } from "../src/tool-definitions.js";

test("core_gate_action exposes deterministic risk inputs", () => {
  const gate = TOOLS.find((tool) => tool.name === "core_gate_action");
  assert(gate);

  for (const property of [
    "read_only",
    "dry_run",
    "contains_secret",
    "destructive",
    "verified_outcome",
    "bypass_orchestrator",
  ]) {
    assert.equal(gate.inputSchema.properties[property]?.type, "boolean", property);
  }
});

test("core_gate_action exposes the closed MCP staging topology envelope without server proofs", () => {
  const gate = TOOLS.find((tool) => tool.name === "core_gate_action");
  assert(gate);
  assert.equal(gate.inputSchema.additionalProperties, false);

  const topologyProperties = [
    "domain_action_id",
    "secret_value_transmitted",
    "values_present_in_envelope",
    "provider_execution",
    "execution_enabled",
    "deploy",
    "database_connection",
    "database_mutation",
    "readback_required",
    "auth0_changes",
    "production_deploy",
    "merge",
    "delete",
    "create_missing_only",
    "overwrite_existing",
    "target_branch",
    "environment",
    "region",
    "phase",
    "topology",
    "provider_native_references",
    "secret_values_present",
    "spec_digest",
    "confirmation_spec_digest",
    "maximum_recurring_monthly_cost_cents",
    "recurring_cost_currency",
    "recurring_cost_confirmed",
    "confirmation_maximum_recurring_monthly_cost_cents",
    "confirmation_recurring_cost_currency",
  ];
  for (const property of topologyProperties) {
    assert(Object.hasOwn(gate.inputSchema.properties, property), property);
  }

  for (const serverDerived of [
    "authenticated_tenant_id",
    "tenant_id",
    "owner_context",
    "owner_context_verified",
    "owner_context_approval_bound",
    "memory_context",
    "request_bound_owner_confirmation",
    "authenticated_key_type",
  ]) {
    assert.equal(
      Object.hasOwn(gate.inputSchema.properties, serverDerived),
      false,
      serverDerived,
    );
  }
});
