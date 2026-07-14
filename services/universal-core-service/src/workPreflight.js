import crypto from "node:crypto";

const PREFLIGHT_VERSION = "skinharmony_work_preflight_v1";

const READ_ONLY_OPERATIONS = new Set([
  "workspace_list",
  "workspace_read_document",
  "task_list",
  "agent_list",
  "message_inbox",
  "search",
  "fetch",
  "memory_context",
  "memory_search",
  "core_health",
  "nyra_runtime_context",
  "nyra_branch_catalog",
]);

const ROLE_CATALOG = Object.freeze([
  {
    id: "request_owner",
    system: "human",
    responsibility: "Definisce obiettivo e vincoli e conferma le azioni esterne o ad alto impatto.",
  },
  {
    id: "nyra_request_interpreter",
    system: "nyra",
    responsibility: "Normalizza la richiesta, propone rami e sotto-rami e rende leggibile il percorso.",
  },
  {
    id: "core_route_authority",
    system: "universal_core",
    responsibility: "Apre i rami autorizzati, riconcilia i risultati e produce il verdict vincolante.",
  },
  {
    id: "connected_ai_worker",
    system: "connected_ai",
    responsibility: "Esegue soltanto i compiti nel perimetro approvato usando lo strumento preferito.",
  },
  {
    id: "evidence_verifier",
    system: "nyra_core",
    responsibility: "Verifica criteri di accettazione, regressioni, tenant isolation ed evidenze.",
  },
  {
    id: "learning_steward",
    system: "nyra_core_memory",
    responsibility: "Propone lezioni da outcome e feedback e le consolida solo dopo verifica.",
  },
]);

function cleanText(value, max = 2_000) {
  return String(value || "")
    .slice(0, max)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED_SECRET]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .trim();
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 50).map((item) => cleanText(item, 80).toLowerCase()).filter(Boolean))];
}

function hasCapability(capabilities, terms) {
  return capabilities.some((capability) => terms.some((term) => capability.includes(term)));
}

function toolRoute(text, capabilities = [], toolName = "") {
  const value = `${text} ${toolName}`.toLowerCase();
  const connectedFirst = {
    strategy: "connected_capability_first_least_privilege",
    discovery_required_before_fallback: true,
    universal_rules: [
      "Scoprire e usare prima app, connettori e tool gia collegati e autorizzati.",
      "Non scegliere una CLI o un browser autenticato se il connettore equivalente e disponibile.",
      "Usare il fallback solo dopo indisponibilita verificata del percorso preferito.",
      "Non mostrare, copiare o registrare segreti nel routing o nell'audit.",
    ],
  };

  if (/(github|pull request|\bpr\b|repository|repo\b|commit|merge|branch)/.test(value)) {
    const available = hasCapability(capabilities, ["github", "pull_request", "repository"]);
    return {
      ...connectedFirst,
      capability: "github_repository",
      preferred_route: {
        id: "github_connected_app",
        status: available ? "available" : "discover_before_use",
        reason: "Preserva autenticazione, contesto repository e audit del connettore collegato.",
      },
      prohibited_when_preferred_available: ["github_cli", "manual_browser_authentication"],
      fallback: {
        id: "github_cli",
        allowed_only_if: ["github_connected_app_unavailable", "cli_installed", "cli_already_authenticated"],
      },
      release_policy: {
        draft_pr_allowed_after_core_scope_check: true,
        merge_requires_core_verdict: "ALLOW",
        merge_requires_owner_confirmation: true,
        deploy_requires_core_verdict: "ALLOW",
        deploy_requires_owner_confirmation: true,
      },
    };
  }

  if (/(calendar|calendario|agenda|evento|riunione|meeting)/.test(value)) {
    return {
      ...connectedFirst,
      capability: "calendar",
      preferred_route: { id: "google_calendar_connected_app", status: hasCapability(capabilities, ["calendar"]) ? "available" : "discover_before_use" },
      prohibited_when_preferred_available: ["manual_calendar_mutation"],
      fallback: { id: "manual_calendar_workflow", allowed_only_if: ["connected_calendar_unavailable", "owner_authorized"] },
    };
  }

  if (/(gmail|email|posta|mailbox|inbox)/.test(value)) {
    return {
      ...connectedFirst,
      capability: "email",
      preferred_route: { id: "gmail_connected_app", status: hasCapability(capabilities, ["gmail", "email"]) ? "available" : "discover_before_use" },
      prohibited_when_preferred_available: ["manual_mailbox_authentication"],
      fallback: { id: "configured_mail_adapter", allowed_only_if: ["gmail_connected_app_unavailable", "tenant_authorized"] },
    };
  }

  if (/(render|deploy|runtime|server|hosting)/.test(value)) {
    return {
      ...connectedFirst,
      capability: "runtime_deployment",
      preferred_route: { id: "connected_runtime_workspace", status: hasCapability(capabilities, ["render", "hosting", "runtime"]) ? "available" : "discover_before_use" },
      prohibited_when_preferred_available: ["untracked_manual_deploy"],
      fallback: { id: "repository_release_workflow", allowed_only_if: ["runtime_connector_unavailable", "rollback_ready"] },
      release_policy: {
        deploy_requires_core_verdict: "ALLOW",
        deploy_requires_owner_confirmation: true,
        rollback_plan_required: true,
      },
    };
  }

  if (/(library|cartella condivisa|file condivis|documento|workspace)/.test(value)) {
    return {
      ...connectedFirst,
      capability: "shared_workspace",
      preferred_route: { id: "tenant_shared_workspace", status: hasCapability(capabilities, ["library", "workspace", "document"]) ? "available" : "discover_before_use" },
      prohibited_when_preferred_available: ["unscoped_local_copy"],
      fallback: { id: "tenant_scoped_repository_artifact", allowed_only_if: ["shared_workspace_unavailable", "artifact_belongs_to_repository"] },
    };
  }

  return {
    ...connectedFirst,
    capability: "task_specific",
    preferred_route: { id: "best_connected_capability", status: "discover_before_use" },
    prohibited_when_preferred_available: ["equivalent_unconnected_tool"],
    fallback: { id: "least_privilege_available_tool", allowed_only_if: ["preferred_capability_unavailable", "scope_verified"] },
  };
}

function buildTaskGraph({ memoryContext, toolRouting, ownerConfirmationRequired, executionAllowedByPreflight }) {
  const memoryReady = Boolean(memoryContext);
  return {
    schema_version: "nyra_core_task_graph_v1",
    execution_model: "horizontal_bounded_parallel_with_core_join",
    maximum_parallel_lanes: 6,
    nodes: [
      {
        id: "recall_tenant_memory",
        role: "learning_steward",
        branch: "learning_memory",
        dependencies: [],
        status: memoryReady ? "complete" : "required",
        acceptance: "Checkpoint, decisioni, handoff e lezioni rilevanti sono letti nel tenant corretto.",
      },
      {
        id: "interpret_request",
        role: "nyra_request_interpreter",
        branch: "work_intake",
        dependencies: ["recall_tenant_memory"],
        status: memoryReady ? "ready" : "blocked_by_memory_recall",
        acceptance: "Obiettivo, deliverable, vincoli, assunzioni e dati mancanti sono espliciti.",
      },
      {
        id: "research_and_plan",
        role: "connected_ai_worker",
        branches: ["research_evidence", "planning_prioritization"],
        dependencies: ["interpret_request"],
        parallel_lane: 1,
        status: "pending_core_route",
        acceptance: "Piano, dipendenze, fonti, strumenti e criteri di successo sono verificabili.",
      },
      {
        id: "risk_and_tool_route",
        role: "core_route_authority",
        branches: ["risk_governance", "parallel_coordination"],
        dependencies: ["interpret_request"],
        parallel_lane: 2,
        status: executionAllowedByPreflight ? "complete_read_only_route" : "pending_core_verdict",
        acceptance: `Il percorso ${toolRouting.preferred_route.id} e gli eventuali fallback rispettano scope e policy.`,
      },
      {
        id: "execute_approved_scope",
        role: "connected_ai_worker",
        branch: "execution_planning",
        dependencies: ["research_and_plan", "risk_and_tool_route"],
        status: executionAllowedByPreflight
          ? "ready_read_only"
          : ownerConfirmationRequired
            ? "blocked_by_core_and_owner"
            : "blocked_by_core_verdict",
        acceptance: "Esecuzione limitata al runbook approvato, con audit e rollback proporzionati al rischio.",
      },
      {
        id: "verify_outcome",
        role: "evidence_verifier",
        branch: "quality_verification",
        dependencies: ["execute_approved_scope"],
        status: "pending_execution_evidence",
        acceptance: "Happy path, casi negativi, regressioni, isolamento tenant e risultato sono provati.",
      },
      {
        id: "learn_from_verified_outcome",
        role: "learning_steward",
        branch: "adaptive_learning",
        dependencies: ["verify_outcome"],
        status: "pending_verified_outcome",
        acceptance: "La lezione ha provenienza, outcome, confidenza e verifica prima del consolidamento.",
      },
    ],
    join_authority: "universal_core",
  };
}

export function buildWorkPreflight({
  tenantId,
  requestText,
  targetSystem = "universal_core",
  operationType = "advisory_work",
  toolName = "",
  availableCapabilities = [],
  memoryContext = null,
  branchContext,
  nyraNetwork,
  domainPack,
  ownerConfirmed = false,
} = {}) {
  const normalizedRequest = cleanText(requestText, 20_000);
  if (!normalizedRequest) throw new Error("work_preflight_request_required");
  const capabilities = normalizeCapabilities(availableCapabilities);
  const routing = toolRoute(normalizedRequest, capabilities, toolName);
  const highImpact = /(publish|pubblica|merge|deploy|rilasc|release|send|invia|delete|cancell|payment|pagament|write|scriv|update|modific)/i.test(`${normalizedRequest} ${operationType}`);
  const ownerConfirmationRequired = highImpact || Boolean(routing.release_policy);
  const memoryReady = Boolean(memoryContext);
  const operationKey = cleanText(toolName || operationType, 100).toLowerCase();
  const readOnlyOperation = READ_ONLY_OPERATIONS.has(operationKey);
  const executionAllowedByPreflight = memoryReady && readOnlyOperation;

  return {
    schema_version: PREFLIGHT_VERSION,
    preflight_id: `preflight_${crypto.randomUUID()}`,
    mandatory: true,
    tenant_id: String(tenantId || ""),
    domain_pack: domainPack,
    state: memoryReady
      ? executionAllowedByPreflight
        ? "ready_read_only"
        : ownerConfirmationRequired && ownerConfirmed
          ? "routed_owner_confirmed_waiting_for_core_verdict"
          : "routed_waiting_for_core_verdict"
      : "memory_recall_required",
    request: {
      summary: cleanText(normalizedRequest, 500),
      target_system: cleanText(targetSystem, 100) || "universal_core",
      operation_type: cleanText(operationType, 100) || "advisory_work",
      source_tool: cleanText(toolName, 100) || null,
    },
    mandatory_sequence: [
      "recall_tenant_memory",
      "nyra_interpret_request",
      "core_open_and_join_branches",
      "prepare_runbook_and_evidence",
      "obtain_core_verdict",
      "obtain_owner_confirmation_when_required",
      "execute_approved_scope_only",
      "verify_outcome",
      "consolidate_verified_learning",
    ],
    memory_first: {
      required: true,
      tenant_isolated: true,
      status: memoryReady ? "recalled" : "required_from_tenant_memory_provider",
      revision: memoryContext?.revision || 0,
      checkpoint_loaded: Boolean(memoryContext?.latest_checkpoint),
      relevant_memory_count: memoryContext?.relevant_memories?.length || 0,
      pending_handoff_count: memoryContext?.pending_handoffs?.length || 0,
      raw_prompts_stored_automatically: false,
      secrets_storable: false,
    },
    roles: ROLE_CATALOG.map((role) => ({ ...role })),
    nyra_route: nyraNetwork,
    core_route: {
      selected_branches: branchContext?.selected_branches || [],
      denied_branches: branchContext?.denied_branches || [],
      selected_groups: branchContext?.selected_groups || [],
      final_router: "universal_core",
    },
    task_graph: buildTaskGraph({ memoryContext, toolRouting: routing, ownerConfirmationRequired, executionAllowedByPreflight }),
    tool_routing: routing,
    governance: {
      core_verdict_required_before_execution: !readOnlyOperation,
      owner_confirmation_required: ownerConfirmationRequired && !ownerConfirmed,
      owner_confirmation_satisfied: ownerConfirmationRequired && ownerConfirmed,
      execution_allowed_by_preflight: executionAllowedByPreflight,
      direct_connector_bypass_forbidden_by_protocol: true,
      cross_tenant_actions_allowed: false,
      audit_required: true,
      rollback_required_for_release: Boolean(routing.release_policy),
    },
    governed_learning: {
      memory_source: "tenant_memory_fabric",
      stages: ["capture", "compare", "distill", "propose", "verify", "consolidate"],
      learns_from: ["verified_outcome", "explicit_feedback", "reproducible_failure"],
      procedural_rule_candidates: ["connected_tool_first", "memory_first", "verify_before_consolidate"],
      policy_activation_requires_verify: true,
      cross_tenant_learning: false,
      free_weight_training: false,
      runtime_self_modification: false,
    },
    protocol: {
      applies_to: "every_ai_connected_through_skinharmony_core_or_mcp",
      first_step: "work_preflight",
      fail_closed_when_preflight_unavailable: true,
      external_connectors_must_not_be_called_before_route: true,
      note: "Un client che bypassa completamente SkinHarmony resta fuori dal controllo tecnico del gateway.",
    },
  };
}

export { PREFLIGHT_VERSION, ROLE_CATALOG };
