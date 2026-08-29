import assert from "node:assert/strict";
import test from "node:test";
import {
  WORK_CONTINUITY_SCHEMA_VERSION,
  WORK_EVENT_TYPES,
  buildImpactMap,
  createWorkContinuityRuntime,
  digest,
  normalizeNativePrecommitEvidence,
  normalizeSurfaces,
  stable,
  surfacesOverlap,
} from "../src/work-continuity-runtime.js";
import { TOOLS as BASE_TOOLS } from "../src/tool-definitions.js";
import {
  WORK_CONTINUITY_TOOLS,
  tenantWorkCoordinationActionType,
  tenantWorkCoordinationTarget,
} from "../src/work-continuity-tools.js";
import { validateToolArguments } from "../src/schema-validation.js";

test("work continuity advertises explicit automation report stages", () => {
  const report = WORK_CONTINUITY_TOOLS.find((tool) => tool.name === "work_continuity_native_report");
  assert.equal(report.inputSchema.properties.report.properties.automation_stage.enum[0], "build");
});

test("native report schema admits exact server-digested precommit evidence", () => {
  const report = WORK_CONTINUITY_TOOLS.find((tool) => tool.name === "work_continuity_native_report");
  const precommit = report.inputSchema.properties.report.properties.precommit_evidence;
  assert.equal(precommit.properties.schema_version.const, "native_precommit_evidence_v1");
  assert.equal(precommit.properties.diff_mode.const, "git_diff_binary_sha256_v1");
  assert.deepEqual(precommit.required,
    ["schema_version", "diff_mode", "base_commit", "diff_digest", "changed_files"]);
  const closure = WORK_CONTINUITY_TOOLS.find((tool) => tool.name === "work_continuity_closure_evaluate");
  assert.deepEqual(closure.inputSchema.required, ["work_id", "plan_id", "idempotency_key"]);
});

test("precommit evidence is deterministic, ordered and rejects extra authority-shaped fields", () => {
  const input = {
    schema_version: "native_precommit_evidence_v1",
    diff_mode: "git_diff_binary_sha256_v1",
    base_commit: "a".repeat(40),
    diff_digest: "b".repeat(64),
    changed_files: ["z.js", "a.js"],
  };
  const first = normalizeNativePrecommitEvidence(input);
  const second = normalizeNativePrecommitEvidence({
    ...input,
    changed_files: ["a.js", "z.js"],
  });
  assert.deepEqual(first.changed_files, ["a.js", "z.js"]);
  assert.equal(first.workspace_digest, second.workspace_digest);
  assert.throws(() => normalizeNativePrecommitEvidence({
    ...input,
    execution_authorized: true,
  }), /native_precommit_evidence_invalid/);
});

const WORK_ID = "11111111-1111-4111-8111-111111111111";

function galleryIdentity(subject, sessionId, agentId) {
  return {
    tenantId: "tenant-a",
    subject,
    agentPresence: {
      session_id: sessionId,
      agent_id: agentId,
      client_type: "codex",
      signature: `ags_${"a".repeat(32)}`,
      transport_bound: true,
      host_transport_session_fingerprint: "b".repeat(24),
      session_fingerprint: "c".repeat(24),
    },
  };
}

function galleryMessagePool({ participantSubject, recipientSubject, messages = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT operation,request_digest,result FROM core_continuity_idempotency/.test(sql)) return { rows: [] };
      if (/SELECT work_id FROM core_continuity_works/.test(sql) && /FOR UPDATE/.test(sql)) {
        return { rows: [{ work_id: WORK_ID }] };
      }
      if (/SELECT session_id,agent_id,client_type,branch_id,status,expires_at,actor_subject/.test(sql)) {
        if (params[3] !== participantSubject) return { rows: [] };
        return {
          rows: [{
            session_id: params[2],
            agent_id: "gallery-agent",
            client_type: "codex",
            branch_id: null,
            status: "active",
            expires_at: "2030-01-01T00:00:00.000Z",
            actor_subject: participantSubject,
          }],
        };
      }
      if (/SELECT session_id,actor_subject FROM core_continuity_participants/.test(sql)) {
        return { rows: recipientSubject ? [{ session_id: params[2], actor_subject: recipientSubject }] : [] };
      }
      if (/SELECT message_id,branch_id,from_session_id,to_session_id/.test(sql) && /FROM core_continuity_messages/.test(sql)) {
        assert.match(sql, /\(to_session_id=\$3 AND to_actor_subject=\$4\)/);
        const [, , sessionId, actorSubject] = params;
        return {
          rows: messages.filter((message) => (
            !message.to_session_id || (
              message.to_session_id === sessionId &&
              message.to_actor_subject === actorSubject
            )
          )),
        };
      }
      if (/INSERT INTO core_continuity_messages/.test(sql)) {
        return {
          rows: [{
            message_id: params[2],
            branch_id: params[3],
            from_session_id: params[4],
            to_session_id: params[5],
            message_type: params[7],
            subject: params[8],
            payload: JSON.parse(params[9]),
            created_at: "2030-01-01T00:00:00.000Z",
          }],
        };
      }
      if (/SELECT sequence_number,event_hash FROM core_continuity_events/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    async end() {},
  };
}

test("continuity digests are deterministic across object key order", () => {
  assert.deepEqual(stable({ b: 2, a: { d: 4, c: 3 } }), { a: { c: 3, d: 4 }, b: 2 });
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  assert.notEqual(digest({ a: 1 }), digest({ a: 2 }));
});

test("legacy catalog accepts only a server-derived canonical Work ACL intersection", async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/CREATE TABLE IF NOT EXISTS core_continuity_works/.test(sql)) return { rows: [] };
      if (/FROM core_continuity_works w/.test(sql) && /ORDER BY w\.updated_at DESC/.test(sql)) {
        return { rows: [{
          work_id: WORK_ID,
          project_id: "project-a",
          session_id: "session-a",
          status: "active",
          current_version: 1,
          next_action: "continue",
          updated_at: "2026-08-25T10:00:00.000Z",
        }] };
      }
      throw new Error("unexpected_legacy_acl_query");
    },
    async end() {},
  };
  const runtime = createWorkContinuityRuntime({}, { pool });
  const authorization = {
    schema_version: "legacy_work_read_authorization_v1",
    server_derived: true,
    tenant_id: "tenant-a",
    work_ids: [WORK_ID],
  };
  const catalog = await runtime.listWorksAuthorized(
    { tenantId: "tenant-a" },
    { project_id: "project-a", limit: 25 },
    authorization,
  );
  assert.deepEqual(catalog.works.map((work) => work.work_id), [WORK_ID]);
  const select = calls.find((call) => /FROM core_continuity_works w/.test(call.sql) &&
    /ORDER BY w\.updated_at DESC/.test(call.sql));
  assert.match(select.sql, /w\.work_id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(select.params[1], [WORK_ID]);
  await assert.rejects(runtime.listWorksAuthorized(
    { tenantId: "tenant-a" }, {}, { ...authorization, tenant_id: "tenant-b" },
  ), /continuity_work_read_authorization_invalid/);
});

test("legacy resume rejects an unauthorized session binding before persisting a new binding", async () => {
  const hiddenWorkId = "22222222-2222-4222-8222-222222222222";
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/CREATE TABLE IF NOT EXISTS core_continuity_works/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock/.test(sql)) return { rows: [{}] };
      if (/SELECT work_id,create_request_digest\s+FROM core_continuity_session_bindings/.test(sql)) {
        return { rows: [{ work_id: hiddenWorkId, create_request_digest: "a".repeat(64) }] };
      }
      throw new Error("unauthorized_resume_queried_past_binding");
    },
    async end() {},
  };
  const runtime = createWorkContinuityRuntime({}, { pool });
  await assert.rejects(runtime.ensure({ tenantId: "tenant-a", subject: "member-a" }, {
    project_id: "project-a",
    session_id: "session-a",
    resume_existing: true,
  }, {
    creationAuthorized: false,
    trustedSessionFollowup: true,
    authorizedResumeWorkIds: [WORK_ID],
  }), /continuity_work_acl_denied/);
  assert.equal(calls.some((call) => /INSERT INTO core_continuity_session_bindings/.test(call.sql)), false);
});

test("explicit V2-authorized resume replaces only the stale binding for the current session", async () => {
  const staleWorkId = "22222222-2222-4222-8222-222222222222";
  const targetDigest = "b".repeat(64);
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/CREATE TABLE IF NOT EXISTS core_continuity_works/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock/.test(sql)) return { rows: [{}] };
      if (/SELECT work_id,create_request_digest\s+FROM core_continuity_session_bindings/.test(sql)) {
        return { rows: [{ work_id: staleWorkId, create_request_digest: "a".repeat(64) }] };
      }
      if (/SELECT a\.intent_digest,a\.create_request_digest/.test(sql)) {
        return { rows: [{
          intent_digest: "c".repeat(64),
          create_request_digest: targetDigest,
          project_id: "project-a",
          status: "active",
          current_version: 2,
          next_action: "Continue the authorized Work.",
        }] };
      }
      if (/UPDATE core_continuity_session_bindings/.test(sql)) {
        assert.deepEqual(params, [
          "tenant-a", "project-a", "session-a", WORK_ID, targetDigest, staleWorkId,
        ]);
        return { rows: [{ work_id: WORK_ID, create_request_digest: targetDigest }] };
      }
      throw new Error("unexpected_authorized_rebind_query");
    },
    async end() {},
  };
  const runtime = createWorkContinuityRuntime({}, { pool });
  const resumed = await runtime.ensure({ tenantId: "tenant-a", subject: "member-a" }, {
    work_id: WORK_ID,
    project_id: "project-a",
    session_id: "session-a",
    resume_existing: true,
  }, {
    creationAuthorized: false,
    trustedSessionFollowup: true,
    authorizedResumeWorkIds: [WORK_ID],
    allowAuthorizedSessionRebind: true,
  });

  assert.equal(resumed.work_id, WORK_ID);
  assert.equal(resumed.resumed_existing, true);
  assert.equal(resumed.resume_source, "explicit_authorized_rebind");
  assert.equal(resumed.session_binding_created, false);
  assert.equal(resumed.session_binding_rebound, true);
  assert.equal(resumed.idempotent_replay, false);
});

test("session rebind option cannot authorize an implicit or unlisted Work", async () => {
  const staleWorkId = "22222222-2222-4222-8222-222222222222";
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/CREATE TABLE IF NOT EXISTS core_continuity_works/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock/.test(sql)) return { rows: [{}] };
      if (/SELECT work_id,create_request_digest\s+FROM core_continuity_session_bindings/.test(sql)) {
        return { rows: [{ work_id: staleWorkId, create_request_digest: "a".repeat(64) }] };
      }
      throw new Error("unauthorized_rebind_queried_past_binding");
    },
    async end() {},
  };
  const runtime = createWorkContinuityRuntime({}, { pool });
  await assert.rejects(runtime.ensure({ tenantId: "tenant-a", subject: "member-a" }, {
    project_id: "project-a",
    session_id: "session-a",
    resume_existing: true,
  }, {
    creationAuthorized: false,
    trustedSessionFollowup: true,
    authorizedResumeWorkIds: [WORK_ID],
    allowAuthorizedSessionRebind: true,
  }), /continuity_work_acl_denied/);
  assert.equal(calls.some((call) => /UPDATE core_continuity_session_bindings/.test(call.sql)), false);
});

test("legacy Gallery prompt fields and blockers are restricted to canonical visible Work ids", async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/CREATE TABLE IF NOT EXISTS core_continuity_works/.test(sql)) return { rows: [] };
      if (/count\(DISTINCT p\.session_id\)/.test(sql)) return { rows: [{
        tenant_id: "tenant-a", project_id: "project-a", work_id: WORK_ID,
        idea: "authorized idea", objective: "authorized objective", status: "active",
        current_version: 1, next_action: "continue", updated_at: "2026-08-25T10:00:00.000Z",
        active_participants: 0, active_leases: 0, active_branches: 0,
      }] };
      if (/FROM core_continuity_remediations/.test(sql)) return { rows: [{
        work_id: WORK_ID, remediation_id: "rem-1", status: "open", block_class: "policy",
      }] };
      throw new Error("unexpected_authorized_gallery_query");
    },
    async end() {},
  };
  const runtime = createWorkContinuityRuntime({}, { pool });
  const result = await runtime.galleryAuthorized({ tenantId: "tenant-a" }, {
    project_id: "project-a",
  }, {
    schema_version: "legacy_work_read_authorization_v1",
    server_derived: true,
    tenant_id: "tenant-a",
    work_ids: [WORK_ID],
  });
  assert.deepEqual(result.works.map((work) => work.work_id), [WORK_ID]);
  const workRead = calls.find((call) => /count\(DISTINCT p\.session_id\)/.test(call.sql));
  const blockerRead = calls.find((call) => /FROM core_continuity_remediations/.test(call.sql));
  assert.match(workRead.sql, /w\.work_id = ANY\(\$5::uuid\[\]\)/);
  assert.deepEqual(workRead.params[4], [WORK_ID]);
  assert.match(blockerRead.sql, /work_id = ANY\(\$3::text\[\]\)/);
  assert.deepEqual(blockerRead.params[2], [WORK_ID]);
});

function standingReleaseAnchor(overrides = {}) {
  return {
    schema_version: "intent_anchor_v1",
    initial_message: "prompt-shaped text must never leave this read",
    idea: "Bound release automation",
    objective: "Release only verified changes",
    acceptance_criteria: ["All checks pass"],
    constraints: ["No provider execution"],
    source: { client_type: "codex_native", session_id: "session-a" },
    immutable: true,
    ...overrides,
  };
}

function standingReleaseBindingRuntime(row) {
  const reads = [];
  const pool = {
    async query(sql, parameters = []) {
      if (sql.includes("CREATE TABLE IF NOT EXISTS core_continuity_works")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM core_continuity_works w") &&
          sql.includes("JOIN core_continuity_intent_anchors a")) {
        reads.push({ sql, parameters });
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      throw new Error("unexpected_standing_release_binding_query");
    },
    async end() {},
  };
  return { runtime: createWorkContinuityRuntime({}, { pool }), reads };
}

test("standing release Intent read atomically verifies immutable anchor and returns metadata only", async () => {
  for (const [persistedStatus, expectedStatus] of [
    ["active", "active"],
    ["verified", "verified"],
    ["release_ready", "release_ready"],
    ["ACTIVE", "active"],
  ]) {
    const anchor = standingReleaseAnchor();
    const { runtime, reads } = standingReleaseBindingRuntime({
      tenant_id: "tenant-a",
      work_id: WORK_ID,
      project_id: "project-a",
      work_status: persistedStatus,
      current_version: "2",
      work_updated_at: "2026-08-14T10:00:00.000Z",
      anchor,
      intent_digest: digest(anchor),
      intent_anchor_created_at: "2026-08-14T09:00:00.000Z",
    });
    const binding = await runtime.resolveStandingReleaseIntentBinding(
      { tenantId: "tenant-a" },
      { work_id: WORK_ID },
    );
    assert.equal(binding.tenant_id, "tenant-a");
    assert.equal(binding.work_id, WORK_ID);
    assert.equal(binding.work_status, expectedStatus);
    assert.equal(binding.source, "mcp_work_continuity_postgres");
    assert.equal(binding.intent_anchor_digest, digest(anchor));
    assert.equal(binding.intent_anchor_schema_version, "intent_anchor_v1");
    assert.equal(binding.intent_anchor_immutable, true);
    assert.equal(binding.provider_execution, false);
    assert.equal(Object.isFrozen(binding), true);
    const { binding_digest: bindingDigest, ...unsignedBinding } = binding;
    assert.match(bindingDigest, /^[a-f0-9]{64}$/);
    assert.equal(bindingDigest, digest(unsignedBinding));
    assert.notEqual(bindingDigest, digest({ ...unsignedBinding, current_version: 3 }));
    assert.deepEqual(Object.keys(binding).sort(), [
      "binding_digest", "current_version", "intent_anchor_created_at",
      "intent_anchor_digest", "intent_anchor_immutable", "intent_anchor_schema_version",
      "project_id", "provider_execution", "schema_version", "source", "tenant_id",
      "verified_at", "work_id", "work_status", "work_updated_at",
    ]);
    assert.equal("anchor" in binding, false);
    assert.equal("initial_message" in binding, false);
    assert.equal("idea" in binding, false);
    assert.equal("objective" in binding, false);
    assert.equal(reads.length, 1);
    assert.deepEqual(reads[0].parameters, ["tenant-a", WORK_ID]);
    assert.match(reads[0].sql, /JOIN core_continuity_intent_anchors/);
  }
});

test("standing release Intent read fails closed for missing, corrupt or ineligible persistence", async () => {
  const validAnchor = standingReleaseAnchor();
  const validRow = {
    tenant_id: "tenant-a",
    work_id: WORK_ID,
    project_id: "project-a",
    work_status: "active",
    current_version: 1,
    work_updated_at: "2026-08-14T10:00:00.000Z",
    anchor: validAnchor,
    intent_digest: digest(validAnchor),
    intent_anchor_created_at: "2026-08-14T09:00:00.000Z",
  };
  for (const [name, row, expected] of [
    ["missing", null, /standing_release_intent_binding_not_found/],
    ["schema", { ...validRow, anchor: standingReleaseAnchor({ schema_version: "intent_anchor_v0" }) },
      /standing_release_intent_binding_corrupt/],
    ["mutable", { ...validRow, anchor: standingReleaseAnchor({ immutable: false }) },
      /standing_release_intent_binding_corrupt/],
    ["digest", { ...validRow, intent_digest: "f".repeat(64) },
      /standing_release_intent_binding_corrupt/],
    ["tenant", { ...validRow, tenant_id: "tenant-b" },
      /standing_release_intent_binding_corrupt/],
    ["work", { ...validRow, work_id: "22222222-2222-4222-8222-222222222222" },
      /standing_release_intent_binding_corrupt/],
    ["status", { ...validRow, work_status: "blocked" },
      /standing_release_intent_work_status_ineligible/],
    ["version", { ...validRow, current_version: 0 }, /standing_release_intent_binding_corrupt/],
  ]) {
    const { runtime } = standingReleaseBindingRuntime(row);
    await assert.rejects(
      runtime.resolveStandingReleaseIntentBinding(
        { tenantId: "tenant-a" },
        { work_id: WORK_ID },
      ),
      expected,
      name,
    );
  }
  const { runtime } = standingReleaseBindingRuntime(validRow);
  await assert.rejects(
    runtime.resolveStandingReleaseIntentBinding(
      { tenantId: "tenant-a" },
      { work_id: "not-a-uuid" },
    ),
    /work_id_invalid/,
  );
});

test("legacy continuity idempotency cannot replay across authenticated subjects", async () => {
  const cases = [
    ["recordChange", "record_change"],
    ["checkpoint", "checkpoint"],
    ["resume", "resume"],
    ["verifyMemory", "verify_memory"],
  ];
  for (const [method, operation] of cases) {
    const input = {
      work_id: WORK_ID,
      agent_id: "shared-agent",
      idempotency_key: `subject-bound-${operation}`,
    };
    const legacyActorDigest = digest({
      operation,
      actor_binding: "shared-agent",
      request: input,
    });
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS core_continuity_works/.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/pg_advisory_xact_lock/.test(sql)) return { rows: [], rowCount: 0 };
        if (/SELECT operation,request_digest,result FROM core_continuity_idempotency/.test(sql)) {
          return {
            rows: [{
              operation,
              request_digest: legacyActorDigest,
              result: { replayed_from: "first-subject" },
            }],
            rowCount: 1,
          };
        }
        throw new Error(`unexpected_query:${method}`);
      },
      async end() {},
    };
    const runtime = createWorkContinuityRuntime({}, { pool });
    const call = method === "resume"
      ? runtime[method]({
        tenantId: "tenant-a",
        subject: "different-authenticated-subject",
      }, input, { allowed: true })
      : runtime[method]({
        tenantId: "tenant-a",
        subject: "different-authenticated-subject",
      }, input);
    await assert.rejects(call, /idempotency_key_conflict/, method);
  }
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
  assert.match(runtime.schemaSql, /core_continuity_remediations/);
  assert.match(runtime.schemaSql, /UNIQUE \(tenant_id, original_decision_id\)/);
  assert.match(runtime.schemaSql, /core_continuity_remediation_idempotency/);
  assert.equal(runtime.remediationStore.backend, "tenant_work_gallery_postgresql");
  assert.ok(WORK_EVENT_TYPES.has("drift_detected"));
  assert.ok(WORK_EVENT_TYPES.has("memory_verified"));
});

test("authoritative Work events invoke the Gallery projector in the same transaction", async () => {
  const calls = [];
  const pool = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/CREATE TABLE IF NOT EXISTS core_continuity_works/.test(sql)) return { rows: [] };
      if (/SELECT operation,request_digest,result FROM core_continuity_idempotency/.test(sql)) return { rows: [] };
      if (/SELECT w.current_version,v.architecture/.test(sql)) {
        return { rows: [{ current_version: 1, architecture: { functions: [], components: [], dependencies: [], links: [] } }] };
      }
      if (/SELECT sequence_number,event_hash FROM core_continuity_events/.test(sql)) return { rows: [] };
      return { rows: [], rowCount: 1 };
    },
    async end() {},
  };
  const runtime = createWorkContinuityRuntime({}, { pool });
  const projected = [];
  runtime.setWorkEventProjector(async (input) => {
    projected.push(input);
    assert.equal(input.client, pool);
  });
  await assert.rejects(
    async () => runtime.setWorkEventProjector(() => {}),
    /work_event_projector_already_configured/,
  );
  const result = await runtime.recordChange({ tenantId: "tenant-a", subject: "owner" }, {
    work_id: WORK_ID,
    idempotency_key: "project-gallery-event-0001",
    expected_version: 1,
    architecture: { functions: [], components: [], dependencies: [], links: [] },
    change: { function_id: "gallery-projector", reason: "keep projection aligned" },
    next_action: "verify Gallery",
  });
  assert.equal(result.event.event_type, "function_changed");
  assert.equal(projected.length, 1);
  assert.equal(projected[0].tenant_id, "tenant-a");
  assert.equal(projected[0].work_id, WORK_ID);
  assert.equal(projected[0].event.event_hash, result.event.event_hash);
  assert.deepEqual(projected[0].event.payload.version, 2);
  assert(calls.some((call) => /INSERT INTO core_continuity_events/.test(call.sql)));
});

test("continuity capabilities expose correct read/write and confirmation boundaries", () => {
  const names = [
    "work_continuity_create", "work_continuity_record_change", "work_continuity_checkpoint",
    "work_continuity_read", "work_continuity_resume", "work_continuity_verify_memory",
    "work_continuity_start_or_resume",
  ];
  const tools = Object.fromEntries(WORK_CONTINUITY_TOOLS.filter((item) => names.includes(item.name)).map((item) => [item.name, item]));
  assert.deepEqual(Object.keys(tools).sort(), names.sort());
  assert.equal(tools.work_continuity_read.annotations.readOnlyHint, true);
  for (const name of names.filter((item) => item !== "work_continuity_read")) {
    assert.equal(tools[name].annotations.readOnlyHint, false);
    assert.equal(tools[name]._meta["skinharmony/ownerConfirmationRequired"], true);
  }
  const resumeHashes = tools.work_continuity_resume.inputSchema.properties.current_state_hashes;
  assert.deepEqual(resumeHashes.required.sort(), ["live_state_hash", "policy_hash", "repository_hash"]);
  assert.equal(tools.work_continuity_start_or_resume.inputSchema.properties.owner_confirmed.type, "boolean");
});

test("canonical Work Continuity tools register exactly once", () => {
  const canonicalNames = WORK_CONTINUITY_TOOLS.map((tool) => tool.name);
  assert.equal(new Set(canonicalNames).size, canonicalNames.length);
  assert.deepEqual(
    BASE_TOOLS.filter((tool) => canonicalNames.includes(tool.name)).map((tool) => tool.name),
    [],
  );
  assert.equal(BASE_TOOLS.some((tool) => tool.name === "work_continuity_event"), false);
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
  assert.deepEqual(normalizeSurfaces([
    { kind: "causal_project", value: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
    { kind: "causal_change", value: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { kind: "causal_obligation", value: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
  ]), [
    { kind: "causal_change", value: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { kind: "causal_obligation", value: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    { kind: "causal_project", value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  ]);
  assert.throws(() => normalizeSurfaces([{ kind: "causal_change", value: "change-alias" }]),
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
  assert.match(runtime.schemaSql, /to_actor_subject varchar\(200\)/);
  assert.match(runtime.schemaSql, /ADD COLUMN IF NOT EXISTS to_actor_subject/);
  assert.match(runtime.schemaSql, /WHERE status='active'/);
  assert.match(runtime.schemaSql, /policy_authority_scope jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(runtime.schemaSql, /ADD COLUMN IF NOT EXISTS policy_authority_source/);
  assert.match(runtime.schemaSql, /ADD COLUMN IF NOT EXISTS policy_authority_binding_digest/);
  assert.match(runtime.schemaSql, /ADD COLUMN IF NOT EXISTS policy_session_fingerprint/);
  assert.doesNotMatch(runtime.schemaSql, /owner_id/);
  for (const event of [
    "participant_joined", "lease_acquired", "lease_renewed", "lease_released",
    "lease_expired", "message_posted",
  ]) assert.ok(WORK_EVENT_TYPES.has(event));
});

test("direct Gallery messages bind the active recipient subject", async () => {
  const pool = galleryMessagePool({
    participantSubject: "oauth|sender",
    recipientSubject: "oauth|original-recipient",
  });
  const runtime = createWorkContinuityRuntime({}, { pool });
  await runtime.postMessage(galleryIdentity("oauth|sender", "sender-session", "sender-agent"), {
    work_id: WORK_ID,
    session_id: "sender-session",
    agent_id: "sender-agent",
    client_type: "codex",
    to_session_id: "shared-recipient-session",
    message_type: "update",
    subject: "Private update",
    payload: { state: "ready" },
    idempotency_key: "subject-bound-message",
  });
  const recipientLookup = pool.calls.find((call) => /SELECT session_id,actor_subject FROM core_continuity_participants/.test(call.sql));
  assert.match(recipientLookup.sql, /status='active' AND expires_at>now\(\)/);
  const insert = pool.calls.find((call) => /INSERT INTO core_continuity_messages/.test(call.sql));
  assert.match(insert.sql, /to_actor_subject/);
  assert.equal(insert.params[5], "shared-recipient-session");
  assert.equal(insert.params[6], "oauth|original-recipient");
});

test("Gallery inbox excludes legacy and prior-subject direct messages after session reuse", async () => {
  const pool = galleryMessagePool({
    participantSubject: "oauth|replacement-recipient",
    messages: [
      { message_id: "broadcast", to_session_id: null, to_actor_subject: null },
      { message_id: "old-subject", to_session_id: "reused-session", to_actor_subject: "oauth|original-recipient" },
      { message_id: "legacy", to_session_id: "reused-session", to_actor_subject: null },
      { message_id: "replacement", to_session_id: "reused-session", to_actor_subject: "oauth|replacement-recipient" },
    ],
  });
  const runtime = createWorkContinuityRuntime({}, { pool });
  const result = await runtime.inbox(
    galleryIdentity("oauth|replacement-recipient", "reused-session", "replacement-agent"), {
    work_id: WORK_ID,
    session_id: "reused-session",
    agent_id: "replacement-agent",
    client_type: "codex",
  });
  assert.deepEqual(result.messages.map((message) => message.message_id), ["broadcast", "replacement"]);
  const inboxQuery = pool.calls.find((call) => /FROM core_continuity_messages/.test(call.sql));
  assert.equal(inboxQuery.params[2], "reused-session");
  assert.equal(inboxQuery.params[3], "oauth|replacement-recipient");
  assert.doesNotMatch(inboxQuery.sql, /to_actor_subject\s+IS\s+NULL/);
});

test("work gallery tools preserve read/write and bounded tenant-collaboration boundaries", () => {
  const readTools = new Set(["tenant_work_gallery_list", "tenant_work_inbox"]);
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
  const tools = Object.fromEntries(WORK_CONTINUITY_TOOLS.filter((tool) => names.includes(tool.name))
    .map((tool) => [tool.name, tool]));
  assert.deepEqual(Object.keys(tools).sort(), names.sort());
  for (const name of names) {
    assert.equal(tools[name].annotations.readOnlyHint, readTools.has(name));
    if (!readTools.has(name)) {
      assert.equal(tools[name]._meta["skinharmony/ownerConfirmationRequired"], false);
      assert.equal(tools[name]._meta["skinharmony/tenantBoundedCollaboration"], true);
      assert.equal(tools[name].inputSchema.properties.owner_confirmed, undefined);
      assert.equal(tools[name].inputSchema.properties.confirmation_reference, undefined);
      assert.equal(tools[name].inputSchema.properties.idempotency_key.minLength, 8);
    }
  }
  assert.deepEqual(
    tools.tenant_work_lease_acquire.inputSchema.properties.surfaces.items.properties.kind.enum,
    ["file", "component", "dependency", "causal_project", "causal_change", "causal_obligation"],
  );
  assert.equal(tools.tenant_work_lease_acquire.inputSchema.properties.authority_scope, undefined);
  const injectedAuthority = validateToolArguments(tools.tenant_work_lease_acquire.inputSchema, {
    work_id: WORK_ID,
    session_id: "schema-session",
    agent_id: "schema-agent",
    client_type: "codex",
    purpose: "causal_context_issue",
    surfaces: [
      { kind: "causal_project", value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { kind: "causal_change", value: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { kind: "causal_obligation", value: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    ],
    authority_scope: ["core:govern"],
    idempotency_key: "schema-causal-lease",
  });
  assert(injectedAuthority.some((item) => item.path.endsWith(".authority_scope") && item.code === "additional_property"));
});

test("causal lease persists only server-authored authority proof while legacy leases remain compatible", async () => {
  const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const changeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const obligationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT operation,request_digest,result FROM core_continuity_idempotency/.test(sql)) return { rows: [] };
      if (/SELECT work_id FROM core_continuity_works/.test(sql) && /FOR UPDATE/.test(sql)) return { rows: [{ work_id: WORK_ID }] };
      if (/SELECT session_id,agent_id,client_type,branch_id,status,expires_at,actor_subject/.test(sql)) return { rows: [{
        session_id: "causal-session", agent_id: "causal-agent", client_type: "codex", branch_id: null,
        status: "active", expires_at: "2030-01-01T00:00:00.000Z", actor_subject: "oauth|causal",
      }] };
      if (/SELECT project_uuid FROM core_continuity_works/.test(sql)) return { rows: [{ project_uuid: projectId }] };
      if (/UPDATE core_continuity_leases/.test(sql) && /status='expired'/.test(sql)) return { rows: [] };
      if (/FROM core_continuity_leases l/.test(sql) && /l.session_id<>\$3/.test(sql)) return { rows: [] };
      if (/INSERT INTO core_continuity_leases/.test(sql)) return { rows: [{
        lease_id: params[2], session_id: params[3], branch_id: params[4], purpose: params[5], status: "active",
        acquired_at: "2026-08-09T20:00:00.000Z", renewed_at: "2026-08-09T20:00:00.000Z",
        expires_at: "2026-08-09T20:05:00.000Z", policy_authority_scope: JSON.parse(params[8]),
        policy_authority_source: params[9], policy_authority_binding_digest: params[10],
        policy_session_fingerprint: params[11],
      }] };
      if (/SELECT sequence_number,event_hash FROM core_continuity_events/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    async end() {},
  };
  const runtime = createWorkContinuityRuntime({}, { pool });
  const surfaces = normalizeSurfaces([
    { kind: "causal_project", value: projectId },
    { kind: "causal_change", value: changeId },
    { kind: "causal_obligation", value: obligationId },
  ]);
  const result = await runtime.acquireLease(
    galleryIdentity("oauth|causal", "causal-session", "causal-agent"),
    {
      work_id: WORK_ID,
      session_id: "causal-session",
      agent_id: "causal-agent",
      client_type: "codex",
      purpose: "causal_context_issue",
      surfaces,
      ttl_seconds: 300,
      idempotency_key: "causal-authority-proof",
    },
  );
  const persisted = result.lease.policy_authority_scope;
  assert(persisted.includes("agent:presence:recover"));
  assert(persisted.includes("causal:change:execute"));
  assert(persisted.includes("causal:outcome:reconcile"));
  assert(persisted.includes("causal:obligation:close"));
  assert.equal(persisted.includes("core:govern"), false);
  assert.equal(persisted.includes("intent:approve:strategic"), false);
  assert.equal(persisted.includes("causal:close"), false);
  assert.equal(result.lease.policy_authority_source, "persisted_lease_policy_v1");
  assert.equal(result.lease.policy_authority_binding_digest, digest({
    schema_version: "persisted_lease_authority_v1",
    tenant_id: "tenant-a",
    lease_id: result.lease.lease_id,
    actor_id: "causal-agent",
    purpose: "causal_context_issue",
    surfaces,
    persisted_authority_scope: persisted,
    policy_session_fingerprint: "c".repeat(24),
  }));
  assert.equal(result.lease.policy_session_fingerprint, "c".repeat(24));
  const insert = calls.find((call) => /INSERT INTO core_continuity_leases/.test(call.sql));
  assert.match(insert.sql, /policy_authority_scope/);
  assert.equal(insert.params.length, 12);

  await assert.rejects(runtime.acquireLease(
    galleryIdentity("oauth|causal", "causal-session", "causal-agent"),
    {
      work_id: WORK_ID,
      session_id: "causal-session",
      agent_id: "causal-agent",
      client_type: "codex",
      purpose: "causal_context_issue",
      surfaces,
      authority_scope: ["core:govern"],
      ttl_seconds: 300,
      idempotency_key: "caller-authority-injection",
    },
  ), /continuity_lease_authority_scope_forbidden/);

  await assert.rejects(runtime.acquireLease(
    galleryIdentity("oauth|causal", "causal-session", "causal-agent"),
    {
      work_id: WORK_ID,
      session_id: "causal-session",
      agent_id: "causal-agent",
      client_type: "codex",
      purpose: "causal_context_issue",
      surfaces: [...surfaces, { kind: "file", value: "services/core" }],
      ttl_seconds: 300,
      idempotency_key: "causal-mixed-surface",
    },
  ), /continuity_causal_lease_contract_invalid/);

  const legacy = await runtime.acquireLease(
    galleryIdentity("oauth|causal", "causal-session", "causal-agent"),
    {
      work_id: WORK_ID,
      session_id: "causal-session",
      agent_id: "causal-agent",
      client_type: "codex",
      purpose: "edit legacy component",
      surfaces: [{ kind: "file", value: "services/core" }],
      ttl_seconds: 300,
      idempotency_key: "legacy-surface-compatible",
    },
  );
  assert.deepEqual(legacy.lease.policy_authority_scope, []);
  assert.equal(legacy.lease.policy_authority_source, "legacy_work_lease_v1");
  assert.equal(legacy.lease.policy_authority_binding_digest, null);
  assert.equal(legacy.lease.policy_session_fingerprint, null);

  const missingFingerprintIdentity = galleryIdentity("oauth|causal", "causal-session", "causal-agent");
  delete missingFingerprintIdentity.agentPresence.session_fingerprint;
  await assert.rejects(runtime.acquireLease(missingFingerprintIdentity, {
    work_id: WORK_ID, session_id: "causal-session", agent_id: "causal-agent", client_type: "codex",
    purpose: "causal_context_issue", surfaces, ttl_seconds: 300, idempotency_key: "causal-missing-session",
  }), /continuity_causal_lease_session_fingerprint_required/);

  await assert.rejects(runtime.acquireLease(
    galleryIdentity("oauth|causal", "causal-session", "causal-agent"),
    { work_id: WORK_ID, session_id: "causal-session", agent_id: "causal-agent", client_type: "codex",
      purpose: "causal_context_issue", surfaces, policy_session_fingerprint: "f".repeat(24),
      ttl_seconds: 300, idempotency_key: "caller-session-injection" },
  ), /continuity_lease_authority_scope_forbidden/);
});

test("Gallery mutations lock the work before participant rows", async () => {
  const identity = galleryIdentity("subject-a", "lock-order-session", "lock-order-agent");
  const cases = [
    ["heartbeat", {
      work_id: WORK_ID, session_id: "lock-order-session", ttl_seconds: 300,
      idempotency_key: "lock-order-heartbeat",
    }],
    ["openBranch", {
      work_id: WORK_ID, session_id: "lock-order-session", branch_key: "lock-order",
      title: "Lock order", objective: "Verify lock order.",
      idempotency_key: "lock-order-branch",
    }],
    ["acquireLease", {
      work_id: WORK_ID, session_id: "lock-order-session",
      purpose: "Verify lock order.", surfaces: [{ kind: "file", value: "services/core" }],
      ttl_seconds: 300, idempotency_key: "lock-order-acquire",
    }],
    ["renewLease", {
      work_id: WORK_ID, session_id: "lock-order-session",
      lease_id: "22222222-2222-4222-8222-222222222222", ttl_seconds: 300,
      idempotency_key: "lock-order-renew",
    }],
    ["releaseLease", {
      work_id: WORK_ID, session_id: "lock-order-session",
      lease_id: "22222222-2222-4222-8222-222222222222",
      idempotency_key: "lock-order-release",
    }],
    ["postMessage", {
      work_id: WORK_ID, session_id: "lock-order-session", message_type: "update",
      subject: "Lock order", payload: { verified: true },
      idempotency_key: "lock-order-message",
    }],
  ];

  for (const [method, input] of cases) {
    const calls = [];
    const pool = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (/SELECT work_id FROM core_continuity_works/.test(sql) && /FOR UPDATE/.test(sql)) {
          return { rows: [{ work_id: WORK_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      async end() {},
    };
    const runtime = createWorkContinuityRuntime({}, { pool });
    await assert.rejects(runtime[method](identity, {
      ...input,
      agent_id: "lock-order-agent",
      client_type: "codex",
    }), /continuity_participant_not_active/);
    const rowLock = calls.findIndex((call) =>
      /SELECT work_id FROM core_continuity_works/.test(call.sql) && /FOR UPDATE/.test(call.sql));
    const workLock = calls.findIndex((call) =>
      /pg_advisory_xact_lock/.test(call.sql) && call.params[1] === WORK_ID);
    const participantLock = calls.findIndex((call) =>
      /SELECT session_id,agent_id,client_type,branch_id,status,expires_at,actor_subject/.test(call.sql));
    assert.notEqual(rowLock, -1, `${method}: missing Work row lock`);
    assert.notEqual(workLock, -1, `${method}: missing work advisory lock`);
    assert.notEqual(participantLock, -1, `${method}: missing participant lock`);
    assert.ok(rowLock < workLock, `${method}: advisory locked before Work row`);
    assert.ok(workLock < participantLock, `${method}: participant locked before work`);
  }
});

test("Gallery join locks the Work row before the advisory work lock", async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/CREATE TABLE IF NOT EXISTS core_continuity_works/.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      if (/SELECT operation,request_digest,result FROM core_continuity_idempotency/.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      if (/SELECT work_id FROM core_continuity_works/.test(sql)) {
        return { rows: [{ work_id: WORK_ID }], rowCount: 1 };
      }
      if (/SELECT actor_subject,agent_id,client_type,branch_id,expires_at/.test(sql)) {
        throw new Error("join-lock-order-observed");
      }
      return { rows: [], rowCount: 0 };
    },
    async end() {},
  };
  const runtime = createWorkContinuityRuntime({}, { pool });
  await assert.rejects(runtime.join(
    galleryIdentity("subject-a", "join-lock-session", "join-lock-agent"),
    {
      work_id: WORK_ID,
      session_id: "join-lock-session",
      agent_id: "join-lock-agent",
      client_type: "codex",
      ttl_seconds: 300,
      idempotency_key: "join-lock-order-key",
    },
  ), /join-lock-order-observed/);
  const rowLock = calls.findIndex((call) =>
    /SELECT work_id FROM core_continuity_works/.test(call.sql) && /FOR UPDATE/.test(call.sql));
  const workAdvisoryLock = calls.findIndex((call) =>
    /pg_advisory_xact_lock/.test(call.sql) && call.params[1] === WORK_ID);
  const participantLock = calls.findIndex((call) =>
    /SELECT actor_subject,agent_id,client_type,branch_id,expires_at/.test(call.sql));
  assert.notEqual(rowLock, -1);
  assert.notEqual(workAdvisoryLock, -1);
  assert.notEqual(participantLock, -1);
  assert.ok(rowLock < workAdvisoryLock);
  assert.ok(workAdvisoryLock < participantLock);
});

test("Gallery and DTT mutations use bounded Core action types and derived Core-valid targets", () => {
  assert.deepEqual({
    tenant_work_open_review: tenantWorkCoordinationActionType("tenant_work_open_review"),
    tenant_work_gallery_join: tenantWorkCoordinationActionType("tenant_work_gallery_join"),
    tenant_work_gallery_heartbeat: tenantWorkCoordinationActionType("tenant_work_gallery_heartbeat"),
    tenant_work_branch_open: tenantWorkCoordinationActionType("tenant_work_branch_open"),
    tenant_work_lease_acquire: tenantWorkCoordinationActionType("tenant_work_lease_acquire"),
    tenant_work_lease_renew: tenantWorkCoordinationActionType("tenant_work_lease_renew"),
    tenant_work_lease_release: tenantWorkCoordinationActionType("tenant_work_lease_release"),
    tenant_work_message_post: tenantWorkCoordinationActionType("tenant_work_message_post"),
    tenant_work_queue_create_v3: tenantWorkCoordinationActionType("tenant_work_queue_create_v3"),
    tenant_work_assign_v3: tenantWorkCoordinationActionType("tenant_work_assign_v3"),
    tenant_work_assignment_accept_v3: tenantWorkCoordinationActionType("tenant_work_assignment_accept_v3"),
    tenant_work_archive_v3: tenantWorkCoordinationActionType("tenant_work_archive_v3"),
    tenant_work_reopen_v3: tenantWorkCoordinationActionType("tenant_work_reopen_v3"),
    tenant_work_task_record: tenantWorkCoordinationActionType("tenant_work_task_record"),
    tenant_work_evidence_record: tenantWorkCoordinationActionType("tenant_work_evidence_record"),
  }, {
    tenant_work_open_review: "work.bootstrap.review",
    tenant_work_gallery_join: "work.participant.join",
    tenant_work_gallery_heartbeat: "work.participant.heartbeat",
    tenant_work_branch_open: "work.branch.open",
    tenant_work_lease_acquire: "work.lease.acquire",
    tenant_work_lease_renew: "work.lease.renew",
    tenant_work_lease_release: "work.lease.release",
    tenant_work_message_post: "work.message.post",
    tenant_work_queue_create_v3: "work.gallery.queue.create",
    tenant_work_assign_v3: "work.gallery.assignment.offer",
    tenant_work_assignment_accept_v3: "work.gallery.assignment.accept",
    tenant_work_archive_v3: "work.gallery.archive",
    tenant_work_reopen_v3: "work.gallery.reopen",
    tenant_work_task_record: "task.update",
    tenant_work_evidence_record: "continuity.update",
  });
  assert.equal(tenantWorkCoordinationTarget("tenant_work_task_record", { work_id: WORK_ID }), `task:${WORK_ID}`);
  assert.equal(tenantWorkCoordinationTarget("tenant_work_evidence_record", { work_id: WORK_ID }), `work_continuity_evidence:${WORK_ID}`);
  assert.equal(tenantWorkCoordinationTarget("tenant_work_queue_create_v3", {}), "tenant_work_queue_create_v3");
  for (const name of [
    "tenant_work_assign_v3",
    "tenant_work_assignment_accept_v3",
    "tenant_work_archive_v3",
    "tenant_work_reopen_v3",
  ]) {
    assert.equal(tenantWorkCoordinationTarget(name, { work_id: WORK_ID }), WORK_ID, name);
  }
  assert.equal(
    tenantWorkCoordinationTarget("software_cognition_repository_bootstrap", { work_id: WORK_ID }),
    `work_atlas:${WORK_ID}`,
  );
  const workIdV7 = "018f8d9e-8a2e-7b11-8c4d-123456789abc";
  assert.equal(
    tenantWorkCoordinationTarget("software_cognition_repository_bootstrap", { work_id: workIdV7 }),
    `work_atlas:${workIdV7}`,
  );
  assert.equal(tenantWorkCoordinationTarget("tenant_work_task_record", { work_id: "not-a-work-id" }), "tenant_work_task_record");
  assert.equal(tenantWorkCoordinationActionType("unknown_internal_write"), null);
});

test("Gallery V3 schemas admit only Core-valid bounded idempotency keys", () => {
  const names = [
    "tenant_work_queue_create_v3",
    "tenant_work_assign_v3",
    "tenant_work_assignment_accept_v3",
    "tenant_work_archive_v3",
    "tenant_work_reopen_v3",
  ];
  for (const name of names) {
    const schema = WORK_CONTINUITY_TOOLS.find((tool) => tool.name === name).inputSchema.properties.idempotency_key;
    assert.equal(schema.minLength, 8, name);
    assert.equal(schema.maxLength, 160, name);
    const pattern = new RegExp(schema.pattern);
    assert.equal(pattern.test("valid-key-0001"), true, name);
    assert.equal(pattern.test("invalid\u0000key"), false, name);
  }
});
