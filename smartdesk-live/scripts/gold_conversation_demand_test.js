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
assert.match(bridge, /const GOLD_OVERVIEW_CACHE_TTL_MS = 120000/);
assert.match(bridge, /tenant && center && subject \? `\$\{tenant\}:\$\{center\}:\$\{subject\}` : ""/);
const reader = bridge.slice(bridge.indexOf("async function readGoldOverview"), bridge.indexOf("async function renderGoldBridge"));
assert.match(reader, /fetchJson\("\/api\/ai-gold\/capabilities"\)[\s\S]*fetchJson\("\/api\/ai-gold\/decision-context"\)/);
assert.doesNotMatch(reader, /customer-intelligence/);
assert.match(bridge, /One debounced render replaces the historical 180ms \+ 900ms duplicate/);

const sendStart = chat.indexOf("function sendMessage(raw)");
const sendEnd = chat.indexOf("function loadSession()", sendStart);
const send = chat.slice(sendStart, sendEnd);
assert.match(send, /if \(isGreeting\(message\)\)[\s\S]*?return;/);
assert.match(send, /gold \? "\/api\/ai-gold\/ask" : "\/api\/assistant\/chat"/);
assert.match(chat, /if \(state\.session && !\(options && options\.force\)\)/);

console.log(JSON.stringify({ ok: true, runner: "gold_conversation_demand_test" }, null, 2));
