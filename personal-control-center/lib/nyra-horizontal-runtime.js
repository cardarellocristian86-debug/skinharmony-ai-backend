"use strict";

const BRANCH_TRIGGERS = Object.freeze({
  context_intelligence: ["contesto", "stato", "dati", "input", "mappa"],
  work_intake: ["obiettivo", "requisit", "deliverable", "risultato", "vincol", "scope", "lavoro", "task"],
  research_evidence: ["ricerca", "fonti", "evidenz", "verifica dati", "documentazione", "paper", "benchmark", "source"],
  decision_reasoning: ["decidi", "scegli", "priorita", "opzioni", "strategia", "valuta"],
  planning_prioritization: ["pianifica", "priorit", "roadmap", "sequenza", "milestone", "dipenden", "stima"],
  risk_governance: ["rischio", "sicurezza", "privacy", "policy", "audit", "tenant", "permessi"],
  execution_planning: ["piano", "esegui", "runbook", "deploy", "render", "automat", "implementa"],
  parallel_coordination: ["parallelo", "coordina", "delega", "agenti", "handoff", "concorren", "sincron", "collabora"],
  quality_verification: ["test", "qualita", "verifica", "collaudo", "accettazione", "regression", "evidence", "qa"],
  learning_memory: ["impara", "memoria", "feedback", "correzione", "benchmark", "lezione"],
  adaptive_learning: ["apprendi", "migliora", "retrospettiva", "outcome", "errore", "lezione", "pattern", "feedback"],
  communication_explanation: ["spiega", "riassumi", "scrivi", "comunica", "traduci"],
});

const MAX_PARALLEL_BRANCHES = 6;

function normalizeIdentifier(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "_").slice(0, 64);
}

function proposeBranches(text) {
  const value = String(text || "").toLowerCase();
  const inferred = Object.entries(BRANCH_TRIGGERS)
    .filter(([, triggers]) => triggers.some((trigger) => value.includes(trigger)))
    .map(([id]) => id);
  return [...new Set(["context_intelligence", "work_intake", "risk_governance", ...inferred])];
}

function inferIntent(text) {
  const value = String(text || "").toLowerCase();
  if (/(parallelo|coordina|delega|agenti|handoff|concorren|sincron)/.test(value)) return "bounded_parallel_coordination";
  if (/(test|qualita|verifica|collaudo|accettazione|regression|qa)/.test(value)) return "quality_and_verification";
  if (/(apprendi|impara|migliora|retrospettiva|outcome|feedback|lezione)/.test(value)) return "governed_adaptive_learning";
  if (/(pianifica|priorit|roadmap|sequenza|milestone|dipenden|stima)/.test(value)) return "planning_and_prioritization";
  if (/(piano|esegui|runbook|deploy|render|automat|implementa)/.test(value)) return "controlled_execution_planning";
  if (/(ricerca|fonti|evidenz|documentazione|paper|benchmark|source)/.test(value)) return "research_and_evidence";
  if (/(rischio|sicurezza|privacy|policy|audit)/.test(value)) return "risk_and_governance_review";
  if (/(decidi|scegli|priorita|opzioni|strategia|valuta)/.test(value)) return "decision_support";
  if (/(spiega|riassumi|scrivi|comunica|traduci)/.test(value)) return "explanation_and_communication";
  return "context_and_decision_support";
}

function createNyraHorizontalRuntime(env = process.env) {
  const serviceName = String(env.NYRA_SERVICE_NAME || "nyra-horizontal-runtime").trim();
  const configuredDomainPack = normalizeIdentifier(env.NYRA_DOMAIN_PACK_ID);
  const version = String(env.NYRA_SERVICE_VERSION || "0.8.0-memory-first-preflight").trim();

  function contract() {
    return {
      schema_version: "nyra_horizontal_runtime_contract_v1",
      service: serviceName,
      version,
      runtime_kind: "horizontal_neural_branch_runtime",
      domain_pack_resolution: "universal_core_key_metadata_only",
      expected_domain_pack_id: null,
      vertical_pack_selection: "forbidden_in_horizontal_runtime",
      legacy_domain_pack_env_ignored: Boolean(configuredDomainPack),
      neural_network: {
        catalog_source: "universal_core",
        catalog_endpoint: "GET /v1/nira/branches",
        router_endpoint: "POST /v1/nira/core-bridge",
        maximum_subbranches_per_branch: 20,
        maximum_parallel_branches: MAX_PARALLEL_BRANCHES,
        parallel_mode: "bounded_parallel_advisory",
        join_authority: "universal_core",
        rule: "Nyra propone i rami; Universal Core li valida e li apre.",
      },
      governed_learning: {
        memory_source: "tenant_memory_fabric",
        stages: ["capture", "compare", "distill", "propose", "verify", "consolidate"],
        policy_activation_requires_verify: true,
        free_weight_training: false,
        auto_execution: false,
      },
      mandatory_preflight: {
        schema_version: "universal_work_preflight_v1",
        core_endpoint: "POST /v1/work/preflight",
        enforced_by_router_endpoint: "POST /v1/nira/core-bridge",
        sequence: ["recall_tenant_memory", "nyra_interpret_request", "core_open_and_join_branches", "core_verdict", "owner_confirmation_when_required", "execute", "verify", "learn"],
        connected_tool_first: true,
        fail_closed_when_unavailable: true,
      },
      authority: {
        may_propose_branches: true,
        may_open_branches: false,
        may_execute_actions: false,
        may_begin_work_without_preflight: false,
        core_is_final_router: true,
      },
    };
  }

  function prepareInterpretation(payload = {}) {
    const text = typeof payload.message === "string" ? payload.message.trim() : typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) return { ok: false, status: 400, error: "message_required" };
    if (text.length > 20_000) return { ok: false, status: 413, error: "message_too_long" };
    const requestedPack = normalizeIdentifier(payload.domain_pack || payload.domain_pack_id);
    if (requestedPack) return { ok: false, status: 403, error: "domain_pack_selection_forbidden" };
    const proposedBranches = proposeBranches(text);
    const waves = [];
    for (let index = 0; index < proposedBranches.length; index += MAX_PARALLEL_BRANCHES) {
      waves.push(proposedBranches.slice(index, index + MAX_PARALLEL_BRANCHES));
    }
    const learningActive = proposedBranches.includes("learning_memory") || proposedBranches.includes("adaptive_learning");
    return {
      ok: true,
      text,
      core_request: {
        text,
        request_id: String(payload.request_id || payload.session_id || "").slice(0, 120) || undefined,
        target_system: normalizeIdentifier(payload.target_system) || "universal_core",
        nyra_branches: proposedBranches,
        mode: "standard",
        preflight_required: true,
      },
      local_interpretation: {
        intent: inferIntent(text),
        proposed_branches: proposedBranches,
        branch_state: "proposed_waiting_for_core",
        parallel_proposal: {
          mode: "bounded_parallel_advisory",
          maximum_parallel_branches: MAX_PARALLEL_BRANCHES,
          waves,
          join_authority: "universal_core",
        },
        governed_learning: {
          state: learningActive ? "proposed_waiting_for_core_verify" : "available_on_feedback_or_outcome",
          memory_source: "tenant_memory_fabric",
          policy_activation_requires_verify: true,
        },
        preflight_state: "mandatory_waiting_for_core",
        execution_allowed: false,
      },
    };
  }

  return {
    serviceName,
    version,
    expectedDomainPack: null,
    configuredDomainPackIgnored: configuredDomainPack || null,
    contract,
    prepareInterpretation,
  };
}

module.exports = { MAX_PARALLEL_BRANCHES, createNyraHorizontalRuntime, proposeBranches };
