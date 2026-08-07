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
const coordinationIdempotencyKey = { type: "string", minLength: 8, maxLength: 160 };
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
  kind: { type: "string", enum: ["file", "component", "dependency"] },
  value: { type: "string", minLength: 1, maxLength: 500 },
}, ["kind", "value"]);

const TENANT_WORK_COORDINATION_ACTION_TYPES = Object.freeze({
  tenant_work_gallery_join: "work.participant.join",
  tenant_work_gallery_heartbeat: "work.participant.heartbeat",
  tenant_work_branch_open: "work.branch.open",
  tenant_work_lease_acquire: "work.lease.acquire",
  tenant_work_lease_renew: "work.lease.renew",
  tenant_work_lease_release: "work.lease.release",
  tenant_work_message_post: "work.message.post",
});

export function tenantWorkCoordinationActionType(toolName) {
  return TENANT_WORK_COORDINATION_ACTION_TYPES[String(toolName || "")] || null;
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
    "Create tenant-scoped Work Identity and the first architecture-map version with a hash-chained event ledger.",
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
    object({ work_id: uuid, session_id: identifier, current_state_hashes: stateHashes, idempotency_key: text(160) },
      ["work_id", "session_id", "current_state_hashes", "idempotency_key"]), false, {
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
    "Acquire a temporary lease over files, components or dependencies after transactional overlap detection.",
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
    "Create or resume a tenant-scoped Work Identity through a fresh, request-bound owner confirmation; the immutable Intent Anchor is never overwritten.",
    object({
      work_id: uuid, parent_work_id: uuid, project_id: identifier, session_id: identifier,
      initial_message: text(20_000), idea: text(8_000), objective: text(8_000),
      acceptance_criteria: { type: "array", maxItems: 100, items: text(1_000) },
      constraints: { type: "array", maxItems: 100, items: text(1_000) },
      architecture: { type: "object", additionalProperties: true }, next_action: text(4_000),
      host_type: nativeHost, resume_existing: { type: "boolean" },
      repository_hash: hash, policy_hash: hash, live_state_hash: hash,
    }, ["project_id", "session_id", "initial_message", "idea", "objective", "architecture", "next_action"]),
    false, {
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
      status: { type: "string", enum: ["active", "verified", "release_ready", "completed", "blocked", "failed"] },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      cursor: { type: "string", maxLength: 240 },
    }), true),
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
    }, ["work_id", "plan_id", "task_id", "native_agent_id", "host_type", "host_task_id"]),
    false, { ownerConfirmationRequired: false }),
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
        summary: text(8_000), verdict: { type: "string", enum: ["approved", "rejected"] },
        commit_sha: gitSha,
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
    }, ["work_id", "plan_id", "release", "idempotency_key"]),
    false, { ownerConfirmationRequired: false }),
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
