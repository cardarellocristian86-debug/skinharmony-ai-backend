"use strict";

const BRANCH_TRIGGERS = Object.freeze({
  context_intelligence: ["contesto", "stato", "dati", "input", "mappa"],
  decision_reasoning: ["decidi", "scegli", "priorita", "opzioni", "strategia", "valuta"],
  risk_governance: ["rischio", "sicurezza", "privacy", "policy", "audit", "tenant", "permessi"],
  execution_planning: ["piano", "esegui", "runbook", "deploy", "render", "automat", "implementa"],
  learning_memory: ["impara", "memoria", "feedback", "correzione", "benchmark"],
  communication_explanation: ["spiega", "riassumi", "scrivi", "comunica", "traduci"],
  skinharmony_domain: ["skinharmony", "beauty", "salone", "smartdesk", "protocollo", "cosmet"],
});

function normalizeIdentifier(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "_").slice(0, 64);
}

function proposeBranches(text) {
  const value = String(text || "").toLowerCase();
  const inferred = Object.entries(BRANCH_TRIGGERS)
    .filter(([, triggers]) => triggers.some((trigger) => value.includes(trigger)))
    .map(([id]) => id);
  return [...new Set(["context_intelligence", "risk_governance", ...inferred])];
}

function inferIntent(text) {
  const value = String(text || "").toLowerCase();
  if (/(piano|esegui|runbook|deploy|render|automat|implementa)/.test(value)) return "controlled_execution_planning";
  if (/(rischio|sicurezza|privacy|policy|audit)/.test(value)) return "risk_and_governance_review";
  if (/(decidi|scegli|priorita|opzioni|strategia|valuta)/.test(value)) return "decision_support";
  if (/(spiega|riassumi|scrivi|comunica|traduci)/.test(value)) return "explanation_and_communication";
  return "context_and_decision_support";
}

function createNyraHorizontalRuntime(env = process.env) {
  const serviceName = String(env.NYRA_SERVICE_NAME || "nyra-horizontal-runtime").trim();
  const expectedDomainPack = normalizeIdentifier(env.NYRA_DOMAIN_PACK_ID);
  const version = String(env.NYRA_SERVICE_VERSION || "0.6.0-horizontal-neural-branches").trim();

  function contract() {
    return {
      schema_version: "nyra_horizontal_runtime_contract_v1",
      service: serviceName,
      version,
      runtime_kind: "horizontal_neural_branch_runtime",
      domain_pack_resolution: expectedDomainPack ? "core_validated_expected_pack" : "core_resolved_from_tenant",
      expected_domain_pack_id: expectedDomainPack || null,
      neural_network: {
        catalog_source: "universal_core",
        catalog_endpoint: "GET /v1/nira/branches",
        router_endpoint: "POST /v1/nira/core-bridge",
        maximum_subbranches_per_branch: 20,
        rule: "Nyra propone i rami; Universal Core li valida e li apre.",
      },
      authority: {
        may_propose_branches: true,
        may_open_branches: false,
        may_execute_actions: false,
        core_is_final_router: true,
      },
    };
  }

  function prepareInterpretation(payload = {}) {
    const text = typeof payload.message === "string" ? payload.message.trim() : typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) return { ok: false, status: 400, error: "message_required" };
    if (text.length > 20_000) return { ok: false, status: 413, error: "message_too_long" };
    const requestedPack = normalizeIdentifier(payload.domain_pack || payload.domain_pack_id);
    if (expectedDomainPack && requestedPack && requestedPack !== expectedDomainPack) {
      return { ok: false, status: 403, error: "domain_pack_override_denied" };
    }
    return {
      ok: true,
      text,
      core_request: {
        text,
        request_id: String(payload.request_id || payload.session_id || "").slice(0, 120) || undefined,
        target_system: normalizeIdentifier(payload.target_system) || "universal_core",
        nyra_branches: proposeBranches(text),
        ...(requestedPack || expectedDomainPack ? { domain_pack: requestedPack || expectedDomainPack } : {}),
        mode: "standard",
      },
      local_interpretation: {
        intent: inferIntent(text),
        proposed_branches: proposeBranches(text),
        branch_state: "proposed_waiting_for_core",
        execution_allowed: false,
      },
    };
  }

  return { serviceName, version, expectedDomainPack, contract, prepareInterpretation };
}

module.exports = { createNyraHorizontalRuntime, proposeBranches };

