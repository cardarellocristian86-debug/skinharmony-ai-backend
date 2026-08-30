import crypto from "node:crypto";
import { redactMemoryText } from "./cloud-memory-store.js";

const ACTION_OUTCOME_TOOLS = new Set([
  "host_native_action_complete",
  "host_native_action_reconcile",
  "host_native_action_quarantine_expired",
]);
const OPERATIONAL_FAILURE_TOOLS = new Set([
  "work_continuity_native_bind",
  "work_continuity_native_report",
  "work_continuity_closure_evaluate",
  "work_continuity_closure_finalize",
]);
const AUTOMATED_TOOLS = new Set([
  ...ACTION_OUTCOME_TOOLS,
  ...OPERATIONAL_FAILURE_TOOLS,
]);
const ATLAS_ACTIONS = new Set([
  "git.commit",
  "git.push.branch",
  "git.push.protected",
  "github.merge",
]);
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const AUTHORIZED_OPERATIONAL_ERRORS = new WeakSet();
const NON_INCIDENT_OPERATIONAL_ERRORS = new Set([
  "continuity_work_incident_blocker_unresolved",
  "continuity_work_blocked_revalidation_required",
]);

// Only server handlers can place an Error in this module-private WeakSet,
// after their exact Work/assignment/Core admission has succeeded. A caller,
// wrapper argument or serialized error cannot forge this proof.
export function authorizeWorkContinuityOperationalError(error) {
  if (error && (typeof error === "object" || typeof error === "function")) {
    AUTHORIZED_OPERATIONAL_ERRORS.add(error);
  }
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().flatMap((key) =>
      value[key] === undefined ? [] : [[key, stable(value[key])]]),
  );
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function safeText(value, maximum = 500) {
  return redactMemoryText(String(value || "").replaceAll("\u0000", "")).text.slice(0, maximum);
}

function safeIdentifier(value, fallback, maximum = 120) {
  const normalized = safeText(value, maximum)
    .trim()
    .replace(/[^a-zA-Z0-9._:/-]+/g, "_")
    .slice(0, maximum);
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(normalized) ? normalized : fallback;
}

function projectId(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:/-]+/g, "-")
    .slice(0, 64);
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,63}$/.test(normalized)
    ? normalized
    : "skinharmony-ai-backend";
}

function structuredPayload(result) {
  const structured = result?.structuredContent;
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return {};
  if (structured.result && typeof structured.result === "object" && !Array.isArray(structured.result)) {
    return structured.result;
  }
  return structured;
}

function trustedTicketRecord(record, tenantId) {
  const ticket = record?.ticket;
  const action = ticket?.action;
  if (
    record?.schema_version !== "host_native_action_ticket_record_v1" ||
    record.tenant_id !== tenantId ||
    ticket?.tenant_id !== tenantId ||
    !action ||
    typeof action !== "object" ||
    !String(action.kind || "") ||
    !UUID_PATTERN.test(String(ticket.work_id || "")) ||
    !/^hnt_[a-zA-Z0-9-]{8,160}$/.test(String(ticket.ticket_id || "")) ||
    !/^hnt_[a-f0-9]{64}$/.test(String(ticket.signature || "")) ||
    !SHA256_PATTERN.test(String(ticket.action_digest || "")) ||
    !String(ticket.repository || "") ||
    ticket.repository !== action?.repository ||
    ticket.host_policy_override !== false ||
    ticket.host_policy_must_allow !== true ||
    ticket.provider_execution !== false
  ) {
    return null;
  }
  return record;
}

function coreTicketRecord(event) {
  const payload = structuredPayload(event.result);
  const gate = event.result?.structuredContent?.dedicated_core_gate ||
    payload.dedicated_core_gate;
  const tenantId = String(event.identity?.tenantId || "");
  if (
    payload.ok !== true ||
    gate?.authorized !== true ||
    gate?.authority !== "universal_core" ||
    gate?.host_policy_override !== false ||
    payload.tenant_id !== tenantId
  ) {
    return null;
  }
  return trustedTicketRecord(payload.action_ticket, tenantId);
}

function errorTicketRecord(event) {
  if (event.error?.hostNativeTicketTrusted !== true) return null;
  return trustedTicketRecord(
    event.error.hostNativeTicketRecord,
    String(event.identity?.tenantId || ""),
  );
}

function unwrapDynamicEvent(event = {}) {
  if (AUTOMATED_TOOLS.has(event.toolName)) return event;
  if (event.toolName !== "core_capability_invoke") return event;
  const payload = structuredPayload(event.result);
  const capabilityId = payload.dynamic_capability?.capability_id ||
    event.result?.structuredContent?.dynamic_capability?.capability_id ||
    event.args?.capability_id;
  if (!AUTOMATED_TOOLS.has(capabilityId)) return event;
  return {
    ...event,
    toolName: capabilityId,
    args: event.args?.arguments && typeof event.args.arguments === "object"
      ? event.args.arguments
      : {},
    wrapperToolName: "core_capability_invoke",
  };
}

function operationalFailure(event) {
  if (!OPERATIONAL_FAILURE_TOOLS.has(event.toolName)) return null;
  const workId = String(event.args?.work_id || "");
  if (!UUID_PATTERN.test(workId)) return null;
  const payload = structuredPayload(event.result);
  let code = "";
  let missing = [];
  if (event.error) {
    const exactError = String(event.error.code || event.error.message || "");
    if (NON_INCIDENT_OPERATIONAL_ERRORS.has(exactError.toLowerCase())) return null;
    code = safeIdentifier(
      exactError,
      `${event.toolName}_failed`,
      120,
    ).toUpperCase();
  } else if (event.toolName === "work_continuity_native_report") {
    const status = String(payload.status || event.args?.status || "").toLowerCase();
    const report = event.args?.report && typeof event.args.report === "object"
      ? event.args.report
      : {};
    const testsFailed = Array.isArray(report.tests) &&
      report.tests.some((test) => test?.passed === false);
    if (status === "failed" || status === "blocked") {
      code = `NATIVE_AGENT_${status.toUpperCase()}`;
    } else if (report.verdict === "rejected") {
      code = "NATIVE_VERIFIER_REJECTED";
    } else if (report.correction_required === true) {
      code = "NATIVE_CORRECTION_REQUIRED";
    } else if (testsFailed) {
      code = "NATIVE_TEST_FAILED";
    }
  } else if (
    event.toolName === "work_continuity_closure_evaluate" &&
    payload.closed === false
  ) {
    code = "NATIVE_CLOSURE_GAPS";
    missing = Array.isArray(payload.missing)
      ? payload.missing.map((item) => safeIdentifier(item, "gap", 120)).sort().slice(0, 64)
      : [];
  } else if (
    event.toolName === "work_continuity_closure_finalize" &&
    payload.completed !== true
  ) {
    code = "NATIVE_FINALIZE_INCOMPLETE";
  }
  if (!code) return null;
  const operation = safeIdentifier(event.toolName, "work_continuity_operation", 120);
  const sourcePlanId = UUID_PATTERN.test(String(event.args?.plan_id || ""))
    ? String(event.args.plan_id)
    : null;
  const sourceAgentId = safeIdentifier(
    event.args?.native_agent_id || event.args?.agent_id,
    "unassigned",
    120,
  );
  const evidenceDigest = digest({
    schema_version: "work_continuity_operational_failure_v1",
    tenant_id: event.identity?.tenantId,
    work_id: workId,
    plan_id: sourcePlanId,
    native_agent_id: sourceAgentId,
    operation,
    error_code: code,
    missing,
  });
  return {
    work_id: workId,
    operation,
    error_code: code,
    evidence_digest: evidenceDigest,
    plan_id: sourcePlanId,
    native_agent_id: sourceAgentId,
    next_action: code === "NATIVE_CLOSURE_GAPS"
      ? `Resolve the indexed closure gaps (${missing.join(", ") || "unknown"}), rerun exact checks, then request a fresh independent Core join.`
      : "Inspect the indexed bounded failure, correct it, rerun exact checks, and obtain independent verification before resuming.",
    idempotency_key: `incident-operational-${evidenceDigest}`,
  };
}

function confirmedOutcome(event, record) {
  if (!record) return null;
  if (
    event.toolName === "host_native_action_complete" &&
    record.state === "completed" &&
    record.outcome === "success"
  ) return "success";
  if (
    event.toolName === "host_native_action_reconcile" &&
    record.state === "reconciled" &&
    record.observed_outcome === "success"
  ) return "success";
  if (
    record.state === "failed" ||
    record.outcome === "failure" ||
    record.observed_outcome === "failure"
  ) return "failure";
  return null;
}

function structuredFailure(event, record) {
  if (confirmedOutcome(event, record) === "failure") return true;
  if (record?.state === "quarantined") return true;
  const payload = structuredPayload(event.result);
  return event.result?.isError === true || payload.ok === false;
}

function continuityScope(event) {
  const candidates = [
    event.preflight?.work_preflight?.continuity,
    event.preflight?.continuity,
    event.hookContext?.preflight?.work_preflight?.continuity,
    event.hookContext?.preflight?.continuity,
  ];
  return candidates.find((item) => item && typeof item === "object") || {};
}

function errorCode(event, record) {
  const payload = structuredPayload(event.result);
  const candidate = event.error?.code || payload.error?.code ||
    (record?.state === "quarantined" ? "ACTION_RESERVATION_EXPIRED_QUARANTINED" : "") ||
    (record?.observed_outcome === "failure" ? "ACTION_RECONCILED_FAILURE" : "") ||
    (record?.outcome === "failure" ? "ACTION_COMPLETED_FAILURE" : "") ||
    "HOST_NATIVE_ACTION_FAILURE";
  return safeIdentifier(candidate, "HOST_NATIVE_ACTION_FAILURE", 120).toUpperCase();
}

function branchFor(action = {}) {
  return safeText(action.branch || action.base_branch || action.head_branch || "unknown", 240);
}

function incidentInput(event, record) {
  const ticket = record?.ticket;
  const action = ticket?.action || {};
  const continuity = continuityScope(event);
  const fallbackTicketId = /^hnt_[a-zA-Z0-9-]{8,160}$/.test(String(event.args?.ticket_id || ""))
    ? String(event.args.ticket_id)
    : "unreturned-ticket";
  const workId = ticket?.work_id || continuity.work_id;
  if (!UUID_PATTERN.test(String(workId || ""))) return null;
  const repository = ticket?.repository || `ticket:${fallbackTicketId}`;
  const project = ticket?.repository
    ? projectId(ticket.repository)
    : projectId(continuity.project_id);
  const code = errorCode(event, record);
  const connector = action.kind === "github.merge"
    ? "github"
    : action.kind?.startsWith("git.") ? "git" : "core-mcp";
  const deploymentPath = action.kind || event.toolName;
  const configurationDigest = digest({
    schema_version: "work_continuity_incident_automation_scope_v1",
    tenant_id: event.identity?.tenantId,
    work_id: workId,
    ticket_id: ticket?.ticket_id || fallbackTicketId,
    repository,
    branch: branchFor(action),
    connector,
    deployment_path: deploymentPath,
    error_code: code,
    action_digest: SHA256_PATTERN.test(String(ticket?.action_digest || ""))
      ? ticket.action_digest.toLowerCase()
      : null,
  });
  const idempotencyDigest = digest({
    work_id: workId,
    project_id: project,
    configuration_digest: configurationDigest,
  });
  return {
    work_id: workId,
    project_id: project,
    scope: {
      error_code: code,
      repository: safeText(repository, 240),
      branch: branchFor(action),
      connector,
      deployment_path: safeText(deploymentPath, 120),
      configuration_digest: configurationDigest,
    },
    runbook: {
      // The candidate is deliberately derived only from the stable exact
      // scope. Raw provider messages can vary across retries and would make
      // replay conflict with the already indexed runbook.
      title: safeText(`${event.toolName}: ${code}`, 500),
      preconditions: [
        "Use only the same tenant, work, action ticket and exact incident fingerprint.",
        "Treat this runbook as a candidate until a distinct verifier proves recovery.",
      ],
      steps: [
        `Read ${safeText(ticket?.ticket_id || fallbackTicketId, 160)} from Universal Core and inspect its terminal outcome.`,
        "Diagnose the bounded connector failure without bypassing host policy or changing action scope.",
        "Retry through a newly authorized one-shot action ticket and capture connector readback evidence.",
      ],
      verification: [
        "A distinct host-native verifier must reproduce the fix and attach passing evidence.",
        "Universal Core must confirm the replacement ticket outcome before closure.",
      ],
      rollback: [
        "Do not reuse or promote this candidate if exact-scope verification fails.",
      ],
    },
    next_action: "Inspect the indexed ticket failure, correct the bounded cause, then obtain independent verification.",
    idempotency_key: `incident-auto-${idempotencyDigest}`,
  };
}

function confirmedCommit(record) {
  const action = record.ticket.action;
  const candidate = record.observed_commit || record.result_commit ||
    (action.kind.startsWith("git.push.") ? action.source_commit : "");
  if (!GIT_SHA_PATTERN.test(String(candidate || ""))) return null;
  const commit = String(candidate).toLowerCase();
  if (action.kind.startsWith("git.push.") && commit !== String(action.source_commit).toLowerCase()) {
    return null;
  }
  return commit;
}

function nodeId(kind, value) {
  return `${kind}:${digest({ kind, value }).slice(0, 40)}`;
}

function atlasInput(record) {
  const ticket = record.ticket;
  const action = ticket.action;
  if (!ATLAS_ACTIONS.has(action.kind)) return null;
  const commit = confirmedCommit(record);
  if (!commit) return null;

  const repositoryNodeId = nodeId("repo", ticket.repository);
  const commitNodeId = `commit:${commit}`;
  const changedFiles = [...new Set([
    ...(Array.isArray(action.changed_files) ? action.changed_files : []),
    ...(Array.isArray(ticket.release_manifest_binding?.changed_files)
      ? ticket.release_manifest_binding.changed_files : []),
  ].filter((path) => typeof path === "string" && path.length > 0 && path.length <= 2_000))].sort();
  const inducedServices = [...(Array.isArray(action.induced_effects) ? action.induced_effects : [])]
    .filter((effect) => effect && typeof effect.service_id === "string")
    .sort((left, right) => left.service_id.localeCompare(right.service_id));
  const nodes = [
    {
      node_id: repositoryNodeId,
      node_kind: "repository",
      summary: `Repository ${safeText(ticket.repository, 240)}`,
      metadata: { repository: safeText(ticket.repository, 240) },
    },
    {
      node_id: commitNodeId,
      node_kind: "commit",
      summary: `Core-confirmed ${action.kind} commit ${commit}`,
      metadata: {
        commit_sha: commit,
        action_kind: action.kind,
        ticket_id: ticket.ticket_id,
      },
    },
  ];
  const edges = [{
    from_node_id: repositoryNodeId,
    to_node_id: commitNodeId,
    edge_type: "contains_commit",
  }];

  for (const path of changedFiles) {
    const fileNodeId = nodeId("file", `${ticket.repository}\u0000${path}`);
    nodes.push({
      node_id: fileNodeId,
      node_kind: "file",
      path: safeText(path, 2_000),
      summary: `Changed by ${commit}`,
      metadata: { repository: safeText(ticket.repository, 240), commit_sha: commit },
    });
    edges.push({
      from_node_id: commitNodeId,
      to_node_id: fileNodeId,
      edge_type: "changes_file",
    });
  }
  for (const effect of inducedServices) {
    const environment = safeIdentifier(effect.environment, "unknown", 32);
    const serviceId = safeIdentifier(effect.service_id, "unknown-service", 160);
    const serviceNodeId = nodeId("service", `${serviceId}\u0000${environment}`);
    nodes.push({
      node_id: serviceNodeId,
      node_kind: "service",
      summary: `Induced ${environment} service ${safeText(serviceId, 160)}`,
      metadata: {
        service_id: serviceId,
        environment,
        trigger: safeIdentifier(effect.trigger, "unknown", 80),
        target_commit: GIT_SHA_PATTERN.test(String(effect.target_commit || ""))
          ? String(effect.target_commit).toLowerCase()
          : commit,
      },
    });
    edges.push({
      from_node_id: commitNodeId,
      to_node_id: serviceNodeId,
      edge_type: "induces_service",
    });
  }

  const source = {
    schema_version: "work_continuity_atlas_automation_delta_v1",
    tenant_id: record.tenant_id,
    work_id: ticket.work_id,
    ticket_id: ticket.ticket_id,
    action_digest: ticket.action_digest,
    state: record.state,
    outcome: record.observed_outcome || record.outcome,
    commit,
    nodes,
    edges,
  };
  const sourceHash = digest(source);
  return {
    work_id: ticket.work_id,
    nodes,
    edges,
    allow_existing_edge_nodes: true,
    replace: false,
    source_hash: sourceHash,
    idempotency_key: `atlas-auto-${sourceHash}`,
  };
}

/**
 * Build a fail-safe MCP afterToolCall hook. Runtime projection failures are
 * reported in the return value and never replace the host action result/error.
 */
export function createWorkContinuityAutomation({ runtime } = {}) {
  if (
    !runtime ||
    typeof runtime.recordIncident !== "function" ||
    typeof runtime.recordOperationalIncident !== "function" ||
    typeof runtime.upsertAtlas !== "function"
  ) {
    throw new Error("work_continuity_automation_runtime_invalid");
  }

  return async function afterToolCall(event = {}) {
    event = unwrapDynamicEvent(event);
    if (!AUTOMATED_TOOLS.has(event.toolName)) {
      return { handled: false, projections: [] };
    }
    // This marker is created only by the MCP dispatcher after host-app
    // capability checks, exact Work ACL and server preflight have succeeded,
    // immediately before the selected handler is entered. Raw caller args and
    // rejected preflight/auth paths can never trigger a Work mutation here.
    if (event.serverAuthorizationPassed !== true || event.handlerEntered !== true) {
      return { handled: true, projections: [], skipped: "server_authorization_not_completed" };
    }
    const projections = [];
    if (OPERATIONAL_FAILURE_TOOLS.has(event.toolName)) {
      if (event.error && !AUTHORIZED_OPERATIONAL_ERRORS.has(event.error)) {
        return {
          handled: true,
          projections,
          skipped: "operational_failure_authorization_not_proven",
        };
      }
      const input = operationalFailure(event);
      if (!input) return { handled: true, projections };
      try {
        const result = await runtime.recordOperationalIncident(event.identity, input);
        projections.push({ kind: "incident", ok: true, result });
      } catch (error) {
        projections.push({
          kind: "incident",
          ok: false,
          error_code: safeIdentifier(
            error?.code || error?.message,
            "operational_incident_projection_failed",
            120,
          ),
        });
      }
      return { handled: true, projections };
    }
    const record = coreTicketRecord(event) || errorTicketRecord(event);
    const failure = Boolean(event.error) || structuredFailure(event, record);

    if (failure) {
      // A failed action may be projected only when Universal Core already
      // returned (or attached to the thrown Error) the exact trusted ticket.
      // Generic Work preflight proves visibility, not action authority.
      if (!record) {
        return {
          handled: true,
          projections,
          skipped: "trusted_action_ticket_required",
        };
      }
      const input = incidentInput(event, record);
      if (!input) return { handled: true, projections, skipped: "incident_scope_unavailable" };
      try {
        const result = await runtime.recordIncident(event.identity, input);
        projections.push({ kind: "incident", ok: true, result });
      } catch (error) {
        projections.push({
          kind: "incident",
          ok: false,
          error_code: safeIdentifier(error?.code || error?.message, "incident_projection_failed", 120),
        });
      }
      return { handled: true, projections };
    }

    if (confirmedOutcome(event, record) === "success") {
      const input = atlasInput(record);
      if (!input) return { handled: true, projections, skipped: "atlas_delta_unavailable" };
      try {
        const result = await runtime.upsertAtlas(event.identity, input);
        projections.push({ kind: "atlas", ok: true, result });
      } catch (error) {
        projections.push({
          kind: "atlas",
          ok: false,
          error_code: safeIdentifier(error?.code || error?.message, "atlas_projection_failed", 120),
        });
      }
    }
    return { handled: true, projections };
  };
}
