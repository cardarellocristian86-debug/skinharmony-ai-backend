"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");

const routePatterns = [...serverSource.matchAll(/app\.(?:get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)]
  .map((match) => match[1])
  .filter((value) => value.startsWith("/api/"));

const activeAssets = [...indexSource.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
  .map((match) => match[1].split("?")[0])
  .filter((value) => value.startsWith("/assets/") && value.endsWith(".js"))
  .map((value) => path.join(root, "public", value));

const frontendFiles = [
  ...activeAssets,
  path.join(root, "public", "preview-shell", "operations.js"),
  path.join(root, "public", "preview-shell", "data-orchestration.js"),
  path.join(root, "public", "preview-shell", "api-server-bridge.js"),
  path.join(root, "public", "gold", "gold-api-bridge.js"),
  path.join(root, "public", "modules", "chat", "chat-api-bridge.js")
].filter((filePath, index, values) => fs.existsSync(filePath) && values.indexOf(filePath) === index);

function normalizeCall(value) {
  return value
    .replace(/\$\{pt.*$/, "")
    .split("?")[0]
    .replace(/\$\{[^}]*\}/g, ":dynamic")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}

function routeMatches(call, route) {
  const callParts = call.split("/").filter(Boolean);
  const routeParts = route.split("/").filter(Boolean);
  if (callParts.length !== routeParts.length) return false;
  return routeParts.every((part, index) => part.startsWith(":") || callParts[index] === part || callParts[index] === ":dynamic");
}

const calls = new Set();
for (const filePath of frontendFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  for (const match of source.matchAll(/["'`]((?:\/api\/)[^"'`\s]*)["'`]/g)) {
    const normalized = normalizeCall(match[1]);
    if (!normalized || normalized === "/api/catalog" || normalized === "/api/inventory") continue;
    calls.add(normalized);
  }
}

const missing = [...calls]
  .filter((call) => !routePatterns.some((route) => routeMatches(call, route)))
  .sort();

const serviceSource = fs.readFileSync(path.join(root, "src", "DesktopMirrorService.js"), "utf8");
const asyncServiceMethods = new Set(
  [...serviceSource.matchAll(/^  async ([A-Za-z_$][\w$]*)\(/gm)].map((match) => match[1])
);
const unawaitedAsyncCalls = [];
serverSource.split(/\n/).forEach((line, index) => {
  for (const match of line.matchAll(/service\.([A-Za-z_$][\w$]*)\(/g)) {
    if (asyncServiceMethods.has(match[1]) && !line.slice(0, match.index).includes("await ")) {
      unawaitedAsyncCalls.push(`${index + 1}:${match[1]}`);
    }
  }
});

assert.deepEqual(missing, [], `Frontend API calls without a registered backend route:\n${missing.join("\n")}`);
assert.deepEqual(unawaitedAsyncCalls, [], `Async service calls not awaited by HTTP routes:\n${unawaitedAsyncCalls.join("\n")}`);
assert(routePatterns.length >= 160, `Expected the complete Smart Desk route surface, found ${routePatterns.length}`);
assert(frontendFiles.length >= 6, `Expected active application and bridge assets, found ${frontendFiles.length}`);

console.log(JSON.stringify({
  ok: true,
  suite: "smartdesk_api_call_contract",
  registeredRoutes: routePatterns.length,
  frontendFiles: frontendFiles.map((filePath) => path.relative(root, filePath)),
  uniqueApiCalls: calls.size,
  unmatchedCalls: missing.length,
  unawaitedAsyncCalls: unawaitedAsyncCalls.length
}, null, 2));
