const PRESENCE = {
  agent_id: {
    type: "string",
    pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$",
  },
  client_type: {
    type: "string",
    enum: ["chatgpt", "codex", "api_agent", "other"],
  },
  session_id: {
    type: "string",
    pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$",
  },
};

const OWNER_CONFIRMATION = {
  owner_confirmed: {
    type: "boolean",
    description: "Set true only after the authenticated tenant owner confirms this exact bounded delegation action.",
  },
  confirmation_reference: {
    type: "string",
    minLength: 1,
    maxLength: 240,
  },
};

const identifier = {
  type: "string",
  pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,159}$",
};
const repository = {
  type: "string",
  pattern: "^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$",
};
const branch = {
  type: "string",
  minLength: 1,
  maxLength: 240,
  pattern: "^[a-zA-Z0-9][a-zA-Z0-9._/*-]*$",
};
const exactBranch = {
  type: "string",
  minLength: 1,
  maxLength: 200,
  pattern: "^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$",
};
const sha256 = {
  type: "string",
  pattern: "^[a-f0-9]{64}$",
};
const gitSha = {
  type: "string",
  pattern: "^[a-f0-9]{40}$",
};
const delegationId = {
  type: "string",
  pattern: "^hnd_[a-zA-Z0-9-]{8,160}$",
};
const actionTicketId = {
  type: "string",
  pattern: "^hnt_[a-zA-Z0-9-]{8,160}$",
};
const closureHandoffId = {
  type: "string",
  pattern: "^hnh_[a-zA-Z0-9._-]{8,160}$",
};
const object = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

function tool(name, title, description, inputSchema, {
  readOnly = false,
  ownerConfirmationRequired = false,
  destructive = false,
} = {}) {
  return {
    name,
    title,
    description,
    inputSchema: {
      ...inputSchema,
      properties: {
        ...inputSchema.properties,
        ...PRESENCE,
        ...(ownerConfirmationRequired ? OWNER_CONFIRMATION : {}),
      },
    },
    scopes: [readOnly ? "core:read" : "core:govern"],
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: destructive,
      openWorldHint: false,
      idempotentHint: true,
    },
    ...(!readOnly ? {
      _meta: {
        "skinharmony/ownerConfirmationRequired": ownerConfirmationRequired,
        "skinharmony/dedicatedCoreGate": true,
        "skinharmony/delegationAware": ownerConfirmationRequired === false,
      },
    } : {}),
  };
}

const budget = object({
  max_agents: { type: "integer", minimum: 1, maximum: 3 },
  max_parallel: { type: "integer", minimum: 1, maximum: 2 },
  max_commits: { type: "integer", minimum: 1, maximum: 100 },
  max_pushes: { type: "integer", minimum: 1, maximum: 50 },
  max_deploys: { type: "integer", minimum: 1, maximum: 20 },
  max_total_actions: { type: "integer", minimum: 1, maximum: 200 },
});

const releasePolicy = object({
  manifest_required_for_protected_push: { type: "boolean" },
  manifest_required_for_induced_deploy: { type: "boolean" },
  manifest_required_for_deploy: { type: "boolean" },
  independent_verifier_required: { type: "boolean" },
  rollback_required: { type: "boolean" },
  required_checks: {
    type: "array",
    minItems: 1,
    maxItems: 64,
    uniqueItems: true,
    items: identifier,
  },
});

const allowedAction = {
  type: "string",
  enum: [
    "native_agent.spawn",
    "git.commit",
    "git.push.branch",
    "git.push.protected",
    "github.draft_pr",
    "github.ready",
    "github.merge",
    "render.deploy",
    "render.observe",
    "render.rollback",
  ],
};

export const HOST_NATIVE_TOOLS = [
  tool(
    "host_native_status",
    "Read host-native governance status",
    "Read Universal Core readiness for persistent host-native delegations and one-shot action tickets. This path never checks or invokes an AI provider.",
    object(),
    { readOnly: true },
  ),
  tool(
    "host_native_work_plan_create",
    "Build a bounded host-native work plan",
    "Ask Universal Core to validate a plan of at most three ChatGPT/Codex native specialists and two parallel workers. The returned plan is not proof that a child was spawned.",
    object({
      work_id: identifier,
      intent_anchor_digest: sha256,
      repository,
      base_branch: exactBranch,
      objective: { type: "string", minLength: 1, maxLength: 4_000 },
      required_checks: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        uniqueItems: true,
        items: identifier,
      },
      agents: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: object({
          agent_id: {
            type: "string",
            pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,119}$",
          },
          role: identifier,
          task: { type: "string", minLength: 1, maxLength: 4_000 },
          depends_on: {
            type: "array",
            maxItems: 3,
            uniqueItems: true,
            items: identifier,
          },
          capabilities: {
            type: "array",
            maxItems: 32,
            uniqueItems: true,
            items: identifier,
          },
        }, ["agent_id", "role", "task"]),
      },
      max_parallel: { type: "integer", minimum: 1, maximum: 2 },
    }, [
      "work_id",
      "intent_anchor_digest",
      "repository",
      "base_branch",
      "objective",
      "required_checks",
      "agents",
    ]),
    { readOnly: true },
  ),
  tool(
    "host_native_delegation_issue",
    "Issue a bounded owner delegation",
    "After one fresh authenticated OAuth-owner confirmation, or from the exact configured Codex Good Mode profile, issue a revocable tenant/work/repository delegation with exact branches, paths, actions, budgets and expiry. It never overrides host policy.",
    object({
      work_id: identifier,
      intent_anchor_digest: sha256,
      repository,
      audience: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
        items: {
          type: "string",
          enum: ["chatgpt_native", "codex_native"],
        },
      },
      allowed_branches: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        uniqueItems: true,
        items: branch,
      },
      protected_branches: {
        type: "array",
        maxItems: 16,
        uniqueItems: true,
        items: branch,
      },
      allowed_path_prefixes: {
        type: "array",
        minItems: 1,
        maxItems: 128,
        uniqueItems: true,
        items: {
          type: "string",
          minLength: 1,
          maxLength: 500,
        },
      },
      allowed_actions: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        uniqueItems: true,
        items: allowedAction,
      },
      budget,
      release_policy: releasePolicy,
      ttl_seconds: {
        type: "integer",
        minimum: 60,
        maximum: 43_200,
      },
      idempotency_key: {
        type: "string",
        minLength: 1,
        maxLength: 160,
      },
    }, [
      "work_id",
      "intent_anchor_digest",
      "repository",
      "audience",
      "allowed_branches",
      "allowed_path_prefixes",
      "allowed_actions",
      "ttl_seconds",
      "idempotency_key",
    ]),
    { ownerConfirmationRequired: true },
  ),
  tool(
    "host_native_delegation_read",
    "Read one host-native delegation",
    "Read the tenant-scoped signed delegation, effective state, remaining budget and immutable policy digest.",
    object({ delegation_id: delegationId }, ["delegation_id"]),
    { readOnly: true },
  ),
  tool(
    "host_native_delegation_revoke",
    "Revoke one host-native delegation",
    "Revoke a delegation after a fresh confirmation by the same authenticated OAuth tenant owner, or from the exact configured Codex Good Mode profile. Revocation cannot be undone.",
    object({
      delegation_id: delegationId,
      idempotency_key: {
        type: "string",
        minLength: 1,
        maxLength: 160,
      },
    }, ["delegation_id", "idempotency_key"]),
    { ownerConfirmationRequired: true, destructive: true },
  ),
  tool(
    "host_native_action_authorize",
    "Authorize one exact host action",
    "Consume only bounded delegation budget and issue a signed, short-lived, one-use Core ticket for one exact native-agent, Git, GitHub or Render action. The server binds the authenticated host session.",
    object({
      delegation_id: delegationId,
      work_id: identifier,
      intent_anchor_digest: sha256,
      repository,
      action: {
        type: "object",
        minProperties: 1,
        maxProperties: 40,
        additionalProperties: true,
      },
      evidence_digest: sha256,
      release_manifest: {
        type: "object",
        maxProperties: 40,
        additionalProperties: true,
      },
      predecessor_ticket_id: actionTicketId,
      idempotency_key: {
        type: "string",
        minLength: 1,
        maxLength: 160,
      },
    }, [
      "delegation_id",
      "work_id",
      "intent_anchor_digest",
      "repository",
      "action",
      "evidence_digest",
      "idempotency_key",
    ]),
  ),
  tool(
    "host_native_action_read",
    "Read one Core action ticket",
    "Read the tenant-scoped signed ticket, action digest, one-shot state and reconciliation state without consuming it.",
    object({ ticket_id: actionTicketId }, ["ticket_id"]),
    { readOnly: true },
  ),
  tool(
    "host_native_action_reserve",
    "Reserve one Core action ticket",
    "Atomically reserve an issued action ticket for the authenticated host session before the connector side effect.",
    object({
      ticket_id: actionTicketId,
      idempotency_key: {
        type: "string",
        minLength: 1,
        maxLength: 160,
      },
    }, ["ticket_id", "idempotency_key"]),
  ),
  tool(
    "host_native_action_complete",
    "Complete one Core action ticket",
    "Complete the exact reservation with a connector-derived result digest and, for commit-producing actions, the connector-returned result commit.",
    object({
      ticket_id: actionTicketId,
      reservation_id: {
        type: "string",
        pattern: "^hnr_[a-zA-Z0-9-]{8,160}$",
      },
      outcome: {
        type: "string",
        enum: ["success", "failure", "unknown"],
      },
      result_digest: sha256,
      result_commit: gitSha,
      readback_digest: sha256,
      idempotency_key: {
        type: "string",
        minLength: 1,
        maxLength: 160,
      },
    }, ["ticket_id", "reservation_id", "outcome", "result_digest", "idempotency_key"]),
  ),
  tool(
    "host_native_action_reconcile",
    "Reconcile one Core action ticket",
    "Resolve an unknown or completed connector outcome with an independent readback digest and observed commit bound to the authenticated host session.",
    object({
      ticket_id: actionTicketId,
      reservation_id: {
        type: "string",
        pattern: "^hnr_[a-zA-Z0-9-]{8,160}$",
      },
      observed_outcome: {
        type: "string",
        enum: ["success", "failure"],
      },
      readback_digest: sha256,
      observed_commit: gitSha,
      idempotency_key: {
        type: "string",
        minLength: 1,
        maxLength: 160,
      },
    }, [
      "ticket_id",
      "reservation_id",
      "observed_outcome",
      "readback_digest",
      "idempotency_key",
    ]),
  ),
  tool(
    "host_native_action_closure_receipt",
    "Read trusted Core closure authorization",
    "Read a trusted closure receipt only after the one-shot action succeeded and its external effect was reconciled. It binds the actual observed commit, ticket, manifest and readback digests.",
    object({
      ticket_id: actionTicketId,
    }, ["ticket_id"]),
    { readOnly: true },
  ),
  tool(
    "host_native_action_closure_handoff_issue",
    "Issue a successor-session closure handoff",
    "After fresh owner confirmation, issue one Core-signed, short-lived and one-use handoff that lets the authenticated successor session finalize an already completed release ticket. It preserves the original execution-session binding and cannot replay an external action.",
    object({
      ticket_id: actionTicketId,
      superseding_action_ticket_id: actionTicketId,
      work_id: identifier,
      plan_id: identifier,
      result_commit: gitSha,
      idempotency_key: {
        type: "string",
        minLength: 1,
        maxLength: 160,
      },
    }, [
      "ticket_id",
      "work_id",
      "plan_id",
      "result_commit",
      "idempotency_key",
    ]),
    { ownerConfirmationRequired: true },
  ),
];
