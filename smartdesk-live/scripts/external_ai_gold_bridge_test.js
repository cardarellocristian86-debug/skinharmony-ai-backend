"use strict";

const assert = require("node:assert");
const { ExternalAiGoldBridge } = require("../src/ExternalAiGoldBridge");

const governedCalls = [];

const bridge = new ExternalAiGoldBridge({
  nyraBaseUrl: "http://nyra.test",
  nyraApiKey: "nyra-test-key",
  universalCoreBridge: {
    isConfigured: () => true,
    status: () => ({ configured: true, providerUrl: "http://core.test" }),
    nyraInterpret: async (payload) => {
      governedCalls.push({ type: "preflight", payload });
      return {
        success: true,
        result: {
          deep_nyra_runtime: {
            dialogue: { preferred_reply: "Stato centro: dati leggibili. Priorita: completa i costi servizi e poi controlla margini." }
          }
        }
      };
    },
    decision: async (payload) => {
      governedCalls.push({ type: "decision", payload });
      return {
        success: true,
        decision_contract: { confidence: 0.82 },
        risk: { band: "low", score: 18 },
        received: payload
      };
    },
    branchAnalyze: async (branch, payload) => {
      governedCalls.push({ type: "branch", branch, payload });
      return {
        success: true,
        ok: true,
        branch,
        profile: { label: branch, rules: ["regola Smart Desk"] },
        branch_output: {
          readout_mode: branch === "executive_gold" ? "executive_priority" : "readonly_operational_control",
          next_actions: ["apri servizi e completa i costi"],
          missing_data: ["costi servizio mancanti"],
          receivedPlan: payload.data?.plan
        },
        output: { risk: { band: "low", score: 12 } }
      };
    }
  }
});

const originalFetch = global.fetch;
global.fetch = async () => {
  throw new Error("Core-governed Nyra path must not call the direct Nyra provider");
};

(async () => {
  try {
    const readout = await bridge.buildReadout({
      mode: "gold",
      question: "cosa devo fare oggi?",
      session: { centerId: "center-privilege", username: "privilege", token: "raw-session-secret" },
      context: {
        businessSnapshot: { dataQuality: { score: 72 }, core: { appointments: 8 } },
        goldDecisionContext: {
          primaryAction: { label: "Completa costi servizi", suggestedAction: "apri servizi e completa i costi" },
          topSignals: [{ label: "Costi incompleti" }]
        }
      }
    });
    assert.strictEqual(readout.provider, "universal_core_server_nyra_server");
    assert.strictEqual(readout.sourceLayer, "external_core_nyra_render");
    assert(readout.requestedBranches.includes("executive_gold"));
    assert(readout.requestedBranches.includes("smartdesk_operations_guard"));
    assert(readout.branchAnalyses.some((item) => item.branch === "executive_gold"));
    assert.strictEqual(readout.nyraAnswerAccepted, true);
    assert.strictEqual(readout.guardrails.smartDeskCalculatesNumbers, true);
    assert.strictEqual(readout.guardrails.coreDecides, true);
    assert.strictEqual(readout.guardrails.nyraExplains, true);
    assert.match(readout.answer, /Priorita|Priorità|costi/i);
    assert.strictEqual(governedCalls[0].type, "preflight");
    const scopes = governedCalls.map((call) => call.payload?._preflight_scope).filter(Boolean);
    assert(scopes.length >= 3);
    scopes.forEach((scope) => {
      assert.strictEqual(scope.center_id, "center-privilege");
      assert.strictEqual(scope.user_id, "privilege");
      assert.match(scope.session_id, /^[a-f0-9]{64}$/);
      assert.notStrictEqual(scope.session_id, "raw-session-secret");
    });
    console.log(JSON.stringify({ ok: true, runner: "external_ai_gold_bridge_test" }, null, 2));
  } finally {
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
