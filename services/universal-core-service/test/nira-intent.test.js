import assert from "node:assert/strict";
import test from "node:test";
import { inferNiraIntent, inferNiraTarget, prepareContextualNiraScenarios } from "../../../universal-core/tools/nira-intent.js";

test("keeps read, security, Suite and learning intents distinct", () => {
  assert.equal(inferNiraIntent("Leggi lo stato del tenant"), "read_current_state");
  assert.equal(inferNiraIntent("Mostra la Suite Pay Key"), "security_review");
  assert.equal(inferNiraIntent("Verifica una patch WordPress Site Suite"), "suite_quality_verification");
  assert.equal(inferNiraIntent("Consolida una lezione dopo outcome verificato"), "governed_learning");
});

test("does not let a generic Universal Core target hide the product target", () => {
  assert.equal(inferNiraTarget("Pianifica Site Suite", "universal_core"), "suite");
  assert.equal(inferNiraTarget("Controlla agenda SmartDesk", "universal_core"), "smartdesk");
  assert.equal(inferNiraTarget("Valuta protocollo beauty", "universal_core"), "analyzer");
});

test("never proposes Render for an ordinary Suite request", () => {
  const ids = prepareContextualNiraScenarios({ text: "Pianifica un lavoro Site Suite" }).map((item) => item.id);
  assert(ids.includes("suite_plan"));
  assert.equal(ids.includes("render_handoff"), false);
});

test("proposes Render only for an explicit Render runtime or deploy request", () => {
  const ids = prepareContextualNiraScenarios({ text: "Prepara deploy del servizio su Render" }).map((item) => item.id);
  assert(ids.includes("runtime_readiness"));
  assert(ids.includes("deployment_runbook"));
  assert(ids.includes("render_handoff"));
});

test("read-only scenarios do not require confirmation", () => {
  const scenarios = prepareContextualNiraScenarios({ text: "Leggi audit e stato del tenant" });
  assert(scenarios.every((item) => item.execution_scope !== "confirm_required"));
});

