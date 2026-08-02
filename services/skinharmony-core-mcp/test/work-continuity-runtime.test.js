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
import { TOOLS as BASE_TOOLS } from "../src/tool-definitions.js";
import {
  WORK_CONTINUITY_TOOLS,
  tenantWorkCoordinationActionType,
} from "../src/work-continuity-tools.js";

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
  assert.ok(WORK_EVENT_TYPES.has("drift_detected"));
  assert.ok(WORK_EVENT_TYPES.has("memory_verified"));
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
    ["file", "component", "dependency"],
  );
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

test("Gallery mutations use bounded Core action types instead of generic continuity update", () => {
  assert.deepEqual({
    tenant_work_gallery_join: tenantWorkCoordinationActionType("tenant_work_gallery_join"),
    tenant_work_gallery_heartbeat: tenantWorkCoordinationActionType("tenant_work_gallery_heartbeat"),
    tenant_work_branch_open: tenantWorkCoordinationActionType("tenant_work_branch_open"),
    tenant_work_lease_acquire: tenantWorkCoordinationActionType("tenant_work_lease_acquire"),
    tenant_work_lease_renew: tenantWorkCoordinationActionType("tenant_work_lease_renew"),
    tenant_work_lease_release: tenantWorkCoordinationActionType("tenant_work_lease_release"),
    tenant_work_message_post: tenantWorkCoordinationActionType("tenant_work_message_post"),
  }, {
    tenant_work_gallery_join: "work.participant.join",
    tenant_work_gallery_heartbeat: "work.participant.heartbeat",
    tenant_work_branch_open: "work.branch.open",
    tenant_work_lease_acquire: "work.lease.acquire",
    tenant_work_lease_renew: "work.lease.renew",
    tenant_work_lease_release: "work.lease.release",
    tenant_work_message_post: "work.message.post",
  });
  assert.equal(tenantWorkCoordinationActionType("unknown_internal_write"), null);
});
