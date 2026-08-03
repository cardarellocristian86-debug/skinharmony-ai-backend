"use strict";

const crypto = require("node:crypto");

const FABRIC_SCHEMA_VERSION = "nyra_capability_fabric_v1";
const MAX_PLAN_NODES = 24;
const MAX_PARALLEL_WAVES = 6;

const CANONICAL_SOURCES = Object.freeze([
  {
    id: "owasp_genai_agentic_security",
    authority: "OWASP GenAI Security Project",
    kind: "security_standard",
    url: "https://genai.owasp.org/",
    refresh_policy: "watch_and_review",
  },
  {
    id: "nist_ai_rmf",
    authority: "NIST",
    kind: "risk_framework",
    url: "https://www.nist.gov/itl/ai-risk-management-framework",
    refresh_policy: "watch_and_review",
  },
  {
    id: "mitre_atlas",
    authority: "MITRE",
    kind: "threat_knowledge_base",
    url: "https://atlas.mitre.org/",
    refresh_policy: "watch_and_review",
  },
  {
    id: "mcp_security_reference",
    authority: "Model Context Protocol",
    kind: "protocol_reference",
    url: "https://modelcontextprotocol.io/",
    refresh_policy: "watch_and_review",
  },
]);

const CAPABILITY_NODES = Object.freeze([
  ["security", "identity", "identity_binding", ["identita", "identity", "tenant", "owner", "agent"]],
  ["security", "identity", "least_privilege", ["permess", "privileg", "autorizz", "access"]],
  ["security", "memory", "memory_integrity", ["memoria", "memory", "poisoning", "avvelen"]],
  ["security", "memory", "memory_provenance", ["provenienza", "provenance", "source", "fonte"]],
  ["security", "tools", "mcp_tool_integrity", ["mcp", "tool", "rug pull", "schema"]],
  ["security", "tools", "egress_control", ["rete", "network", "ssrf", "egress", "dominio"]],
  ["security", "runtime", "sandbox_execution", ["sandbox", "container", "isolamento", "filesystem"]],
  ["security", "runtime", "resource_budget", ["costo", "budget", "token", "denial", "risorse"]],
  ["security", "evidence", "evidence_verification", ["evidenz", "verifica", "hash", "provenienza"]],
  ["security", "evidence", "adversarial_testing", ["red team", "attacco", "adversarial", "penetration"]],
  ["security", "resilience", "incident_response", ["incidente", "alert", "soc", "risposta"]],
  ["security", "resilience", "backup_recovery", ["backup", "restore", "disaster", "recupero"]],
  ["work", "intake", "intent_anchor", ["obiettivo", "richiesta", "scope", "vincol"]],
  ["work", "continuity", "checkpoint_resume", ["resume", "checkpoint", "continuit", "riprendi"]],
  ["work", "continuity", "drift_detection", ["drift", "cambiamento", "regression", "deriva"]],
  ["work", "coordination", "parallel_handoff", ["parallelo", "handoff", "coordina", "agenti"]],
  ["work", "quality", "quality_gate", ["qualita", "test", "qa", "collaudo"]],
  ["research", "sources", "canonical_source_registry", ["fonti", "canoniche", "standard", "documentazione"]],
  ["research", "sources", "renewable_ingestion", ["aggiorna", "rinnovabile", "refresh", "versione"]],
  ["research", "reasoning", "decision_support", ["decidi", "scelta", "priorita", "strategia"]],
]);

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableCanonical(value))).digest("hex");
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function nodeFromTuple(tuple) {
  const [domain, branch, id, triggers] = tuple;
  return { id: `nyra.${domain}.${branch}.${id}`, domain, branch, capability: id, triggers };
}

function createNyraCapabilityFabric(env = process.env) {
  const maxPlanNodes = Math.max(6, Math.min(MAX_PLAN_NODES, Number(env.NYRA_CAPABILITY_PLAN_MAX_NODES || MAX_PLAN_NODES)));
  const nodes = CAPABILITY_NODES.map(nodeFromTuple);
  const catalogRevision = digest({ schema_version: FABRIC_SCHEMA_VERSION, nodes, sources: CANONICAL_SOURCES });

  function contract() {
    return {
      schema_version: FABRIC_SCHEMA_VERSION,
      catalog_revision: catalogRevision,
      generation: "lazy_composition",
      theoretical_combination_space: "unbounded_by_static_materialization",
      max_materialized_plan_nodes: maxPlanNodes,
      maximum_parallel_waves: MAX_PARALLEL_WAVES,
      canonical_sources: CANONICAL_SOURCES.map(({ id, authority, kind, refresh_policy }) => ({ id, authority, kind, refresh_policy })),
      source_instructions_are_data: true,
      core_validation_required: true,
      automatic_global_promotion: false,
      branch_authority: "universal_core",
    };
  }

  function compose({ text = "", proposedBranches = [], targetSystem = "universal_core" } = {}) {
    const normalized = normalize(text);
    const selected = nodes.filter((node) => node.triggers.some((trigger) => normalized.includes(normalize(trigger))));
    const baselineIds = new Set(["nyra.work.intake.intent_anchor", "nyra.security.identity.identity_binding"]);
    for (const node of nodes) if (baselineIds.has(node.id) && !selected.includes(node)) selected.push(node);
    const deduped = [...new Map(selected.map((node) => [node.id, node])).values()];
    const materialized = deduped.slice(0, maxPlanNodes).map((node) => ({
      ...node,
      state: "proposed_waiting_for_core",
      required_evidence: ["input_context", "source_provenance", "core_verdict"],
      verifier: `verify.${node.capability}`,
    }));
    const domains = [...new Set(materialized.map((node) => node.domain))];
    const branchCount = Math.max(1, proposedBranches.length);
    const theoreticalCombinationCount = Math.max(1, domains.length) * Math.max(1, materialized.length) * branchCount;
    const waves = [];
    for (let index = 0; index < materialized.length; index += MAX_PARALLEL_WAVES) {
      waves.push(materialized.slice(index, index + MAX_PARALLEL_WAVES).map((node) => node.id));
    }
    return {
      schema_version: FABRIC_SCHEMA_VERSION,
      catalog_revision: catalogRevision,
      target_system: targetSystem,
      state: "proposed_waiting_for_core",
      selected_node_count: materialized.length,
      selected_nodes: materialized,
      proposed_branches: [...proposedBranches],
      parallel_waves: waves,
      theoretical_combination_count: theoreticalCombinationCount,
      pruning: {
        strategy: "bounded_relevance_topological_pruning",
        max_plan_nodes: maxPlanNodes,
        omitted_node_count: Math.max(0, deduped.length - materialized.length),
      },
      canonical_sources: CANONICAL_SOURCES.map((source) => source.id),
      execution_allowed: false,
      core_must_validate_and_open: true,
    };
  }

  return { contract, compose, catalogRevision };
}

module.exports = { CANONICAL_SOURCES, CAPABILITY_NODES, createNyraCapabilityFabric };
