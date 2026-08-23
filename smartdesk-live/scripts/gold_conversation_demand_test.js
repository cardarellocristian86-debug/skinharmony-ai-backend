"use strict";

// Contract test for the browser bridges. It checks that normal navigation
// cannot spend AI/Core capacity; providers are only called after a real ask.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const assets = path.join(__dirname, "..", "public", "assets");
const bridge = fs.readFileSync(path.join(assets, "gold-bridge.js"), "utf8");
const chat = fs.readFileSync(path.join(assets, "nyra-gold-chat-layer.js"), "utf8");

assert.match(bridge, /const ROUTES = new Set\(\["\/", "\/dashboard"\]\)/);
assert.match(bridge, /const GOLD_OVERVIEW_TTL_MS = 2 \* 60 \* 1000/);
assert.match(bridge, /goldOverviewCache\.sessionKey === overviewSessionKey\(\)/);
const reader = bridge.slice(bridge.indexOf("async function fetchAiOverview"), bridge.indexOf("function installOverviewCompatibilityRead"));
assert.match(reader, /nativeFetch\("\/api\/ai-gold\/overview"/);
assert.doesNotMatch(reader, /\/api\/ai-gold\/(?:state|capabilities|decision-context)/);
assert.doesNotMatch(reader, /customer-intelligence/);
assert.match(bridge, /without adding an[\s\S]*artificial page-entry delay/);
assert.match(bridge, /installOverviewCompatibilityRead\(\)/);

const sendStart = chat.indexOf("function sendMessage(raw)");
const sendEnd = chat.indexOf("function loadSession()", sendStart);
const send = chat.slice(sendStart, sendEnd);
assert.match(send, /if \(isGreeting\(message\)\)[\s\S]*?return;/);
assert.match(send, /gold \? "\/api\/ai-gold\/ask" : "\/api\/assistant\/chat"/);
assert.match(chat, /if \(state\.session && !\(options && options\.force\)\)/);

console.log(JSON.stringify({ ok: true, runner: "gold_conversation_demand_test" }, null, 2));
