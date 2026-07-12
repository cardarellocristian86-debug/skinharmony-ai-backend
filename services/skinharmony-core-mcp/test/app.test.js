import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

const config = {
  publicUrl: "https://mcp.example.test",
  resource: "https://mcp.example.test/mcp",
  auth0Issuer: "https://tenant.auth0.com",
  auth0Audience: "https://core",
  jwksUri: "https://tenant.auth0.com/.well-known/jwks.json",
  codexKeys: ["codex-key"],
  codexScopes: ["core:read", "core:govern"],
  supportedScopes: ["core:read", "core:govern"]
};

async function serve(run) {
  const app = createApp(config, { handlers: { core_health: async () => ({ content: [{ type: "text", text: "ok" }] }) } });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("publishes protected-resource and PKCE S256 metadata", async () => serve(async (base) => {
  const health = await fetch(`${base}/healthz`).then((r) => r.json());
  assert.equal(health.ok, true);
  const resource = await fetch(`${base}/.well-known/oauth-protected-resource`).then((r) => r.json());
  assert.equal(resource.resource, config.resource);
  assert.deepEqual(resource.authorization_servers, [config.auth0Issuer]);
  const pathResource = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`).then((r) => r.json());
  assert.deepEqual(pathResource, resource);
  const oauth = await fetch(`${base}/.well-known/oauth-authorization-server`).then((r) => r.json());
  assert.deepEqual(oauth.code_challenge_methods_supported, ["S256"]);
}));

test("returns RFC 9728 challenge when bearer is absent", async () => serve(async (base) => {
  const response = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate"), /oauth-protected-resource/);
}));

test("keeps Codex bearer compatibility and exposes MCP security schemes", async () => serve(async (base) => {
  const response = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer codex-key", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert(body.result.tools.every((tool) => tool._meta.securitySchemes.some((scheme) => scheme.type === "oauth2")));
  assert(body.result.tools.every((tool) => tool.securitySchemes.every((scheme) => scheme.type === "oauth2")));
  assert(body.result.tools.every((tool) => tool.annotations.readOnlyHint === true));
  const gate = body.result.tools.find((tool) => tool.name === "core_gate_action");
  assert.deepEqual(gate.securitySchemes.find((scheme) => scheme.type === "oauth2").scopes, ["core:govern"]);
  assert.deepEqual(gate._meta.securitySchemes, gate.securitySchemes);
}));
