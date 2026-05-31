"use strict";

const assert = require("node:assert");
const { ExternalAiGoldBridge } = require("../src/ExternalAiGoldBridge");

const bridge = new ExternalAiGoldBridge({
  nyraBaseUrl: "http://nyra.test",
  universalCoreBridge: {
    isConfigured: () => true,
    status: () => ({ configured: true, providerUrl: "http://core.test" }),
    decision: async (payload) => ({
      success: true,
      decision_contract: { confidence: 0.82 },
      risk: { band: "low", score: 18 },
      received: payload
    })
  }
});

const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  assert.strictEqual(url, "http://nyra.test/api/nyra/text-chat");
  const body = JSON.parse(options.body || "{}");
  assert(body.text.includes("AI Gold Smart Desk"));
  assert(body.text.includes("Smart Desk"));
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        ok: true,
        result: {
          content: "Stato centro: dati leggibili. Priorita: completa i costi servizi e poi controlla margini.",
          ui: { badges: ["core2-v1-v2-v7"] },
          core2Pipeline: { winner: { control_level: "suggest" } }
        }
      };
    }
  };
};

(async () => {
  try {
    const readout = await bridge.buildReadout({
      mode: "gold",
      question: "cosa devo fare oggi?",
      session: { username: "privilege" },
      context: {
        businessSnapshot: { dataQuality: { score: 72 }, core: { appointments: 8 } },
        goldDecisionContext: {
          primaryAction: { label: "Completa costi servizi", suggestedAction: "apri servizi e completa i costi" },
          topSignals: [{ label: "Costi incompleti" }]
        }
      }
    });
    assert.strictEqual(readout.provider, "universal_core_render_nyra_render");
    assert.strictEqual(readout.sourceLayer, "external_core_nyra_render");
    assert.strictEqual(readout.guardrails.smartDeskCalculatesNumbers, true);
    assert.strictEqual(readout.guardrails.coreDecides, true);
    assert.strictEqual(readout.guardrails.nyraExplains, true);
    assert.match(readout.answer, /Priorita|Priorità|costi/i);
    console.log(JSON.stringify({ ok: true, runner: "external_ai_gold_bridge_test" }, null, 2));
  } finally {
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
