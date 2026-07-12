import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("uses CORE_BASE_URL as a compatibility fallback for Universal Core", () => {
  const config = loadConfig({
    CORE_BASE_URL: "https://core.example.test/"
  });

  assert.equal(config.universalCoreUrl, "https://core.example.test");
});

test("maps CORE_MCP_KEY only to the configured ChatGPT tenant", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    MCP_PUBLIC_URL: "https://mcp.example.test",
    AUTH0_ISSUER: "https://tenant.auth0.com",
    AUTH0_AUDIENCE: "https://mcp.example.test/mcp",
    MCP_CHATGPT_TENANT_ID: "codexai",
    CORE_MCP_KEY: "chatgpt-key",
    UNIVERSAL_CORE_KEYS_JSON: JSON.stringify({ "owner-private": "owner-key" })
  });

  assert.deepEqual(config.universalCoreKeys, {
    "owner-private": "owner-key",
    codexai: "chatgpt-key"
  });
});

test("keeps an explicit tenant mapping over CORE_MCP_KEY", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    MCP_PUBLIC_URL: "https://mcp.example.test",
    AUTH0_ISSUER: "https://tenant.auth0.com",
    AUTH0_AUDIENCE: "https://mcp.example.test/mcp",
    MCP_CHATGPT_TENANT_ID: "codexai",
    CORE_MCP_KEY: "compatibility-key",
    UNIVERSAL_CORE_KEYS_JSON: JSON.stringify({ codexai: "explicit-key" })
  });

  assert.equal(config.universalCoreKeys.codexai, "explicit-key");
});
