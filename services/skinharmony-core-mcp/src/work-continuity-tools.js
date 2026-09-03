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
const identifier = {
  type: "string",
  pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,63}$",
};
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const coordinationIdempotencyKey = {
  type: "string",
  minLength: 8,
  maxLength: 160,
  // Keep the public capability schema aligned with Universal Core's bounded
  // coordination contract: callers that pass schema validation must not be
  // rejected later solely for a control character in this key.
  pattern: "^[^\\u0000-\\u001f\\u007f]+$",
};
const gitSha = { type: "string", pattern: "^[a-f0-9]{40}$" };
const exactBranch = {
  type: "string",
  minLength: 1,
  maxLength: 200,
  pattern: "^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$",
};
const uuid = { type: "string", format: "uuid" };
const nativeHost = { type: "string", enum: ["chatgpt_native", "codex_native"] };
const nativeAgentId = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{1,119}$" };
const hostTaskId = {
  type: "string",
  minLength: 2,
  maxLength: 240,
  pattern: "^(?:/[a-zA-Z0-9][a-zA-Z0-9_/-]*|[a-zA-Z0-9][a-zA-Z0-9._:/-]*)$",
};
const stateHashes = object({ repository_hash: hash, policy_hash: hash, live_state_hash: hash },
  ["repository_hash", "policy_hash", "live_state_hash"]);
const leaseSurface = object({
  kind: { type: "string", enum: ["file", "component", "dependency", "causal_project", "causal_change", "causal_obligation"] },
  value: { type: "string", minLength: 1, maxLength: 500 },
}, ["kind", "value"]);

const TENANT_WORK_COORDINATION_ACTION_TYPES = Object.freeze({
  // A review is the only pre-Work mutation: it stores a short-lived,
  // tenant-bound duplicate check and never creates or changes a Work.
  // Give it a distinct Core action type so it cannot be forced through the
  // generic continuity path, which requires the Work binding it establishes.
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
  // Task state is a bounded coordination update; evidence stays on the
  // continuity path but receives a Core-valid, server-derived target below.
  tenant_work_task_record: "task.update",
  tenant_work_evidence_record: "continuity.update",
});

export function tenantWorkCoordinationActionType(toolName) {
  return TENANT_WORK_COORDINATION_ACTION_TYPES[String(toolName || "")] || null;
}

// Keep this in lockstep with work-continuity-runtime.js: canonical Work ids
// accept UUID versions 1 through 8.  A narrower target validator would turn a
// valid v6/v7/v8 Work into the generic tool name and make Atlas coordination
// fail closed in Universal Core.
const WORK_ID_TARGET = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

// Core validates the action type against this target. Never accept a caller
// target: derive the only permitted target shape from the validated Work id.
export function tenantWorkCoordinationTarget(toolName, args = {}) {
  const name = String(toolName || "");
  const workId = String(args?.work_id || "").trim().toLowerCase();
  if (name === "tenant_work_queue_create_v3") return name;
  if (!WORK_ID_TARGET.test(workId)) return name;
  if ([
    "tenant_work_assign_v3",
    "tenant_work_assignment_accept_v3",
    "tenant_work_archive_v3",
    "tenant_work_reopen_v3",
  ].includes(name)) return workId;
  // Repository Atlas bootstrap is a bounded internal graph mutation. Its
  // public capability name intentionally does not contain `atlas`, so derive
  // the Core-recognised Atlas target from the validated Work identifier.
  if (name === "software_cognition_repository_bootstrap") return `work_atlas:${workId}`;
  if (name === "tenant_work_task_record") return `task:${workId}`;
  if (name === "tenant_work_evidence_record") return `work_continuity_evidence:${workId}`;
  return name;
}

function tool(name, title, description, inputSchema, readOnly, options = {}) {
  const boundedCollaboration = options.boundedCollaboration === true;
  const ownerConfirmationRequired =
    !readOnly && !boundedCollaboration && options.ownerConfirmationRequired !== false;
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
        ...(boundedCollaboration
          ? { "skinharmony/tenantBoundedCollaboration": true }
          : {}),
        ...(options.delegationAware === true
          ? { "skinharmony/delegationAware": true }
          : {}),
        ...(options.dedicatedCoreGate === true
          ? { "skinharmony/dedicatedCoreGate": true }
          : {}),
        ...(options.serverOwnedGovernance === true
          ? { "skinharmony/serverOwnedGovernance": true }
          : {}),
      },
    } : {}),
  };
}

export const WORK_CONTINUITY_TOOLS = [
  tool("work_continuity_create", "Create persistent work continuity",
    "Retired legacy creation entrypoint. It fails closed with canonical_work_bootstrap_v2_required; use Nyra's duplicate-reviewed canonical V2 bootstrap.",
    object({
      project_id: identifier, work_id: uuid, session_id: identifier, parent_work_id: uuid,
      idea: text(8_000), objective: text(8_000), architecture: { type: "object", additionalProperties: true },
      repository_hash: hash, policy_hash: hash, live_state_hash: hash, next_action: text(4_000),
    }, ["project_id", "session_id", "idea", "objective", "architecture", "next_action"]), false, {
      dedicatedCoreGate: true,
      serverOwnedGovernance: true,
    }),
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
    }, ["work_id", "next_action", "rollback", "provenance", "idempotency_key"]), false, {
      dedicatedCoreGate: true,
      serverOwnedGovernance: true,
    }),
  tool("work_continuity_read", "Read persistent work continuity",
    "Read one tenant-scoped work identity, latest architecture, capsule and hash-chained events.",
    object({ work_id: uuid, event_limit: { type: "integer", minimum: 1, maximum: 200 } }, ["work_id"]), true),
  tool("work_continuity_resume", "Resume verified persistent work",
    "Resume only after capsule digest, drift checks and a fresh Universal Core authorization recalculation.",
    object({ work_id: uuid, session_id: identifier, current_state_hashes: stateHashes,
      idempotency_key: coordinationIdempotencyKey },
      ["work_id", "session_id", "current_state_hashes", "idempotency_key"]), false, {
        ownerConfirmationRequired: false,
        boundedCollaboration: true,
        dedicatedCoreGate: true,
        serverOwnedGovernance: true,
      }),
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
  tool("tenant_work_coordination_read", "Read verified Work coordination",
    "Read the exact tenant-scoped participant sessions, freshness and leases for one Work without joining, renewing or mutating it.",
    object({
      work_id: uuid,
      include_inactive: { type: "boolean" },
    }, ["work_id"]), true),
  tool("tenant_work_coordination_overview", "Read active AI coordination overview",
    "List verified participant sessions and leases across the caller's authorized Work Gallery without joining or mutating any Work.",
    object({
      project_id: identifier,
      limit: { type: "integer", minimum: 1, maximum: 100 },
    }), true),
  tool("tenant_work_gallery_join", "Join shared tenant work",
    "Join an existing tenant work as a temporary participant session; no user or agent becomes permanent owner.",
    object({
      work_id: uuid, branch_id: uuid,
      ttl_seconds: { type: "integer", minimum: 1, maximum: 3_600 },
      metadata: { type: "object", additionalProperties: true },
      idempotency_key: coordinationIdempotencyKey,
    }, ["work_id", "session_id", "agent_id", "idempotency_key"]), false, { boundedCollaboration: true }),
  tool("tenant_work_gallery_heartbeat", "Renew participant presence",
    "Renew a participant session and recover expired work leases transactionally.",
    object({
      work_id: uuid,
      ttl_seconds: { type: "integer", minimum: 1, maximum: 3_600 },
      idempotency_key: coordinationIdempotencyKey,
    }, ["work_id", "session_id", "agent_id", "idempotency_key"]), false, { boundedCollaboration: true }),
  tool("tenant_work_branch_open", "Open a work-aware branch",
    "Create or join a named branch inside one work and correlate it to the active participant session.",
    object({
      work_id: uuid, branch_key: identifier, parent_branch_id: uuid,
      title: text(240), objective: text(4_000), idempotency_key: coordinationIdempotencyKey,
    }, ["work_id", "session_id", "agent_id", "branch_key", "title", "objective", "idempotency_key"]), false, { boundedCollaboration: true }),
  tool("tenant_work_lease_acquire", "Acquire bounded work lease",
    "Acquire a temporary lease over legacy work surfaces or an exact causal project/change/obligation set after transactional overlap detection. Causal authority is assigned only by server policy.",
    object({
      work_id: uuid, branch_id: uuid, purpose: text(2_000),
      surfaces: { type: "array", minItems: 1, maxItems: 100, items: leaseSurface },
      ttl_seconds: { type: "integer", minimum: 1, maximum: 3_600 },
      idempotency_key: coordinationIdempotencyKey,
    }, ["work_id", "session_id", "agent_id", "purpose", "surfaces", "idempotency_key"]), false, { boundedCollaboration: true }),
  tool("tenant_work_lease_renew", "Renew bounded work lease",
    "Renew only an active temporary lease held by the same authenticated participant session.",
    object({
      work_id: uuid, lease_id: uuid,
      ttl_seconds: { type: "integer", minimum: 1, maximum: 3_600 },
      idempotency_key: coordinationIdempotencyKey,
    }, ["work_id", "session_id", "agent_id", "lease_id", "idempotency_key"]), false, { boundedCollaboration: true }),
  tool("tenant_work_lease_release", "Release bounded work lease",
    "Release a temporary work lease held by the same authenticated participant session.",
    object({ work_id: uuid, lease_id: uuid, idempotency_key: coordinationIdempotencyKey },
      ["work_id", "session_id", "agent_id", "lease_id", "idempotency_key"]), false, { boundedCollaboration: true }),
  tool("tenant_work_message_post", "Post structured work message",
    "Post a tenant- and work-scoped structured update to one participant or broadcast it inside the work.",
    object({
      work_id: uuid, branch_id: uuid, to_session_id: identifier,
      message_type: { type: "string", enum: ["update", "handoff", "conflict", "decision", "test", "blocker"] },
      subject: text(240), payload: { type: "object", additionalProperties: true },
      idempotency_key: coordinationIdempotencyKey,
    }, ["work_id", "session_id", "agent_id", "message_type", "subject", "payload", "idempotency_key"]), false, { boundedCollaboration: true }),
  tool("tenant_work_inbox", "Read structured work inbox",
    "Read direct and broadcast structured messages visible to an authenticated participant within one work.",
    object({
      work_id: uuid, branch_id: uuid, since: { type: "string", format: "date-time" },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    }, ["work_id", "session_id", "agent_id"]), true),
  tool("work_continuity_start_or_resume", "Anchor or resume governed work",
    "Resume an existing tenant-scoped Work Identity only. It never creates; absence requires Nyra's duplicate-reviewed canonical V2 bootstrap.",
    object({
      work_id: uuid, parent_work_id: uuid, project_id: identifier, session_id: identifier,
      initial_message: text(20_000), idea: text(8_000), objective: text(8_000),
      acceptance_criteria: { type: "array", maxItems: 250, items: text(2_000) },
      constraints: { type: "array", maxItems: 100, items: text(1_000) },
      architecture: { type: "object", additionalProperties: true }, next_action: text(4_000),
      host_type: nativeHost, resume_existing: { type: "boolean" },
      repository_hash: hash, policy_hash: hash, live_state_hash: hash,
    }, ["project_id", "session_id", "initial_message", "idea", "objective", "architecture", "next_action"]),
    false, {
      ownerConfirmationRequired: false,
      boundedCollaboration: true,
      dedicatedCoreGate: true,
      serverOwnedGovernance: true,
    }),
  tool("work_continuity_intent_read", "Read immutable Intent Anchor",
    "Read the redacted immutable Intent Anchor and digest for one tenant-scoped work identity.",
    object({ work_id: uuid }, ["work_id"]), true),
  tool("work_continuity_work_catalog", "Read tenant Work Catalog",
    "List compact tenant-scoped Work Identities and their current version, status, next action and reusable Atlas/incident pointers without returning raw prompts.",
    object({
      project_id: identifier,
      status: { type: "string", enum: ["active", "verified", "release_ready", "completed", "cancelled", "superseded", "blocked", "failed"] },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      cursor: { type: "string", maxLength: 240 },
    }), true),
  tool("work_continuity_v2_create", "Create Work Identity V2",
    "Create one owner-governed generic or adapter-backed Work Identity while retaining a linked legacy continuity record.",
    object({
      intent_type: { type: "string", const: "CREATE_WORK" }, request_id: text(160),
      idempotency_key: text(240),
      review_id: uuid, review_digest: hash,
      review_decision: { type: "string", enum: ["CONTINUE_NEW_WORK", "PARALLEL_VALID"] },
      project_id: identifier, work_id: uuid, session_id: identifier, work_name: text(1_000),
      work_type: { type: "string", enum: ["software_git", "software_non_git", "deployment", "research", "document", "commercial_crm", "hardware", "generic"] },
      idea: text(8_000), objective: text(8_000), architecture: { type: "object", additionalProperties: true },
      next_action: text(4_000), visibility_scope: { type: "string", enum: ["private", "shared", "team", "tenant"] },
      team_id: { type: "string", maxLength: 128 },
      assigned_user_ids: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", maxLength: 128 } },
      supervising_user_ids: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", maxLength: 128 } },
      acceptance_criteria: { type: "array", minItems: 1, maxItems: 250, items: text(2_000) },
      constraints: { type: "array", maxItems: 100, items: text(1_000) },
      tasks: { type: "array", minItems: 1, maxItems: 250, items: object({
        task_id: uuid, title: text(2_000), weight: { type: "integer", minimum: 1, maximum: 10_000 }, required: { type: "boolean" },
      }, ["title"]) },
      priority_context: { type: "object", additionalProperties: true, deprecated: true }, intent_digest: hash,
    }, ["intent_type", "request_id", "review_id", "review_digest", "project_id", "session_id", "work_name", "work_type", "idea", "objective", "architecture", "next_action", "acceptance_criteria", "tasks"]),
    false, { dedicatedCoreGate: true, serverOwnedGovernance: true }),
  tool("tenant_work_queue_create_v3", "Queue an independent Work",
    "Create a tenant-scoped Work in the Gallery queue after the mandatory conflict review. This never starts execution or creates a legacy execution Work.",
    object({
      intent_type: { type: "string", const: "CREATE_WORK" }, request_id: text(160),
      review_id: uuid, review_digest: hash,
      review_decision: { type: "string", enum: ["CONTINUE_NEW_WORK", "PARALLEL_VALID"] },
      project_id: identifier, work_id: uuid, work_name: text(1_000),
      work_type: { type: "string", enum: ["software_git", "software_non_git", "deployment", "research", "document", "commercial_crm", "hardware", "generic"] },
      idea: text(8_000), objective: text(8_000), architecture: { type: "object", additionalProperties: true },
      next_action: text(4_000), visibility_scope: { type: "string", enum: ["private", "shared", "team", "tenant"] },
      team_id: { type: "string", maxLength: 128 },
      assigned_user_ids: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", maxLength: 128 } },
      supervising_user_ids: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", maxLength: 128 } },
      acceptance_criteria: { type: "array", minItems: 1, maxItems: 250, items: text(2_000) },
      tasks: { type: "array", minItems: 1, maxItems: 250, items: object({
        task_id: uuid, title: text(2_000), weight: { type: "integer", minimum: 1, maximum: 10_000 }, required: { type: "boolean" },
      }, ["title"]) },
      intent_digest: hash, idempotency_key: coordinationIdempotencyKey,
    }, ["intent_type", "request_id", "review_id", "review_digest", "project_id", "work_name", "work_type", "idea", "objective", "architecture", "next_action", "acceptance_criteria", "tasks", "idempotency_key"]),
    false, {
      ownerConfirmationRequired: false,
      boundedCollaboration: true,
      dedicatedCoreGate: true,
      serverOwnedGovernance: true,
    }),
  tool("work_continuity_v2_read", "Read Work Identity V2",
    "Read ACL-filtered V2 identity, derived progress, tasks, evidence, receipt and final report.",
    object({ work_id: uuid }, ["work_id"]), true),
  tool("tenant_work_gallery_list_v2", "Read ACL Work Gallery V2",
    "Read My, Team, Tenant, operational or Report Archive views with server-authoritative ACL.",
    object({ view: { type: "string", enum: ["my", "team", "tenant", "operational", "archive"] }, project_id: identifier }), true),
  tool("tenant_work_assign_v3", "Offer a queued Work to an AI host",
    "Offer one native Gallery Work to a specific ChatGPT or Codex agent. The offer grants no execution authority.",
    object({
      work_id: uuid,
      target_agent_id: identifier,
      target_client_type: { type: "string", enum: ["chatgpt", "codex", "api_agent", "other"] },
      idempotency_key: coordinationIdempotencyKey,
    }, ["work_id", "target_agent_id", "target_client_type", "idempotency_key"]),
    false, { ownerConfirmationRequired: false, boundedCollaboration: true }),
  tool("tenant_work_assignment_accept_v3", "Accept a Gallery Work offer",
    "Accept an offer only when the authenticated host agent exactly matches its target. Acceptance permits reading and planning only.",
    object({ work_id: uuid, idempotency_key: coordinationIdempotencyKey },
      ["work_id", "idempotency_key"]), false,
    { ownerConfirmationRequired: false, boundedCollaboration: true }),
  tool("tenant_work_archive_v3", "Archive a queued or blocked Work",
    "Move one non-terminal, native Gallery Work out of the operational queue while preserving its history. Active leases for that Work are revoked.",
    object({ work_id: uuid, reason: text(1_000), idempotency_key: coordinationIdempotencyKey },
    ["work_id", "reason", "idempotency_key"]), false,
    { ownerConfirmationRequired: false, boundedCollaboration: true }),
  tool("tenant_work_historical_archive_v3", "Archive an uncloseable historical bridged Work",
    "Owner-confirm and archive one stale V2 Work linked to legacy continuity without claiming it completed or changing the legacy record.",
    object({ work_id: uuid, expected_classification: { type: "string", enum: ["STALE", "ABANDONED"] },
      reason: text(1_000), idempotency_key: coordinationIdempotencyKey },
    ["work_id", "expected_classification", "reason", "idempotency_key"]), false,
    { dedicatedCoreGate: true, serverOwnedGovernance: true }),
  tool("tenant_work_reopen_v3", "Reopen an archived Work",
    "Return a previously user-archived native Gallery Work to PLANNED. It never restores old leases or execution authority.",
    object({ work_id: uuid, reason: text(1_000), next_action: text(4_000), idempotency_key: coordinationIdempotencyKey },
      ["work_id", "reason", "idempotency_key"]), false,
    { ownerConfirmationRequired: false, boundedCollaboration: true }),
  tool("tenant_work_open_review", "Review open Work conflicts",
    "Run mandatory create-only Work review with scored visible candidates and one opaque hidden-conflict signal.",
    object({ request: text(8_000), intent_type: { type: "string", const: "CREATE_WORK" },
      create_request: { type: "object", additionalProperties: true },
      idempotency_key: coordinationIdempotencyKey },
    ["request", "intent_type", "create_request", "idempotency_key"]), false,
    {
      ownerConfirmationRequired: false,
      boundedCollaboration: true,
      dedicatedCoreGate: true,
      serverOwnedGovernance: true,
    }),
  tool("tenant_work_task_record", "Record bounded Work task state",
    "Record bounded task execution state; acceptance remains false until independently verified evidence is persisted.",
    object({ work_id: uuid, task_id: uuid, title: text(2_000), weight: { type: "integer", minimum: 1, maximum: 10_000 },
      status: { type: "string", enum: ["planned", "completed"] }, required: { type: "boolean" } },
    ["work_id", "title", "status"]), false, { ownerConfirmationRequired: false, boundedCollaboration: true }),
  tool("tenant_work_evidence_record", "Record Work evidence",
    "Record digest-only candidate evidence. Independent status is derived only by the server-owned native verifier terminal-report bridge.",
    object({ work_id: uuid, evidence_id: uuid, kind: { type: "string", minLength: 1, maxLength: 80 }, digest: hash,
      weight: { type: "integer", minimum: 1, maximum: 10_000 }, required: { type: "boolean" }, metadata: { type: "object", additionalProperties: true } },
    ["work_id", "kind", "digest"]), false, { ownerConfirmationRequired: false, boundedCollaboration: true }),
  tool("tenant_work_stale_reconcile_dry_run", "Classify stale Work",
    "Classify effective participant/lease state and show the exact allowed reconciliation actions without changing or closing any Work.",
    object({ project_id: identifier }), true),
  tool("tenant_work_legacy_reconcile_close", "Close stale legacy Work honestly",
    "Owner-confirm and audit an exact stale legacy Work as CANCELLED or SUPERSEDED without deleting it or claiming COMPLETED. It can also repair an already-COMPLETED legacy projection only from its persisted server closure event. A release-ready Work can only be superseded by an exact same-project successor with server-persisted closure evidence.",
    object({
      work_id: uuid,
      action: { type: "string", enum: ["CANCEL", "SUPERSEDE", "REPAIR_COMPLETED_PROJECTION"] },
      expected_status: { type: "string", enum: ["active", "verified", "release_ready", "completed", "blocked", "failed"] },
      expected_classification: { type: "string", enum: ["STALE", "ABANDONED", "COMPLETED_BUT_UNCLOSED"] },
      reason: text(1_000),
      successor_work_id: uuid,
      idempotency_key: coordinationIdempotencyKey,
    }, ["work_id", "action", "expected_status", "expected_classification", "reason", "idempotency_key"]),
    false, { dedicatedCoreGate: true, serverOwnedGovernance: true }),
  tool("work_continuity_generic_core_join", "Issue generic Core Join",
    "Ask Universal Core for an evidence-only, Git-independent Join using server-persisted tasks and verifier evidence.",
    object({ work_id: uuid, adapter: { type: "string", enum: ["software_git", "software_non_git", "deployment", "research", "document", "commercial_crm", "hardware", "generic"] },
      idempotency_key: text(160) }, ["work_id", "adapter", "idempotency_key"]),
    false, { ownerConfirmationRequired: false, dedicatedCoreGate: true, serverOwnedGovernance: true }),
  tool("work_continuity_generic_closure_evaluate", "Evaluate generic Work closure",
    "Read server-persisted verifier evidence and Core Join readiness without requiring Git metadata.",
    object({ work_id: uuid, adapter: { type: "string", enum: ["software_git", "software_non_git", "deployment", "research", "document", "commercial_crm", "hardware", "generic"] } }, ["work_id", "adapter"]), true),
  tool("work_continuity_generic_closure_finalize", "Finalize generic Work closure",
    "Atomically complete, timestamp, report and logically archive only from persisted independent evidence and Core Join.",
    object({ work_id: uuid, adapter: { type: "string", enum: ["software_git", "software_non_git", "deployment", "research", "document", "commercial_crm", "hardware", "generic"] },
      idempotency_key: text(160) }, ["work_id", "adapter", "idempotency_key"]),
    false, { ownerConfirmationRequired: false, dedicatedCoreGate: true, serverOwnedGovernance: true }),
  tool("nyra_verified_work_finalize", "Finalize a verified Nyra Work",
    "Create a server-derived checkpoint and close an already verified Work through Core.",
    object({ work_id: uuid, idempotency_key: text(120) }, ["work_id", "idempotency_key"]),
    false, { ownerConfirmationRequired: true, dedicatedCoreGate: true, serverOwnedGovernance: true }),
  tool("work_continuity_native_plan", "Plan host-native agents",
    "Create a bounded Nyra/Core plan that the ChatGPT or Codex coordinator materializes with native agents. This path performs zero provider calls and requires no API key.",
    object({
      work_id: uuid, plan_id: uuid,
      repository: {
        type: "string",
        pattern: "^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$",
      },
      base_branch: exactBranch,
      host_type: nativeHost,
      required_checks: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 160 },
      },
      tasks: {
        type: "array", minItems: 1, maxItems: 3, items: object({
          task_id: { type: "string", minLength: 1, maxLength: 120 },
          kind: { type: "string", enum: ["builder", "verifier", "researcher", "reviewer", "supervisor"] },
          instruction: text(8_000), required: { type: "boolean" },
          dependencies: { type: "array", maxItems: 3, items: { type: "string", maxLength: 120 } },
        }, ["task_id", "kind", "instruction"]),
      },
      max_parallel: { type: "integer", minimum: 1, maximum: 2 },
      closure_requirements: object({
        independent_verifier_required: { type: "boolean" },
        tests_required: { type: "boolean" },
        evidence_required: { type: "boolean" },
        live_verification_required: { type: "boolean" },
      }),
      software_contract: object({
        change_id: uuid, base_state_digest: hash, goal: text(4_000),
        hypotheses: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: true } },
        assumptions: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: true } },
        affected_components: { type: "array", maxItems: 500, items: { type: "string", maxLength: 160 } },
        planned_changes: { type: "array", maxItems: 1000, items: { type: "object", additionalProperties: true } },
        expected_effects: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: true } },
        expected_non_effects: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: true } },
        risks: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: true } },
        tests: { type: "array", maxItems: 500, items: { type: "object", additionalProperties: true } },
        rollback: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: true } },
        unknowns: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: true } },
      }, ["change_id", "base_state_digest", "goal", "hypotheses", "assumptions", "affected_components", "planned_changes", "expected_effects", "expected_non_effects", "risks", "tests", "rollback", "unknowns"]),
      idempotency_key: text(160),
    }, [
      "work_id", "repository", "base_branch", "host_type", "required_checks",
      "tasks", "idempotency_key",
    ]),
    false, { ownerConfirmationRequired: false }),
  tool("work_continuity_native_bind", "Bind native agent receipt",
    "Bind one real ChatGPT/Codex child assignment to its exact work, plan, task digest and host task reference, returning a one-task capability that must be handed to that child. Planning alone never counts as agent creation.",
    object({
      work_id: uuid, plan_id: uuid, task_id: { type: "string", minLength: 1, maxLength: 120 },
      native_agent_id: nativeAgentId, host_type: nativeHost, host_task_id: hostTaskId,
      // Optional for compatibility with existing plans.  When supplied, it
      // is signed into the child assignment and is the sole task-acceptance
      // target the verifier-evidence bridge may promote.
      v2_task_id: uuid,
    }, ["work_id", "plan_id", "task_id", "native_agent_id", "host_type", "host_task_id"]),
    false, { ownerConfirmationRequired: false }),
  tool("work_continuity_native_acceptance_contract_read", "Read bound verifier acceptance contract",
    "Read only the exact persisted acceptance criteria and digests for one transport-bound native verifier assignment. Builders, coordinators, ambient callers and mismatched or expired bindings fail closed; this read never authorizes execution.",
    object({
      work_id: uuid, plan_id: uuid, native_agent_id: nativeAgentId, host_task_id: hostTaskId,
      assignment_capability: {
        type: "string",
        pattern: "^hnac_[A-Za-z0-9_-]{43}$",
      },
    }, [
      "work_id", "plan_id", "native_agent_id", "host_task_id", "assignment_capability",
    ]),
    true),
  tool("work_continuity_native_launch_request_read", "Recover Nyra native launch request",
    "Recover the latest bounded, persisted Nyra launch request for an authorized Work after a reconnect. Returns no plan body, session identity or execution authority.",
    object({ work_id: uuid }, ["work_id"]),
    true),
  tool("work_continuity_native_report", "Record native agent evidence",
    "Record one bound native child's terminal report directly from that child's transport-bound MCP session. Coordinator reports, reused sessions and wrong or replayed assignment capabilities fail closed.",
    object({
      work_id: uuid, plan_id: uuid, native_agent_id: nativeAgentId, host_task_id: hostTaskId,
      assignment_capability: {
        type: "string",
        pattern: "^hnac_[A-Za-z0-9_-]{43}$",
      },
      status: { type: "string", enum: ["completed", "failed", "blocked"] },
      report: object({
        automation_stage: { type: "string", enum: ["build", "system_verification", "final_acceptance"] },
        summary: text(8_000), verdict: { type: "string", enum: ["approved", "rejected"] },
        commit_sha: gitSha,
        precommit_evidence: object({
          schema_version: { type: "string", const: "native_precommit_evidence_v1" },
          diff_mode: { type: "string", const: "git_diff_binary_sha256_v1" },
          base_commit: gitSha,
          diff_digest: hash,
          changed_files: {
            type: "array",
            minItems: 1,
            maxItems: 1_000,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 2_000 },
          },
        }, ["schema_version", "diff_mode", "base_commit", "diff_digest", "changed_files"]),
        tests: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } },
        evidence_refs: { type: "array", maxItems: 100, items: { type: "string", maxLength: 500 } },
        acceptance_evidence: {
          type: "array",
          maxItems: 250,
          items: object({
            criterion_digest: hash,
            passed: { type: "boolean" },
            evidence_refs: {
              type: "array",
              minItems: 1,
              maxItems: 30,
              items: { type: "string", minLength: 1, maxLength: 500 },
            },
          }, ["criterion_digest", "passed", "evidence_refs"]),
        },
        verifies_task_ids: { type: "array", maxItems: 3, items: { type: "string", maxLength: 120 } },
        live_verified: { type: "boolean" }, correction_required: { type: "boolean" },
      }, ["summary"]),
    }, [
      "work_id", "plan_id", "native_agent_id", "host_task_id",
      "assignment_capability", "status", "report",
    ]),
    false, { ownerConfirmationRequired: false }),
  tool("work_continuity_precommit_ticket_gate_read", "Read governed precommit ticket gate",
    "Read the deterministic tenant/work-bound precommit ticket projection, including freshness and drift. It grants no execution authority.",
    object({ work_id: uuid }, ["work_id"]), true),
  tool("work_continuity_precommit_reconcile", "Reconcile legacy precommit evidence",
    "Core-gated append-only reconciliation of exact legacy required evidence with receipt-bound native verifier evidence and one exact V2 ticket-acquisition task. Caller booleans, titles and backfill are never accepted.",
    object({
      work_id: uuid,
      task_id: uuid,
      plan_id: uuid,
      evaluation_id: uuid,
      evaluation_digest: hash,
      workspace_digest: hash,
      mappings: {
        type: "array",
        minItems: 1,
        maxItems: 128,
        items: object({
          legacy_evidence_id: uuid,
          replacement_evidence_id: uuid,
          native_receipt_id: uuid,
          native_receipt_digest: hash,
        }, [
          "legacy_evidence_id", "replacement_evidence_id",
          "native_receipt_id", "native_receipt_digest",
        ]),
      },
      idempotency_key: coordinationIdempotencyKey,
    }, [
      "work_id", "task_id", "plan_id", "evaluation_id",
      "evaluation_digest", "workspace_digest", "mappings", "idempotency_key",
    ]), false, {
      ownerConfirmationRequired: false,
      boundedCollaboration: true,
      dedicatedCoreGate: true,
      serverOwnedGovernance: true,
    }),
  tool("work_continuity_closure_evaluate", "Evaluate independent closure",
    "Evaluate persisted native tasks and independently verified evidence, then request and persist an exact Universal Core Join before marking the work release-ready. Builder, verifier, checks and evidence are always derived server-side.",
    object({
      work_id: uuid,
      plan_id: uuid,
      release: object({
        base_branch: text(240),
        delivery_branch: text(240),
        base_commit: gitSha,
        head_commit: gitSha,
        tree_sha: gitSha,
        diff_digest: hash,
        changed_files: {
          type: "array",
          minItems: 1,
          maxItems: 2_000,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 2_000 },
        },
        delivery: object({
          method: {
            type: "string",
            enum: [
              "github_branch_push_auto_deploy",
              "github_protected_push_auto_deploy",
              "manual_render_deploy",
            ],
          },
          services: {
            type: "array",
            minItems: 1,
            maxItems: 32,
            items: object({
              service_id: text(160),
              environment: { type: "string", enum: ["staging", "production"] },
              expected_previous_commit: gitSha,
              target_commit: {
                anyOf: [gitSha, { type: "null" }],
              },
              target_resolution: {
                type: "string",
                enum: ["exact_commit", "post_merge_readback"],
              },
              health_contract_digest: hash,
            }, [
              "service_id",
              "environment",
              "expected_previous_commit",
              "target_commit",
              "target_resolution",
              "health_contract_digest",
            ]),
          },
        }, ["method", "services"]),
        rollback: object({
          mode: {
            type: "string",
            enum: ["forward_revert", "redeploy_previous_commit"],
          },
          target_commit: gitSha,
          health_contract_digest: hash,
          ready: { type: "boolean", const: true },
        }, ["mode", "target_commit", "health_contract_digest", "ready"]),
      }, [
        "base_branch",
        "delivery_branch",
        "base_commit",
        "head_commit",
        "tree_sha",
        "diff_digest",
        "changed_files",
        "delivery",
        "rollback",
      ]),
      idempotency_key: text(160),
    }, ["work_id", "plan_id", "idempotency_key"]),
    false, { ownerConfirmationRequired: false }),
  tool("work_continuity_closure_rejoin_persisted_release", "Rejoin persisted release closure",
    "Re-evaluate a closed Work and renew its Universal Core Join using only the immutable release intent already persisted for that exact Work and plan. The caller cannot supply commits, manifest, services or rollback data.",
    object({
      work_id: uuid,
      plan_id: uuid,
      idempotency_key: text(160),
    }, ["work_id", "plan_id", "idempotency_key"]),
    false, {
      ownerConfirmationRequired: false,
      dedicatedCoreGate: true,
      serverOwnedGovernance: true,
    }),
  tool("work_continuity_closure_finalize", "Finalize verified live work",
    "Complete work only from a fresh authenticated Universal Core receipt for the exact completed action ticket. Commit, CI, live health, rollback and host-policy facts are read server-side and cannot be supplied by the caller.",
    object({
      work_id: uuid, plan_id: uuid,
      action_ticket_id: {
        type: "string",
        pattern: "^hnt_[A-Za-z0-9-]{8,160}$",
        maxLength: 164,
      },
      idempotency_key: text(160),
    }, ["work_id", "plan_id", "action_ticket_id", "idempotency_key"]),
    false, { ownerConfirmationRequired: false, delegationAware: true }),
  tool("work_continuity_atlas_upsert", "Update incremental Work Atlas",
    "Update only changed project nodes and dependency edges, retaining exact byte metrics and work provenance so future agents avoid full repository rescans.",
    object({
      work_id: uuid, expected_revision: { type: "integer", minimum: 0 },
      nodes: {
        type: "array", minItems: 1, maxItems: 500, items: object({
          node_id: { type: "string", minLength: 1, maxLength: 160 },
          node_kind: { type: "string", minLength: 1, maxLength: 60 },
          path: { type: "string", maxLength: 2_000 }, symbol: { type: "string", maxLength: 500 },
          summary: { type: "string", maxLength: 4_000 },
          metadata: { type: "object", additionalProperties: true },
        }, ["node_id", "node_kind"]),
      },
      edges: {
        type: "array", maxItems: 2_000, items: object({
          from_node_id: { type: "string", minLength: 1, maxLength: 160 },
          to_node_id: { type: "string", minLength: 1, maxLength: 160 },
          edge_type: { type: "string", minLength: 1, maxLength: 60 },
        }, ["from_node_id", "to_node_id", "edge_type"]),
      },
      allow_existing_edge_nodes: { type: "boolean" }, replace: { type: "boolean" },
      source_hash: hash, idempotency_key: text(160),
    }, ["work_id", "nodes", "idempotency_key"]),
    false, { ownerConfirmationRequired: false }),
  tool("work_continuity_atlas_select", "Select bounded Work Atlas context",
    "Resolve only seed nodes and bounded dependencies from one exact work, or deterministically aggregate every tenant-scoped work for a project, with provenance, exact selected/avoided byte metrics and no full scan.",
    object({
      work_id: uuid, project_id: identifier,
      seed_node_ids: { type: "array", minItems: 1, maxItems: 50, items: { type: "string", maxLength: 160 } },
      max_depth: { type: "integer", minimum: 0, maximum: 4 },
      max_nodes: { type: "integer", minimum: 1, maximum: 500 },
      edge_types: { type: "array", maxItems: 40, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 60 } },
      max_bytes: { type: "integer", minimum: 256, maximum: 128_000 },
    }, ["seed_node_ids"]), true),
  tool("work_continuity_incident_record", "Record incident runbook candidate",
    "Record an exact-scoped recovery candidate by repository, branch, connector, deployment path and configuration digest. Candidates are never reused until independently verified.",
    object({
      work_id: uuid, project_id: identifier,
      scope: object({
        error_code: { type: "string", minLength: 1, maxLength: 120 },
        repository: text(240), branch: text(240), connector: text(120),
        deployment_path: text(120), configuration_digest: hash,
      }, ["error_code", "repository", "branch", "connector", "deployment_path", "configuration_digest"]),
      runbook: object({
        title: text(500),
        preconditions: { type: "array", maxItems: 30, items: text(1_000) },
        steps: { type: "array", minItems: 1, maxItems: 30, items: text(2_000) },
        verification: { type: "array", maxItems: 30, items: text(1_000) },
        rollback: { type: "array", maxItems: 30, items: text(1_000) },
      }, ["title", "steps"]),
    }, ["work_id", "project_id", "scope", "runbook"]),
    false, { ownerConfirmationRequired: false }),
  tool("work_continuity_incident_verify", "Verify incident runbook",
    "Promote a runbook only when a different native agent supplies passing tests and evidence; failed reuse is counted and repeated failure quarantines it.",
    object({
      work_id: uuid, project_id: identifier, fingerprint: hash, resolved: { type: "boolean" },
      tests: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } },
      evidence_refs: { type: "array", maxItems: 100, items: { type: "string", maxLength: 500 } },
    }, ["work_id", "project_id", "fingerprint", "resolved"]),
    false, { ownerConfirmationRequired: false }),
  tool("work_continuity_incident_resolve", "Find verified incident recovery",
    "Return a verified runbook only for an exact fingerprint and matching preconditions; otherwise require fresh diagnosis and revalidation.",
    object({
      project_id: identifier,
      scope: object({
        error_code: { type: "string", minLength: 1, maxLength: 120 },
        repository: text(240), branch: text(240), connector: text(120),
        deployment_path: text(120), configuration_digest: hash,
      }, ["error_code", "repository", "branch", "connector", "deployment_path", "configuration_digest"]),
    }, ["project_id", "scope"]), true),
];
