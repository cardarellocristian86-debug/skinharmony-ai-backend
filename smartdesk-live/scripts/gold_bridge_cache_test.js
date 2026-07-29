"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const bridgePath = path.resolve(__dirname, "../public/assets/gold-bridge.js");
const source = fs.readFileSync(bridgePath, "utf8");

// Keep these assertions close to the static bridge: they protect the request
// contract without requiring a browser bundle or a live Core provider.
assert.match(source, /const GOLD_OVERVIEW_TTL_MS = 2 \* 60 \* 1000/);
assert.match(source, /let goldOverviewInFlight = null/);
assert.match(source, /fetchJson\("\/api\/ai-gold\/state"\)/);
assert.match(source, /tenantKey: String\(state\?\.centerId \|\| state\?\.tenantId \|\| ""\)/);
assert.match(source, /goldOverviewCache\.tenantKey === tenantKey/);
assert.match(source, /goldOverviewCache\.eventSeq === eventSeq/);
assert.match(source, /fetchJson\("\/api\/ai-gold\/capabilities"\)/);
assert.match(source, /fetchJson\("\/api\/ai-gold\/decision-context"\)/);
assert.doesNotMatch(source, /fetchJson\("\/api\/ai-gold\/customer-intelligence"\)/);
assert.match(source, /data-gold-refresh/);
assert.match(source, /scheduleRender\(\{ fromMutation: true \}\)/);
assert.doesNotMatch(source, /window\.setTimeout\(renderGoldBridge, 900\)/);
assert.doesNotMatch(source, /window\.setTimeout\(renderEnterprisePanels, 520\)/);
assert.doesNotMatch(source, /window\.setTimeout\(renderSettingsTools, 900\)/);
assert.match(source, /if \(goldRenderInFlight\) return goldRenderInFlight/);

console.log(JSON.stringify({ ok: true, runner: "gold_bridge_cache_test" }));
