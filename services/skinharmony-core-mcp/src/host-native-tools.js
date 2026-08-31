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
const workUuid = {
  type: "string",
  format: "uuid",
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
const coreJoinVerdictId = {
  type: "string",
  pattern: "^hnj_[a-f0-9]{40}$",
};
const standingReleaseMandateId = {
  type: "string",
  pattern: "^srm_[a-f0-9]{40}$",
};
const standingReleaseRunId = {
  type: "string",
  pattern: "^srr_[a-f0-9]{40}$",
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

const standingReleaseService = object({
  service_id: identifier,
  environment: identifier,
  health_contract_digest: sha256,
}, ["service_id", "environment", "health_contract_digest"]);

const standingReleaseLimits = object({
  max_pull_requests: { type: "integer", const: 1 },
  max_merges: { type: "integer", const: 1 },
  max_commits: { type: "integer", minimum: 1, maximum: 3 },
  max_pushes: { type: "integer", minimum: 1, maximum: 3 },
  max_repair_attempts: { type: "integer", minimum: 1, maximum: 2 },
  max_deploys_per_service: { type: "integer", const: 1 },
  max_rollbacks: { type: "integer", const: 1 },
}, [
  "max_pull_requests", "max_merges", "max_commits", "max_pushes",
  "max_repair_attempts", "max_deploys_per_service", "max_rollbacks",
]);

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
    "host_native_standing_release_mandate_install",
    "Install a revocable standing release mandate",
    "After one fresh authenticated owner confirmation, install a tenant/repository/base-bound mandate for repeated safe releases. It remains fail-closed unless Core runtime, branch protection, exact checks, service coverage and host policy are all ready.",
    object({
      authorization_work_id: workUuid,
      authorization_intent_anchor_digest: sha256,
      repository,
      base_branch: exactBranch,
      delivery_branch_prefix: {
        type: "string",
        minLength: 2,
        maxLength: 180,
        pattern: "^[a-zA-Z0-9][a-zA-Z0-9._/-]*/$",
      },
      allowed_path_prefixes: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 500 },
      },
      denied_path_prefixes: {
        type: "array",
        maxItems: 100,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 500 },
      },
      required_checks: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        uniqueItems: true,
        items: identifier,
      },
      required_checks_policy_digest: sha256,
      services: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: standingReleaseService,
      },
      repair_classes: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        uniqueItems: true,
        items: {
          type: "string",
          enum: [
            "deterministic_build", "deterministic_lint", "deterministic_test",
            "deterministic_typecheck", "transient_network", "transient_runner",
          ],
        },
      },
      limits: standingReleaseLimits,
      base_protection_required: { type: "boolean", const: true },
      ttl_seconds: { type: "integer", minimum: 60, maximum: 2_592_000 },
      idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
    }, [
      "authorization_work_id", "authorization_intent_anchor_digest", "repository",
      "base_branch", "delivery_branch_prefix", "allowed_path_prefixes",
      "required_checks", "required_checks_policy_digest", "services", "repair_classes",
      "limits", "base_protection_required", "ttl_seconds", "idempotency_key",
    ]),
    { ownerConfirmationRequired: true },
  ),
  tool(
    "host_native_standing_release_mandate_read",
    "Read a standing release mandate",
    "Read the signed tenant-and-Work-scoped mandate, revocation epoch and effective Core runtime state without granting or consuming authority.",
    object({
      mandate_id: standingReleaseMandateId,
      work_id: workUuid,
    }, ["mandate_id", "work_id"]),
    { readOnly: true },
  ),
  tool(
    "host_native_standing_release_mandate_revoke",
    "Revoke a standing release mandate",
    "Immediately revoke one mandate and invalidate its open derived authority after a fresh authenticated owner confirmation.",
    object({
      mandate_id: standingReleaseMandateId,
      reason_digest: sha256,
      idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
    }, ["mandate_id", "reason_digest", "idempotency_key"]),
    { ownerConfirmationRequired: true, destructive: true },
  ),
  tool(
    "host_native_standing_release_delegation_derive",
    "Derive one release delegation from a standing mandate",
    "Derive a short-lived exact Work/Intent/branch/change-cone delegation only after server-read GitHub branch protection and exact induced-service coverage are supplied. No owner prompt is repeated and no external action is executed.",
    object({
      mandate_id: standingReleaseMandateId,
      work_id: workUuid,
      intent_anchor_digest: sha256,
      delivery_branch: exactBranch,
      changed_files: {
        type: "array",
        minItems: 1,
        maxItems: 5_000,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 500 },
      },
      builder_agent_id: identifier,
      verifier_agent_ids: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
        items: identifier,
      },
      required_checks_policy_digest: sha256,
      induced_services: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: standingReleaseService,
      },
      ttl_seconds: { type: "integer", minimum: 60, maximum: 43_200 },
      idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
    }, [
      "mandate_id", "work_id", "intent_anchor_digest", "delivery_branch",
      "changed_files", "builder_agent_id", "verifier_agent_ids",
      "required_checks_policy_digest", "induced_services",
      "ttl_seconds", "idempotency_key",
    ]),
  ),
  tool(
    "host_native_standing_release_run_start",
    "Start a horizontal standing release run",
    "Create a durable Core-coordinated run from one exact standing delegation. GitHub and Render remain peer adapter lanes; external mutations still require the connected host and no provider action is executed by Core.",
    object({
      delegation_id: delegationId,
      work_id: workUuid,
      intent_anchor_digest: sha256,
      idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
    }, ["delegation_id", "work_id", "intent_anchor_digest", "idempotency_key"]),
  ),
  tool(
    "host_native_standing_release_run_read",
    "Read a horizontal standing release run",
    "Read the durable tenant-scoped coordinator state, peer adapter lanes, current action and next fail-closed transition without consuming authority.",
    object({
      run_id: standingReleaseRunId,
      work_id: workUuid,
    }, ["run_id", "work_id"]),
    { readOnly: true },
  ),
  tool(
    "host_native_standing_release_run_bind_ticket",
    "Bind one Core ticket to a standing release run",
    "Bind the exact issued Core action ticket for the run's current state. The ticket remains one-use and the connected host is still required for any GitHub or Render side effect.",
    object({
      run_id: standingReleaseRunId,
      work_id: workUuid,
      intent_anchor_digest: sha256,
      ticket_id: actionTicketId,
      expected_version: { type: "integer", minimum: 1 },
      idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
    }, ["run_id", "work_id", "intent_anchor_digest", "ticket_id", "expected_version", "idempotency_key"]),
  ),
  tool(
    "host_native_standing_release_run_advance",
    "Advance a standing release run from a Core ticket",
    "Advance only from the authoritative completed or reconciled Core ticket already bound to the run. Caller-supplied outcomes cannot move the state machine.",
    object({
      run_id: standingReleaseRunId,
      work_id: workUuid,
      intent_anchor_digest: sha256,
      ticket_id: actionTicketId,
      expected_version: { type: "integer", minimum: 1 },
      idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
    }, ["run_id", "work_id", "intent_anchor_digest", "ticket_id", "expected_version", "idempotency_key"]),
  ),
  tool(
    "host_native_standing_release_run_reserve",
    "Reserve and coordinate the active horizontal-run ticket",
    "Atomically reserve the exact ticket already bound to the run after a fresh Work/Intent DTT check. When the server returns a signed GitHub execution claim and automatic coordination is enabled, the MCP durably marks the attempt uncertain before forwarding it once to the fixed worker, then reconciles only a bound successful result; uncertain outcomes stop without retry.",
    object({
      run_id: standingReleaseRunId,
      work_id: workUuid,
      intent_anchor_digest: sha256,
      ticket_id: actionTicketId,
      expected_version: { type: "integer", minimum: 1 },
      idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
      materialization: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 256 },
          body: { type: "string", maxLength: 20000 },
        },
      },
    }, ["run_id", "work_id", "intent_anchor_digest", "ticket_id", "expected_version", "idempotency_key"]),
  ),
  tool(
    "host_native_standing_release_run_complete",
    "Complete the active horizontal-run ticket",
    "Record the connected-host result for the exact reserved run ticket after a fresh persisted Intent and DTT session check. Core and the provider lanes remain peers; Core performs no provider action.",
    object({
      run_id: standingReleaseRunId,
      work_id: workUuid,
      intent_anchor_digest: sha256,
      ticket_id: actionTicketId,
      expected_version: { type: "integer", minimum: 1 },
      reservation_id: {
        type: "string",
        pattern: "^hnr_[a-zA-Z0-9-]{8,160}$",
      },
      outcome: { type: "string", enum: ["success", "failure", "unknown"] },
      result_digest: sha256,
      result_commit: gitSha,
      result_pull_request: { type: "integer", minimum: 1 },
      readback_digest: sha256,
      idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
    }, [
      "run_id", "work_id", "intent_anchor_digest", "ticket_id", "expected_version",
      "reservation_id", "outcome", "result_digest", "idempotency_key",
    ]),
  ),
  tool(
    "host_native_standing_release_run_reconcile",
    "Reconcile the active horizontal-run ticket",
    "Reconcile an unknown exact run-ticket outcome through the run-bound route after fresh persisted Intent and DTT checks. This records evidence only and does not retry a provider mutation.",
    object({
      run_id: standingReleaseRunId,
      work_id: workUuid,
      intent_anchor_digest: sha256,
      ticket_id: actionTicketId,
      expected_version: { type: "integer", minimum: 1 },
      reservation_id: {
        type: "string",
        pattern: "^hnr_[a-zA-Z0-9-]{8,160}$",
      },
      observed_outcome: { type: "string", enum: ["success", "failure"] },
      observed_commit: gitSha,
      observed_pull_request: { type: "integer", minimum: 1 },
      readback_digest: sha256,
      idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
    }, [
      "run_id", "work_id", "intent_anchor_digest", "ticket_id", "expected_version",
      "reservation_id", "observed_outcome", "readback_digest", "idempotency_key",
    ]),
  ),
  tool(
    "host_native_standing_release_run_quarantine_expired",
    "Quarantine an expired horizontal-run reservation",
    "Terminate an in-flight run after its exact reservation lease expired with an unknown effect. Core records a signed quarantine and never retries, refunds, or infers a provider outcome.",
    object({
      run_id: standingReleaseRunId,
      work_id: workUuid,
      intent_anchor_digest: sha256,
      ticket_id: actionTicketId,
      reservation_id: {
        type: "string",
        pattern: "^hnr_[a-zA-Z0-9._-]{8,200}$",
      },
      expected_version: { type: "integer", minimum: 1 },
      idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
    }, [
      "run_id", "work_id", "intent_anchor_digest", "ticket_id", "reservation_id",
      "expected_version", "idempotency_key",
    ]),
  ),
  tool(
    "host_native_standing_release_run_cancel",
    "Cancel a standing release run",
    "Stop a run fail-closed without executing an external action. A run with an in-flight action must first reconcile that exact ticket.",
    object({
      run_id: standingReleaseRunId,
      work_id: workUuid,
      intent_anchor_digest: sha256,
      reason_digest: sha256,
      expected_version: { type: "integer", minimum: 1 },
      idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
    }, ["run_id", "work_id", "intent_anchor_digest", "reason_digest", "expected_version", "idempotency_key"]),
  ),
  tool(
    "host_native_standing_release_github_execute",
    "Execute one Core-reserved GitHub peer action",
    "Forward one short-lived Core-signed execution claim to the dedicated GitHub App worker after a fresh Work/Intent check. The caller cannot provide a provider URL, token, installation id or credential.",
    object({
      work_id: workUuid,
      intent_anchor_digest: sha256,
      claim: { type: "object" },
      materialization: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 256 },
          body: { type: "string", maxLength: 20000 },
        },
      },
    }, ["work_id", "intent_anchor_digest", "claim"]),
  ),
  tool(
    "host_native_standing_release_github_reconcile",
    "Reconcile one uncertain GitHub peer action",
    "Ask the dedicated worker to read GitHub and prove whether the exact signed action occurred. It never retries the provider mutation.",
    object({
      work_id: workUuid,
      intent_anchor_digest: sha256,
      claim: { type: "object" },
    }, ["work_id", "intent_anchor_digest", "claim"]),
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
    "host_native_owner_manual_merge_readback",
    "Record trusted owner manual-merge evidence",
    "After an owner performed an already Core-joined GitHub merge manually, ask Universal Core to resolve the PR, checks and protected-branch head from GitHub and persist evidence only. This never issues a retrospective action ticket or authorizes another host action.",
    object({
      work_id: workUuid,
      intent_anchor_digest: sha256,
      repository,
      core_join_verdict_id: coreJoinVerdictId,
      pull_request: { type: "integer", minimum: 1 },
      idempotency_key: {
        type: "string",
        minLength: 1,
        maxLength: 160,
      },
    }, [
      "work_id",
      "intent_anchor_digest",
      "repository",
      "core_join_verdict_id",
      "pull_request",
      "idempotency_key",
    ]),
    { ownerConfirmationRequired: true },
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
      manual_merge_readback_id: {
        type: "string",
        pattern: "^hnmmr_[a-f0-9]{40}$",
      },
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
      result_pull_request: { type: "integer", minimum: 1 },
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
      observed_pull_request: { type: "integer", minimum: 1 },
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
    "host_native_action_quarantine_expired",
    "Quarantine an expired Core action reservation",
    "Close only the exact expired reservation with host-derived readback. Core records an unknown effect, never retries, refunds budget, or authorizes finalization.",
    object({
      ticket_id: actionTicketId,
      reservation_id: {
        type: "string",
        pattern: "^hnr_[a-zA-Z0-9-]{8,160}$",
      },
      readback_digest: sha256,
      idempotency_key: {
        type: "string",
        minLength: 1,
        maxLength: 160,
      },
    }, ["ticket_id", "reservation_id", "readback_digest", "idempotency_key"]),
  ),
  tool(
    "host_native_action_observe_unreserved",
    "Record observed unreserved host effect",
    "Record, without creating a reservation, a verified host effect that occurred after ticket issuance but before reservation. Core defaults to BLOCKED and only an explicit exception verdict can authorize continuation.",
    object({
      ticket_id: actionTicketId,
      observed_outcome: { type: "string", enum: ["success"] },
      observed_commit: gitSha,
      readback_digest: sha256,
      verifier_evidence_digest: sha256,
      deviation_reason: { type: "string", minLength: 1, maxLength: 500 },
      idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
    }, ["ticket_id", "observed_outcome", "observed_commit", "readback_digest", "verifier_evidence_digest", "deviation_reason", "idempotency_key"]),
  ),
  tool(
    "host_native_owner_manual_merge_finalize_gallery",
    "Finalize owner manual-merge Gallery closure",
    "After Core has verified the one-shot render observation, require fresh authenticated-owner confirmation, persist the server-signed manual-merge release evidence, and run the normal Work Gallery closure path. The caller supplies only the action-ticket selector.",
    object({
      ticket_id: actionTicketId,
    }, ["ticket_id"]),
    { ownerConfirmationRequired: true },
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
];

export const HOST_NATIVE_NYRA_WORK_AUTOMATION = Object.freeze({
  schema_version: "nyra_work_automation_v3",
  maximum_advisory_capabilities: 6,
  maximum_parallel_builders: 1,
  verifier_assignment: "system_owned",
  unknown_outcome_policy: "authoritative_reconciliation_required",
  provider_execution: false,
});
