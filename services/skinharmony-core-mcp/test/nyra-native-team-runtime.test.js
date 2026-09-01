import assert from "node:assert/strict";
import test from "node:test";
import {
  NYRA_NATIVE_TEAM_BLUEPRINTS,
  NYRA_NATIVE_TEAM_PACKAGE_ID,
  NYRA_NATIVE_TEAM_PARENT_ID,
  NYRA_NATIVE_TEAM_VERSION,
  createNyraNativeTeamRuntime,
  nyraNativeTeamBlueprintCatalog,
} from "../src/nyra-native-team-runtime.js";
import { NYRA_NATIVE_TEAM_TOOLS } from "../src/nyra-native-team-tools.js";

test("Nyra Native Team has exactly six immutable zero-privilege blueprints", () => {
  const catalog = nyraNativeTeamBlueprintCatalog();
  assert.equal(catalog.package_id, NYRA_NATIVE_TEAM_PACKAGE_ID);
  assert.equal(catalog.package_version, NYRA_NATIVE_TEAM_VERSION);
  assert.equal(catalog.parent.agent_id, NYRA_NATIVE_TEAM_PARENT_ID);
  assert.match(catalog.blueprint_digest, /^[a-f0-9]{64}$/);
  assert.equal(catalog.blueprints.length, 6);
  assert.equal(new Set(catalog.blueprints.map((item) => item.blueprint_id)).size, 6);
  assert.deepEqual(catalog.blueprints.map((item) => item.blueprint_id), [
    "memory_curator", "researcher", "planner", "executor_specialist",
    "independent_verifier", "release_operations",
  ]);
  for (const blueprint of NYRA_NATIVE_TEAM_BLUEPRINTS) {
    assert.equal(blueprint.parent_kind, "nyra");
    assert.equal(blueprint.parent_agent_id, NYRA_NATIVE_TEAM_PARENT_ID);
    assert.equal(blueprint.execution_mode, "disabled");
    assert.equal(blueprint.model_invocation_allowed, false);
    assert.equal(blueprint.external_action_allowed, false);
    assert.equal(blueprint.core_gate_required, true);
    assert.deepEqual(blueprint.tool_allowlist, []);
    assert.equal(blueprint.memory_scope, "minimal_structured_work_only");
  }
});

test("Native Team persistence is tenant/work scoped and keeps a receipt ledger append-only", () => {
  const runtime = createNyraNativeTeamRuntime({}, { pool: { query: async () => ({ rows: [] }), end() {} } });
  assert.match(runtime.schemaSql, /core_nyra_native_team_packages/);
  assert.match(runtime.schemaSql, /core_nyra_agent_instances/);
  assert.match(runtime.schemaSql, /tenant_id varchar\(64\) NOT NULL,\n  project_id varchar\(64\) NOT NULL,\n  work_id uuid NOT NULL/);
  assert.match(runtime.schemaSql, /UNIQUE \(tenant_id, work_id, blueprint_id\)/);
  assert.match(runtime.schemaSql, /FOREIGN KEY \(tenant_id, work_id\) REFERENCES core_continuity_works/);
  assert.match(runtime.schemaSql, /core_nyra_agent_receipts_append_only/);
  assert.match(runtime.schemaSql, /model_invocation_allowed boolean NOT NULL DEFAULT false/);
  assert.match(runtime.schemaSql, /external_action_allowed boolean NOT NULL DEFAULT false/);
  assert.equal(typeof runtime.materializeForWork, "function");
  assert.equal(typeof runtime.materializeForWorkInTransaction, "function");
});

test("Native Team MCP tools separate reads from owner-gated package and bootstrap writes", () => {
  const tools = Object.fromEntries(NYRA_NATIVE_TEAM_TOOLS.map((item) => [item.name, item]));
  assert.deepEqual(Object.keys(tools).sort(), [
    "nyra_native_team_blueprints", "nyra_native_team_bootstrap",
    "nyra_native_team_enable", "nyra_native_team_status",
  ]);
  for (const name of ["nyra_native_team_blueprints", "nyra_native_team_status"]) {
    assert.equal(tools[name].annotations.readOnlyHint, true);
  }
  for (const name of ["nyra_native_team_enable", "nyra_native_team_bootstrap"]) {
    assert.equal(tools[name].annotations.readOnlyHint, false);
    assert.equal(tools[name]._meta["skinharmony/ownerConfirmationRequired"], true);
  }
  assert.equal(tools.nyra_native_team_bootstrap.inputSchema.properties.tenant_id, undefined);
  assert.deepEqual(tools.nyra_native_team_bootstrap.inputSchema.required.sort(), [
    "idempotency_key", "project_id", "work_id",
  ]);
});
