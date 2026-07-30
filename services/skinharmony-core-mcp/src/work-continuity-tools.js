function annotations(readOnly) {
  return { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false, idempotentHint: true };
}

const ownerProperties = {
  owner_confirmed: { type: "boolean", description: "Set true only after the owner confirms this exact write." },
  confirmation_reference: { type: "string", maxLength: 240 },
};
const presence = {
  agent_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" },
  client_type: { type: "string", enum: ["chatgpt", "codex", "api_agent", "other"] },
  session_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" },
};
const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const text = (maxLength = 20_000) => ({ type: "string", minLength: 1, maxLength });
const identifier = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const uuid = { type: "string", format: "uuid" };
const stateHashes = object({ repository_hash: hash, policy_hash: hash, live_state_hash: hash },
  ["repository_hash", "policy_hash", "live_state_hash"]);
const leaseSurface = object({
  kind: { type: "string", enum: ["file", "component", "dependency"] },
  value: { type: "string", minLength: 1, maxLength: 500 },
}, ["kind", "value"]);

function tool(name, title, description, inputSchema, readOnly, options = {}) {
  const tenantBoundedCollaboration =
    !readOnly && options.tenantBoundedCollaboration === true;
  const ownerConfirmationRequired =
    !readOnly && tenantBoundedCollaboration !== true;
  const schema = {
    ...inputSchema,
    properties: {
      ...inputSchema.properties,
      ...presence,
      ...(ownerConfirmationRequired ? ownerProperties : {}),
    },
  };
  return {
    name, title, description, inputSchema: schema,
    scopes: [readOnly ? "core:read" : "core:govern"],
    annotations: annotations(readOnly),
    ...(!readOnly ? {
      _meta: {
        "skinharmony/ownerConfirmationRequired": ownerConfirmationRequired,
        ...(tenantBoundedCollaboration ? {
          "skinharmony/tenantBoundedCollaboration": true,
          "skinharmony/boundedActionType": options.boundedActionType,
        } : {}),
      },
    } : {}),
  };
}

const boundedCollaboration = (boundedActionType) => ({
  tenantBoundedCollaboration: true,
  boundedActionType,
});

export const WORK_CONTINUITY_TOOLS = [
  tool("work_continuity_create", "Create persistent work continuity",
    "Create tenant-scoped Work Identity and the first architecture-map version with a hash-chained event ledger.",
    object({
      project_id: identifier, work_id: uuid, session_id: identifier, parent_work_id: uuid,
      idea: text(8_000), objective: text(8_000), architecture: { type: "object", additionalProperties: true },
      repository_hash: hash, policy_hash: hash, live_state_hash: hash, next_action: text(4_000),
    }, ["project_id", "session_id", "idea", "objective", "architecture", "next_action"]), false),
  tool("work_continuity_record_change", "Version architecture and impact map",
    "Persist a new architecture version and calculate affected functions, components, links, dependencies, depth and regressions.",
    object({
      work_id: uuid, expected_version: { type: "integer", minimum: 1 },
      architecture: { type: "object", additionalProperties: true },
      change: object({
        function_id: { type: "string", maxLength: 160 }, reason: text(2_000),
        components: { type: "array", maxItems: 100, items: { type: "string", maxLength: 160 } },
        dependencies: { type: "array", maxItems: 100, items: { type: "string", maxLength: 160 } },
        links: { type: "array", maxItems: 100, items: { type: "string", maxLength: 160 } },
        regression_targets: { type: "array", maxItems: 100, items: { type: "string", maxLength: 160 } },
        depth_delta: { type: "integer", minimum: -16, maximum: 16 },
      }, ["reason"]),
      event_type: { type: "string", enum: ["branch_opened", "function_added", "function_changed", "dependency_changed", "test_completed", "defect_found", "correction_verified", "rollback_prepared"] },
      next_action: text(4_000), idempotency_key: text(160),
    }, ["work_id", "expected_version", "architecture", "change", "next_action", "idempotency_key"]), false),
  tool("work_continuity_checkpoint", "Create continuity capsule",
    "Create a digest-verifiable Continuity Capsule with snapshot, evidence, commit, tests, authorization, rollback and next action.",
    object({
      work_id: uuid, evidence: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } },
      commit_patch: { type: "object", additionalProperties: true },
      tests: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } },
      authorizations: { type: "array", maxItems: 50, items: { type: "object", additionalProperties: true } },
      rollback: { type: "object", additionalProperties: true }, next_action: text(4_000),
      provenance: { type: "object", additionalProperties: true },
      repository_hash: hash, policy_hash: hash, live_state_hash: hash,
      supervisor_approved: { type: "boolean" }, handoff_to: { type: "string", maxLength: 120 },
      idempotency_key: text(160),
    }, ["work_id", "next_action", "rollback", "provenance", "idempotency_key"]), false),
  tool("work_continuity_read", "Read persistent work continuity",
    "Read one tenant-scoped work identity, latest architecture, capsule and hash-chained events.",
    object({ work_id: uuid, event_limit: { type: "integer", minimum: 1, maximum: 200 } }, ["work_id"]), true),
  tool("work_continuity_resume", "Resume verified persistent work",
    "Resume only after capsule digest, drift checks and a fresh Universal Core authorization recalculation.",
    object({ work_id: uuid, session_id: identifier, current_state_hashes: stateHashes, idempotency_key: text(160) },
      ["work_id", "session_id", "current_state_hashes", "idempotency_key"]), false),
  tool("work_continuity_verify_memory", "Promote verified continuity memory",
    "Mark a capsule as verified memory only after test evidence and prior Supervisor approval.",
    object({ work_id: uuid, capsule_id: uuid, test_evidence: text(4_000), idempotency_key: text(160) },
      ["work_id", "capsule_id", "test_evidence", "idempotency_key"]), false),
  tool("tenant_work_gallery_list", "Browse tenant work gallery",
    "List and search tenant-scoped work with project, status, participant, branch and active-lease summaries.",
    object({
      project_id: identifier,
      status: { type: "string", maxLength: 40 },
      query: { type: "string", maxLength: 240 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    }), true),
  tool("tenant_work_gallery_join", "Join shared tenant work",
    "Join an existing tenant work as a temporary participant session; no user or agent becomes permanent owner.",
    object({
      work_id: uuid, branch_id: uuid,
      ttl_seconds: { type: "integer", minimum: 1, maximum: 3_600 },
      metadata: { type: "object", additionalProperties: true },
      idempotency_key: text(160),
    }, ["work_id", "session_id", "agent_id", "idempotency_key"]), false,
    boundedCollaboration("tenant_work.gallery_join")),
  tool("tenant_work_gallery_heartbeat", "Renew participant presence",
    "Renew a participant session and recover expired work leases transactionally.",
    object({
      work_id: uuid,
      ttl_seconds: { type: "integer", minimum: 1, maximum: 3_600 },
      idempotency_key: text(160),
    }, ["work_id", "session_id", "agent_id", "idempotency_key"]), false,
    boundedCollaboration("tenant_work.gallery_heartbeat")),
  tool("tenant_work_branch_open", "Open a work-aware branch",
    "Create or join a named branch inside one work and correlate it to the active participant session.",
    object({
      work_id: uuid, branch_key: identifier, parent_branch_id: uuid,
      title: text(240), objective: text(4_000), idempotency_key: text(160),
    }, ["work_id", "session_id", "agent_id", "branch_key", "title", "objective", "idempotency_key"]), false,
    boundedCollaboration("tenant_work.branch_open")),
  tool("tenant_work_lease_acquire", "Acquire bounded work lease",
    "Acquire a temporary lease over files, components or dependencies after transactional overlap detection.",
    object({
      work_id: uuid, branch_id: uuid, purpose: text(2_000),
      surfaces: { type: "array", minItems: 1, maxItems: 100, items: leaseSurface },
      ttl_seconds: { type: "integer", minimum: 1, maximum: 3_600 },
      idempotency_key: text(160),
    }, ["work_id", "session_id", "agent_id", "purpose", "surfaces", "idempotency_key"]), false,
    boundedCollaboration("tenant_work.lease_acquire")),
  tool("tenant_work_lease_renew", "Renew bounded work lease",
    "Renew only an active temporary lease held by the same authenticated participant session.",
    object({
      work_id: uuid, lease_id: uuid,
      ttl_seconds: { type: "integer", minimum: 1, maximum: 3_600 },
      idempotency_key: text(160),
    }, ["work_id", "session_id", "agent_id", "lease_id", "idempotency_key"]), false,
    boundedCollaboration("tenant_work.lease_renew")),
  tool("tenant_work_lease_release", "Release bounded work lease",
    "Release a temporary work lease held by the same authenticated participant session.",
    object({ work_id: uuid, lease_id: uuid, idempotency_key: text(160) },
      ["work_id", "session_id", "agent_id", "lease_id", "idempotency_key"]), false,
    boundedCollaboration("tenant_work.lease_release")),
  tool("tenant_work_message_post", "Post structured work message",
    "Post a tenant- and work-scoped structured update to one participant or broadcast it inside the work.",
    object({
      work_id: uuid, branch_id: uuid, to_session_id: identifier,
      message_type: { type: "string", enum: ["update", "handoff", "conflict", "decision", "test", "blocker"] },
      subject: text(240), payload: { type: "object", additionalProperties: true },
      idempotency_key: text(160),
    }, ["work_id", "session_id", "agent_id", "message_type", "subject", "payload", "idempotency_key"]), false,
    boundedCollaboration("tenant_work.message_post")),
  tool("tenant_work_inbox", "Read structured work inbox",
    "Read direct and broadcast structured messages visible to an authenticated participant within one work.",
    object({
      work_id: uuid, branch_id: uuid, since: { type: "string", format: "date-time" },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    }, ["work_id", "session_id", "agent_id"]), true),
];
