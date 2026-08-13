import test from "node:test";
import assert from "node:assert/strict";
import { createIcfKernel } from "../src/icfKernel.js";

const gates = [
  ["postgres_store_ready", "PostgreSQL store autoritativo pronto"],
  ["ledger_atomicity_verified", "Ledger atomico e hash-chain verificabile"],
  ["warrant_concurrency_tests_passed", "Warrant idempotente e concorrente"],
  ["unknown_effect_recovery_verified", "Recovery da effetto UNKNOWN"],
  ["evidence_trust_registry_ready", "Registry fonti e verifier indipendenti"],
  ["local_join_independent", "Local Proof Join indipendente"],
  ["global_join_independent", "Global Intent Join indipendente"],
  ["coreseal_production_key_configured", "Chiave CoreSeal production"],
  ["closure_cas_verified", "Closure compare-and-swap"],
  ["legacy_migration_reconciled", "Migrazione legacy riconciliata"],
  ["fault_injection_passed", "Fault injection completato"],
  ["benchmark_passed", "Benchmark A/B completato"],
  ["rollback_plan_verified", "Rollback verificato"],
];

test("ICF closure work resta BLOCK finché tutti i gate non hanno prova", () => {
  const kernel = createIcfKernel();
  const covenant = kernel.putCovenant("codexai", "icf-1.0-closure", { outcomes: gates.map(([id]) => id), anti_goals: ["close_without_evidence", "enable_enforced_without_gate"] }).covenant;
  const obligations = kernel.compile("codexai", "icf-1.0-closure", gates.map(([id], index) => ({ claim: gates[index][1], obligation_id: id, clause_refs: [covenant.clauses[index].clause_id], criticality: "critical" }))).obligations;
  assert.equal(kernel.status("codexai", "icf-1.0-closure").closure.decision, "BLOCK");
  assert.equal(obligations.length, gates.length);
  assert.ok(kernel.status("codexai", "icf-1.0-closure").closure.required_open_obligations > 0);
});

test("la migration PostgreSQL ICF è versionata e transazionale", async () => {
  const fs = await import("node:fs");
  const sql = fs.readFileSync(new URL("../migrations/20260812_icf_v1.sql", import.meta.url), "utf8");
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /core_icf_work/);
  assert.match(sql, /core_icf_event/);
  assert.match(sql, /SELECT|UNIQUE/);
  assert.match(sql, /COMMIT;/);
});
