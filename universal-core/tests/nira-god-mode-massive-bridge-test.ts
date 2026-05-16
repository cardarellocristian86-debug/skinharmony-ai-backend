import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNiraUniversalCoreBridge } from "../tools/nira-universal-core-bridge.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPORT_PATH = join(ROOT, "reports", "universal-core", "nira", "nira_god_mode_massive_bridge_latest.json");

const domains = [
  "Suite Control Plane Render",
  "WordPress Site Suite",
  "Smart Desk bridge",
  "runbook marketplace",
  "tenant isolation",
  "release update server",
  "audit evidence layer",
  "connector sdk",
  "WaaS provisioning",
  "Core policy engine",
];

const verbs = [
  "alleggerisci",
  "verifica",
  "orchestra",
  "prepara",
  "sposta",
  "sincronizza",
  "isola",
  "accoda",
  "rankizza",
  "blocca se rischioso",
];

const constraints = [
  "senza bypassare Core",
  "con owner confirmation",
  "con rollback possibile",
  "senza dati cliente raw",
  "con artifact firmato",
  "in modalita proposal-only",
  "con audit obbligatorio",
  "con fallback WordPress",
  "con Render come control plane",
  "con tenant scope forte",
];

function buildScenario(index: number): string {
  const domain = domains[index % domains.length];
  const verb = verbs[Math.floor(index / domains.length) % verbs.length];
  const constraint = constraints[(index * 3) % constraints.length];
  return `Metti Nira in God Mode owner-only: ${verb} ${domain} ${constraint}, genera varianti e lascia Universal Core come giudice finale. Scenario ${index + 1}.`;
}

const scenarioCount = 120;
const startedAt = performance.now();
const results = [];

for (let index = 0; index < scenarioCount; index++) {
  const result = runNiraUniversalCoreBridge({
    request_id: `nira-god-massive:${index + 1}`,
    text: buildScenario(index),
    owner_verified: true,
    access_scope: "owner_full",
    mode: "god_mode_owner_only",
    target_system: index % 3 === 0 ? "suite" : index % 3 === 1 ? "wordpress" : "smartdesk",
  });

  assert.equal(result.ok, true);
  assert.equal(result.god_mode_active, true);
  assert.equal(result.selected_by_core.requires_owner_confirmation, true);
  assert.equal(result.automation_plan.audit_required, true);
  assert.equal(result.automation_plan.execution_allowed, false);
  assert.ok(result.prepared_by_nira.scenarios.length >= 4);

  results.push({
    request_id: result.core_input.request_id,
    target_system: result.prepared_by_nira.target_system,
    intent: result.prepared_by_nira.intent,
    scenario_count: result.prepared_by_nira.scenarios.length,
    core_state: result.selected_by_core.state,
    control_level: result.selected_by_core.control_level,
    risk_band: result.selected_by_core.risk_band,
    primary_action_id: result.selected_by_core.primary_action_id,
    primary_action_label: result.selected_by_core.primary_action_label,
    blocked_reasons: result.selected_by_core.blocked_reasons,
    step_reduction_pct: result.efficiency.step_reduction_pct,
    decision_confidence: result.efficiency.decision_confidence,
  });
}

const elapsedMs = Math.round(performance.now() - startedAt);
const controlCounts = Object.fromEntries(
  [...new Set(results.map((item) => item.control_level))].map((level) => [
    level,
    results.filter((item) => item.control_level === level).length,
  ]),
);
const riskCounts = Object.fromEntries(
  [...new Set(results.map((item) => item.risk_band))].map((band) => [
    band,
    results.filter((item) => item.risk_band === band).length,
  ]),
);
const topActions = Object.entries(
  results.reduce<Record<string, number>>((acc, item) => {
    acc[item.primary_action_id] = (acc[item.primary_action_id] ?? 0) + 1;
    return acc;
  }, {}),
)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .map(([action_id, count]) => ({ action_id, count }));

const avgReduction = Math.round(results.reduce((sum, item) => sum + item.step_reduction_pct, 0) / results.length);
const avgConfidence = Math.round((results.reduce((sum, item) => sum + item.decision_confidence, 0) / results.length) * 100) / 100;
const allConfirmOrSafer = results.every((item) => ["confirm", "suggest", "observe", "blocked"].includes(item.control_level));
const noAutoExecution = results.every((item) => item.control_level !== "execute_allowed");

const report = {
  ok: true,
  version: "nira_god_mode_massive_bridge_v1",
  generated_at: new Date().toISOString(),
  scenario_count: scenarioCount,
  elapsed_ms: elapsedMs,
  throughput_scenarios_per_sec: Math.round((scenarioCount / (elapsedMs / 1000)) * 100) / 100,
  god_mode_owner_only: true,
  validation: {
    all_confirm_or_safer: allConfirmOrSafer,
    no_auto_execution: noAutoExecution,
    owner_confirmation_required: true,
    audit_required: true,
  },
  metrics: {
    average_step_reduction_pct: avgReduction,
    average_decision_confidence: avgConfidence,
    control_counts: controlCounts,
    risk_counts: riskCounts,
    top_actions: topActions,
  },
  interpretation: {
    works_better_for_codex: avgReduction >= 35 && avgConfidence >= 70 && noAutoExecution,
    strongest_effect: "Nira comprime richieste operative complesse in scenari strutturati; Universal Core mantiene conferma e ranking finale.",
    limit: "Il test non esegue azioni reali e non sostituisce prove live su Render/WP; misura orchestrazione e gating locale.",
  },
  sample_results: results.slice(0, 12),
};

assert.equal(report.validation.all_confirm_or_safer, true);
assert.equal(report.validation.no_auto_execution, true);
assert.ok(report.metrics.average_step_reduction_pct >= 35);
assert.ok(report.metrics.average_decision_confidence >= 70);

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

console.log(JSON.stringify({
  ok: report.ok,
  reportPath: REPORT_PATH,
  scenario_count: report.scenario_count,
  elapsed_ms: report.elapsed_ms,
  throughput_scenarios_per_sec: report.throughput_scenarios_per_sec,
  validation: report.validation,
  metrics: report.metrics,
  interpretation: report.interpretation,
}, null, 2));
