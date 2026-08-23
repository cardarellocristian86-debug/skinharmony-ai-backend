"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const bridgePath = path.resolve(__dirname, "../public/assets/gold-bridge.js");
const source = fs.readFileSync(bridgePath, "utf8");

// Keep these assertions close to the static bridge: they protect the request
// contract without requiring a browser bundle or a live Core provider.
assert.match(source, /const GOLD_OVERVIEW_TTL_MS = 2 \* 60 \* 1000/);
assert.match(source, /let goldOverviewInFlight = null/);
assert.match(source, /nativeFetch\("\/api\/ai-gold\/overview"/);
assert.match(source, /"If-None-Match": etag/);
assert.match(source, /goldOverviewCache\.sessionKey === overviewSessionKey\(\)/);
assert.match(source, /goldOverviewCache\?\.sessionKey !== overviewSessionKey\(\)/);
const overviewReader = source.slice(source.indexOf("async function fetchAiOverview"), source.indexOf("function installOverviewCompatibilityRead"));
assert.doesNotMatch(overviewReader, /\/api\/ai-gold\/state/);
assert.doesNotMatch(overviewReader, /\/api\/ai-gold\/capabilities/);
assert.doesNotMatch(overviewReader, /\/api\/ai-gold\/decision-context/);
assert.match(source, /function installOverviewCompatibilityRead\(\)/);
assert.match(source, /pathname === "\/api\/ai-gold\/capabilities"/);
assert.match(source, /pathname === "\/api\/ai-gold\/decision-context"/);
assert.match(source, /const OVERVIEW_READ_ROUTES = new Set\(\["\/", "\/dashboard", "\/ai-gold"\]\)/);
assert.match(source, /pathname === "\/api\/ai-gold\/state"/);
assert.match(source, /pathname === "\/api\/ai-gold\/cockpit"/);
assert.match(source, /pathname === "\/api\/ai-gold\/profitability"/);
assert.match(source, /pathname === "\/api\/ai-gold\/marketing\/autopilot"/);
assert.match(source, /pathname === "\/api\/ai-gold\/decision-center"/);
assert.match(source, /"X-SmartDesk-Overview-Reused": "1"/);
assert.doesNotMatch(source, /fetchJson\("\/api\/ai-gold\/customer-intelligence"\)/);
assert.match(source, /data-gold-refresh/);
assert.match(source, /scheduleRender\(\{ fromMutation: true \}\)/);
assert.doesNotMatch(source, /window\.setTimeout\(renderGoldBridge, 900\)/);
assert.doesNotMatch(source, /window\.setTimeout\(renderEnterprisePanels, 520\)/);
assert.doesNotMatch(source, /window\.setTimeout\(renderSettingsTools, 900\)/);
assert.match(source, /if \(goldRenderInFlight\) return goldRenderInFlight/);
assert.doesNotMatch(source, /window\.setTimeout\([^,]+,\s*(?:[5-9]\d{2}|\d{4,})\)/);
assert.match(source, /without adding an[\s\S]*artificial page-entry delay/);
assert.match(source, /queueMicrotask\(\(\) =>/);
assert.doesNotMatch(source, /window\.setTimeout\(renderGoldBridge/);
assert.match(source, /Smart Desk locale · dati osservati/);
assert.match(source, /Core è richiesto separatamente solo per verdict autoritativi o azioni sensibili/);
assert.doesNotMatch(source, /riprova la lettura esterna/);

async function assertConcurrentCompatibilityReads() {
  const runtimeSource = source.slice(source.indexOf("function goldOverviewIsFresh"), source.indexOf("async function refreshUiLanguage"));
  let nativeCalls = 0;
  const overviewPayload = {
    eventSeq: 11,
    capabilities: { currentPlan: "gold" },
    context: { currentPlan: "gold" },
    compatibility: {
      state: { eventSeq: 11 },
      cockpit: { cockpitVersion: "projection" },
      profitability: { readOnly: true },
      marketingAutopilot: { actions: [] },
      decisionCenter: { currentPlan: "gold" }
    }
  };
  const runtimeWindow = {
    location: { pathname: "/ai-gold", origin: "https://smartdesk.test" },
    localStorage: { getItem: () => "tenant-bound-token" },
    fetch: null
  };
  const context = {
    URL,
    Request,
    Response,
    Date,
    Math,
    String,
    Number,
    Boolean,
    GOLD_OVERVIEW_TTL_MS: 120000,
    OVERVIEW_READ_ROUTES: new Set(["/", "/dashboard", "/ai-gold"]),
    goldOverviewCache: null,
    goldOverviewInFlight: null,
    window: runtimeWindow,
    buildAuthHeaders: (headers) => headers,
    nativeFetch: async (url) => {
      nativeCalls += 1;
      assert.equal(url, "/api/ai-gold/overview");
      return {
        ok: true,
        status: 200,
        headers: { get: () => "" },
        json: async () => overviewPayload
      };
    }
  };
  vm.runInNewContext(`${runtimeSource}\ninstallOverviewCompatibilityRead();`, context);
  const legacyReads = [
    "/api/ai-gold/state",
    "/api/ai-gold/cockpit",
    "/api/ai-gold/capabilities",
    "/api/ai-gold/decision-context",
    "/api/ai-gold/profitability?startDate=2026-08-23",
    "/api/ai-gold/marketing/autopilot",
    "/api/ai-gold/decision-center"
  ];
  const responses = await Promise.all(legacyReads.map((url) => runtimeWindow.fetch(url)));
  assert.equal(nativeCalls, 1, "seven concurrent legacy Gold reads must single-flight one overview request");
  assert.ok(responses.every((response) => response.headers.get("X-SmartDesk-Overview-Reused") === "1"));
}

assertConcurrentCompatibilityReads()
  .then(() => console.log(JSON.stringify({ ok: true, runner: "gold_bridge_cache_test", concurrentLegacyReads: 7, nativeOverviewReads: 1 })))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
