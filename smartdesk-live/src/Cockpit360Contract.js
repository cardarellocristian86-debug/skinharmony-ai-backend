"use strict";

function compactList(value, limit = 6) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function cockpit360Contract({ cockpit = {}, enhanced = {}, tenantId = "", centerId = "" } = {}) {
  const external = enhanced.externalAi || enhanced.external_ai || {};
  return {
    ok: Boolean(cockpit.goldEnabled !== false),
    schema_version: "cockpit_360_v1",
    cockpit_version: cockpit.cockpitVersion || "gold_cockpit_v1",
    generated_at: new Date().toISOString(),
    scope: { tenant_id: tenantId || "", center_id: centerId || "" },
    mode: "read_only_advisory",
    source: {
      smartdesk: "gold_cockpit_v1",
      core: external.coreOutput?.ok ? "universal_core" : "unavailable",
      nyra: external.nyra?.success ? "nyra" : "unavailable",
      route: external.nyraPath || "not_requested"
    },
    cockpit: {
      summary: cockpit.summary || {},
      sections: compactList(cockpit.sections),
      primary_action: cockpit.primaryAction || cockpit.primary_action || null,
      data_quality: cockpit.dataQuality || cockpit.data_quality || null
    },
    decision: {
      answer: external.answer || "",
      first_action: external.firstAction || "",
      core_output: external.coreOutput || null,
      requested_branches: compactList(external.requestedBranches, 12),
      branch_analyses: compactList(external.branchAnalyses, 12)
    },
    guardrails: {
      read_only: true,
      automatic_execution_allowed: false,
      operator_confirmation_required: true,
      tenant_scoped: true,
      source_data_mutated: false
    }
  };
}

module.exports = { cockpit360Contract };
