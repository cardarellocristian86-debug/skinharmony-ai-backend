import assert from "node:assert/strict";
import test from "node:test";
import {
  WORK_CONTINUITY_SCHEMA_VERSION,
  WORK_EVENT_TYPES,
  buildImpactMap,
  createWorkContinuityRuntime,
  digest,
  normalizeSurfaces,
  stable,
  surfacesOverlap,
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

test("work gallery normalizes bounded surfaces and detects file ancestry overlap", () => {
  assert.deepEqual(normalizeSurfaces([
    { kind: "component", value: "runtime" },
    { kind: "file", value: "./services/core" },
    { kind: "file", value: "services/core" },
  ]), [
    { kind: "component", value: "runtime" },
    { kind: "file", value: "services/core" },
  ]);
  assert.equal(surfacesOverlap(
    { kind: "file", value: "services/core" },
    { kind: "file", value: "services/core/server.js" },
  ), true);
  assert.equal(surfacesOverlap(
    { kind: "component", value: "core" },
    { kind: "component", value: "core-api" },
  ), false);
  assert.equal(surfacesOverlap(
    { kind: "file", value: "services/core" },
    { kind: "dependency", value: "services/core" },
  ), false);
  assert.throws(() => normalizeSurfaces([{ kind: "file", value: "../secret" }]),
    /continuity_lease_surface_invalid/);
});

test("work gallery schema is tenant/work scoped and uses temporary leases", () => {
  const runtime = createWorkContinuityRuntime({}, { pool: { query: async () => ({ rows: [] }), end() {} } });
  for (const table of [
    "core_continuity_branches",
    "core_continuity_participants",
    "core_continuity_leases",
    "core_continuity_lease_surfaces",
    "core_continuity_messages",
  ]) assert.match(runtime.schemaSql, new RegExp(table));
  assert.match(runtime.schemaSql, /PRIMARY KEY \(tenant_id, work_id, session_id\)/);
  assert.match(runtime.schemaSql, /expires_at timestamptz NOT NULL/);
  assert.match(runtime.schemaSql, /WHERE status='active'/);
  assert.doesNotMatch(runtime.schemaSql, /owner_id/);
  for (const event of [
    "participant_joined", "lease_acquired", "lease_renewed", "lease_released",
    "lease_expired", "message_posted",
  ]) assert.ok(WORK_EVENT_TYPES.has(event));
});

test("work gallery tools preserve read/write and bounded tenant-collaboration boundaries", () => {
  const readTools = new Set(["tenant_work_gallery_list", "tenant_work_inbox"]);
  const boundedActions = new Map([
    ["tenant_work_gallery_join", "tenant_work.gallery_join"],
    ["tenant_work_gallery_heartbeat", "tenant_work.gallery_heartbeat"],
    ["tenant_work_branch_open", "tenant_work.branch_open"],
    ["tenant_work_lease_acquire", "tenant_work.lease_acquire"],
    ["tenant_work_lease_renew", "tenant_work.lease_renew"],
    ["tenant_work_lease_release", "tenant_work.lease_release"],
    ["tenant_work_message_post", "tenant_work.message_post"],
  ]);
  const names = [
    ...readTools,
    "tenant_work_gallery_join",
    "tenant_work_gallery_heartbeat",
    "tenant_work_branch_open",
    "tenant_work_lease_acquire",
    "tenant_work_lease_renew",
    "tenant_work_lease_release",
    "tenant_work_message_post",
  ];
  const tools = Object.fromEntries(TOOLS.filter((tool) => names.includes(tool.name))
    .map((tool) => [tool.name, tool]));
  assert.deepEqual(Object.keys(tools).sort(), names.sort());
  for (const name of names) {
    assert.equal(tools[name].annotations.readOnlyHint, readTools.has(name));
    if (!readTools.has(name)) {
      assert.equal(tools[name]._meta["skinharmony/ownerConfirmationRequired"], false);
      assert.equal(tools[name]._meta["skinharmony/tenantBoundedCollaboration"], true);
      assert.equal(tools[name]._meta["skinharmony/boundedActionType"], boundedActions.get(name));
      assert.equal(tools[name].inputSchema.properties.owner_confirmed, undefined);
      assert.equal(tools[name].inputSchema.properties.confirmation_reference, undefined);
      assert.ok(tools[name].inputSchema.properties.idempotency_key);
    }
  }
  assert.deepEqual(
    tools.tenant_work_lease_acquire.inputSchema.properties.surfaces.items.properties.kind.enum,
    ["file", "component", "dependency"],
  );
});
