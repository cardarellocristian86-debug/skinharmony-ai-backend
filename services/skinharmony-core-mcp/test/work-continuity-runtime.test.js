import assert from "node:assert/strict";
import test from "node:test";
import {
  WORK_CONTINUITY_SCHEMA_VERSION,
  WORK_EVENT_TYPES,
  buildImpactMap,
  createWorkContinuityRuntime,
  digest,
  stable,
} from "../src/work-continuity-runtime.js";
import { WORK_CONTINUITY_TOOLS as TOOLS } from "../src/work-continuity-tools.js";

test("continuity digests are deterministic across object key order", () => {
  assert.deepEqual(stable({ b: 2, a: { d: 4, c: 3 } }), { a: { c: 3, d: 4 }, b: 2 });
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  assert.notEqual(digest({ a: 1 }), digest({ a: 2 }));
});

test("impact map follows functions, components, links and dependencies", () => {
  const impact = buildImpactMap({
    functions: [{ id: "resume", component_id: "runtime" }, { id: "unrelated" }],
    components: [{ id: "runtime", functions: ["resume"] }, { id: "ui" }],
    dependencies: [{ id: "db", from: "resume", to: "postgres" }, { id: "cdn", from: "ui" }],
    links: [{ id: "resume-core", from: "resume", to: "core" }, { id: "ui-web" }],
  }, {
    function_id: "resume",
    components: ["runtime"],
    dependencies: ["db"],
    links: ["resume-core"],
    regression_targets: ["restart-test"],
    depth_delta: 1,
    reason: "Add drift-aware resume",
  });
  assert.equal(impact.schema_version, "work_impact_map_v1");
  assert.deepEqual(impact.affected_functions.map((item) => item.id), ["resume"]);
  assert.deepEqual(impact.affected_components.map((item) => item.id), ["runtime"]);
  assert.deepEqual(impact.affected_dependencies.map((item) => item.id), ["db"]);
  assert.deepEqual(impact.affected_links.map((item) => item.id), ["resume-core"]);
  assert.deepEqual(new Set(impact.regression_targets), new Set(["restart-test", "db", "resume-core"]));
  assert.equal(impact.depth_delta, 1);
});

test("continuity schema is persistent, tenant-scoped and append-only", () => {
  const runtime = createWorkContinuityRuntime({}, { pool: { query: async () => ({ rows: [] }), end() {} } });
  assert.equal(WORK_CONTINUITY_SCHEMA_VERSION, "work_continuity_v1");
  assert.match(runtime.schemaSql, /core_continuity_works/);
  assert.match(runtime.schemaSql, /PRIMARY KEY \(tenant_id, work_id\)/);
  assert.match(runtime.schemaSql, /core_continuity_architecture_versions/);
  assert.match(runtime.schemaSql, /core_continuity_capsules/);
  assert.match(runtime.schemaSql, /core_continuity_idempotency/);
  assert.match(runtime.schemaSql, /core_continuity_events_append_only/);
  assert.ok(WORK_EVENT_TYPES.has("drift_detected"));
  assert.ok(WORK_EVENT_TYPES.has("memory_verified"));
});

test("continuity capabilities expose correct read/write and confirmation boundaries", () => {
  const names = [
    "work_continuity_create", "work_continuity_record_change", "work_continuity_checkpoint",
    "work_continuity_read", "work_continuity_resume", "work_continuity_verify_memory",
  ];
  const tools = Object.fromEntries(TOOLS.filter((item) => names.includes(item.name)).map((item) => [item.name, item]));
  assert.deepEqual(Object.keys(tools).sort(), names.sort());
  assert.equal(tools.work_continuity_read.annotations.readOnlyHint, true);
  for (const name of names.filter((item) => item !== "work_continuity_read")) {
    assert.equal(tools[name].annotations.readOnlyHint, false);
    assert.equal(tools[name]._meta["skinharmony/ownerConfirmationRequired"], true);
  }
  const resumeHashes = tools.work_continuity_resume.inputSchema.properties.current_state_hashes;
  assert.deepEqual(resumeHashes.required.sort(), ["live_state_hash", "policy_hash", "repository_hash"]);
});
