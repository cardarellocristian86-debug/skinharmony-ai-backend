import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createGalleryMemoryContextProvider,
  selectTenantMemoryContextProvider,
} from "../src/tenant-work-gallery-memory-context.js";

const WORK_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function authorizedIdentity(overrides = {}) {
  return { tenantId: "tenant-a", kind: "codex", ...overrides };
}

function workState(workId, overrides = {}) {
  const {
    work: workOverrides = {},
    latest_capsule: capsuleOverrides = {},
    ...stateOverrides
  } = overrides;
  const capsulePayloadOverrides = capsuleOverrides.capsule || {};
  return {
    schema_version: "work_continuity_v1",
    tenant_id: "tenant-a",
    work: {
      tenant_id: "tenant-a",
      work_id: workId,
      project_id: "project-a",
      objective: "Continue the governed staging work.",
      status: "active",
      current_version: 3,
      next_action: "Run the bounded verification.",
      updated_at: "2030-01-02T00:00:00.000Z",
      ...workOverrides,
    },
    latest_capsule: {
      capsule_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      architecture_version: 3,
      capsule_digest: "a".repeat(64),
      supervisor_approved: true,
      verified_memory: true,
      created_at: "2030-01-02T00:00:00.000Z",
      ...capsuleOverrides,
      capsule: {
        next_action: "Run the bounded verification.",
        evidence: [{ id: "evidence-reference" }],
        tests: [{ name: "bounded-test" }],
        authorizations: [{ id: "authorization-reference" }],
        rollback: { available: true },
        state_hashes: {
          repository_hash: "b".repeat(64),
          policy_hash: "c".repeat(64),
          live_state_hash: "d".repeat(64),
        },
        ...capsulePayloadOverrides,
      },
    },
    participants: [{ active: true }, { active: false }],
    leases: [{ status: "active" }, { status: "released" }],
    events: [{
      event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sequence_number: 7,
      event_type: "checkpoint_created",
      payload: { capsule_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      event_hash: "e".repeat(64),
      created_at: "2030-01-02T00:00:00.000Z",
    }],
    ...stateOverrides,
  };
}

test("Gallery memory context forwards the authenticated identity and ignores caller tenant claims", async () => {
  const identity = authorizedIdentity({ subject: "subject-a" });
  const calls = [];
  const runtime = {
    async gallery() {
      throw new Error("gallery_must_not_run_for_explicit_work");
    },
    async read(receivedIdentity, input) {
      calls.push({ receivedIdentity, input });
      return workState(WORK_IDS[0]);
    },
  };
  const provider = createGalleryMemoryContextProvider(runtime);
  const context = await provider({
    work_id: WORK_IDS[0],
    tenant_id: "tenant-b",
    project_id: "project-a",
    session_id: "session-a",
  }, identity);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].receivedIdentity, identity);
  assert.deepEqual(calls[0].input, { work_id: WORK_IDS[0], event_limit: 20 });
  assert.equal(context.schema_version, "tenant_memory_context_v1");
  assert.equal(context.tenant_id, "tenant-a");
  assert.equal(context.project_id, "project-a");
  assert.equal(context.session_id, "session-a");
  assert.equal(context.relevant_memories[0].work_id, WORK_IDS[0]);
  assert.equal(context.latest_checkpoint.work_id, WORK_IDS[0]);
  assert.equal(context.policy.source, "tenant_work_gallery_postgresql");
  assert.equal(context.policy.read_only, true);
});

test("Gallery memory context rejects a runtime response from another tenant", async () => {
  const runtime = {
    async gallery() {
      return { tenant_id: "tenant-b", works: [] };
    },
    async read() {
      throw new Error("read_must_not_run");
    },
  };
  const provider = createGalleryMemoryContextProvider(runtime);
  await assert.rejects(
    provider({ project_id: "project-a" }, authorizedIdentity()),
    /tenant_memory_context_tenant_mismatch/,
  );
});

test("explicit Work lookup cannot be mislabeled as another project", async () => {
  const runtime = {
    async gallery() {
      throw new Error("gallery_must_not_run_for_explicit_work");
    },
    async read() {
      return workState(WORK_IDS[0]);
    },
  };
  const provider = createGalleryMemoryContextProvider(runtime);
  await assert.rejects(
    provider({ work_id: WORK_IDS[0], project_id: "project-b" }, authorizedIdentity()),
    /tenant_memory_context_project_mismatch/,
  );
});

test("Gallery memory context never projects textual Work objective or idea fields", async () => {
  const rawObjectiveMarker = `objective-${crypto.randomUUID()}`;
  const rawIdeaMarker = `idea-${crypto.randomUUID()}`;
  const runtime = {
    async gallery() {
      throw new Error("gallery_must_not_run_for_explicit_work");
    },
    async read() {
      return workState(WORK_IDS[0], {
        work: {
          objective: rawObjectiveMarker,
          idea: rawIdeaMarker,
          next_action: "Run the tenant-scoped verification.",
        },
      });
    },
  };
  const provider = createGalleryMemoryContextProvider(runtime);
  const context = await provider({ work_id: WORK_IDS[0] }, authorizedIdentity());
  const serialized = JSON.stringify(context);

  assert.equal(serialized.includes(rawObjectiveMarker), false);
  assert.equal(serialized.includes(rawIdeaMarker), false);
  assert.equal(serialized.includes("\"objective\":"), false);
  assert.equal(serialized.includes("\"idea\":"), false);
  assert.equal(
    context.relevant_memories[0].summary,
    `work_id=${WORK_IDS[0]}; status=active; current_version=3; next_action=Run the tenant-scoped verification.`,
  );
});

test("Gallery memory context is bounded, redacted and never returns raw capsule or event payloads", async () => {
  const generatedCredential = `gho_${crypto.randomBytes(18).toString("hex")}`;
  const readCalls = [];
  const runtime = {
    async gallery(identity, input) {
      assert.equal(identity.tenantId, "tenant-a");
      assert.deepEqual(input, { project_id: "project-a", status: "active", limit: 2 });
      return {
        tenant_id: "tenant-a",
        works: WORK_IDS.map((work_id) => ({ tenant_id: "tenant-a", work_id })),
      };
    },
    async read(identity, input) {
      assert.equal(identity.tenantId, "tenant-a");
      readCalls.push(input);
      const index = WORK_IDS.indexOf(input.work_id);
      return workState(input.work_id, {
        work: {
          objective: `${"x".repeat(990)} token=${generatedCredential}`,
          updated_at: `2030-01-0${index + 1}T00:00:00.000Z`,
        },
        latest_capsule: {
          capsule_id: `${index + 1}`.repeat(8) + "-1111-4111-8111-111111111111",
          capsule_digest: String(index + 1).repeat(64),
          created_at: `2030-01-0${index + 1}T00:00:00.000Z`,
          capsule: {
            next_action: `token=${generatedCredential}`,
            snapshot: { raw_prompt: generatedCredential },
            evidence: [{ raw: generatedCredential }],
            tests: [{ command: generatedCredential }],
            authorizations: [],
            rollback: { available: true, value: generatedCredential },
            state_hashes: { repository_hash: "f".repeat(64) },
          },
        },
        events: [
          {
            event_id: `${index + 4}`.repeat(8) + "-1111-4111-8111-111111111111",
            sequence_number: 8 + index,
            event_type: "handoff_created",
            payload: {
              capsule_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              capsule_digest: "a".repeat(64),
              handoff_to: "all",
              raw_prompt: generatedCredential,
            },
            event_hash: "b".repeat(64),
            created_at: `2030-01-0${index + 1}T01:00:00.000Z`,
          },
          {
            event_id: `${index + 7}`.repeat(8) + "-1111-4111-8111-111111111111",
            sequence_number: 9 + index,
            event_type: "message_posted",
            payload: { message_id: "message-reference", body: generatedCredential },
            event_hash: "c".repeat(64),
            created_at: `2030-01-0${index + 1}T02:00:00.000Z`,
          },
        ],
      });
    },
  };
  const provider = createGalleryMemoryContextProvider(runtime, { maxWorks: 2, activityLimit: 2 });
  const first = await provider(
    { project_id: "project-a", limit: 50, activity_limit: 50 },
    authorizedIdentity(),
  );
  const second = await provider(
    { project_id: "project-a", limit: 50, activity_limit: 50 },
    authorizedIdentity(),
  );
  const serialized = JSON.stringify(first);

  assert.equal(readCalls.length, 4);
  assert(readCalls.every((call) => call.event_limit === 2));
  assert.equal(first.relevant_memories.length, 2);
  assert.equal(first.pending_handoffs.length, 2);
  assert.equal(first.recent_activity.length, 2);
  assert.equal(first.revision, second.revision);
  assert(Number.isSafeInteger(first.revision) && first.revision >= 0);
  assert.equal(serialized.includes(generatedCredential), false);
  assert.match(serialized, /\[REDACTED_SECRET\]/);
  assert.equal(serialized.includes("\"raw_prompt\":"), false);
  assert.equal(serialized.includes("snapshot"), false);
  assert.equal(serialized.includes("command"), false);
  assert.equal(first.latest_checkpoint.evidence_count, 1);
  assert.equal(first.latest_checkpoint.test_count, 1);
  assert.equal(first.latest_checkpoint.rollback_ready, true);
  assert.deepEqual(Object.keys(first.pending_handoffs[0]).sort(), [
    "capsule_digest",
    "capsule_id",
    "created_at",
    "event_id",
    "event_type",
    "kind",
    "sequence_number",
    "to_agent_id",
    "work_id",
  ]);
});

test("Gallery memory context returns a stable empty read-only context", async () => {
  const runtime = {
    async gallery(identity, input) {
      assert.equal(identity.tenantId, "tenant-a");
      assert.equal(input.status, "active");
      return { tenant_id: "tenant-a", works: [] };
    },
    async read() {
      throw new Error("read_must_not_run");
    },
  };
  const provider = createGalleryMemoryContextProvider(runtime);
  const context = await provider(
    { project_id: "project-a", session_id: "session-a" },
    authorizedIdentity(),
  );

  assert.equal(context.revision, 0);
  assert.equal(context.latest_checkpoint, null);
  assert.deepEqual(context.pending_handoffs, []);
  assert.deepEqual(context.relevant_memories, []);
  assert.deepEqual(context.recent_activity, []);
  assert.equal(context.policy.raw_prompts_stored_automatically, false);
  assert.equal(context.policy.secrets_storable, false);
});

test("server provider selection preserves Memory Fabric priority and uses Gallery only as fallback", async () => {
  let galleryCalls = 0;
  const runtime = {
    async gallery() {
      galleryCalls += 1;
      return { tenant_id: "tenant-a", works: [] };
    },
    async read() {
      throw new Error("read_must_not_run");
    },
  };
  const memoryFabric = {
    context(input, identity) {
      return { source: "memory-fabric", input, tenant_id: identity.tenantId };
    },
  };

  const preferred = selectTenantMemoryContextProvider({ memoryFabric, workContinuityRuntime: runtime });
  assert.deepEqual(await preferred({ project_id: "project-a" }, { tenantId: "tenant-a" }), {
    source: "memory-fabric",
    input: { project_id: "project-a" },
    tenant_id: "tenant-a",
  });
  assert.equal(galleryCalls, 0);

  const fallback = selectTenantMemoryContextProvider({ workContinuityRuntime: runtime });
  const fallbackContext = await fallback({}, authorizedIdentity());
  assert.equal(fallbackContext.policy.source, "tenant_work_gallery_postgresql");
  assert.equal(galleryCalls, 1);
  assert.equal(selectTenantMemoryContextProvider(), null);
});

test("Gallery memory context rejects identities without Work membership before runtime access", async () => {
  let galleryCalls = 0;
  let readCalls = 0;
  const runtime = {
    async gallery() {
      galleryCalls += 1;
      return { tenant_id: "tenant-a", works: [] };
    },
    async read() {
      readCalls += 1;
      return workState(WORK_IDS[0]);
    },
  };
  const provider = createGalleryMemoryContextProvider(runtime);

  await assert.rejects(
    provider({ work_id: WORK_IDS[0] }, { tenantId: "tenant-a", kind: "oauth" }),
    (error) => error?.code === "tenant_work_membership_required",
  );
  assert.equal(galleryCalls, 0);
  assert.equal(readCalls, 0);
});
