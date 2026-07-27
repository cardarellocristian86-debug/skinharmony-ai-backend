import assert from "node:assert/strict";
import test from "node:test";

import {
  capabilityAccessContext,
  capabilityAvailableForIdentity,
  candidateLooksVertical,
} from "../src/capability-exposure.js";

const readTool = (name) => ({
  name,
  scopes: ["core:read"],
  annotations: { readOnlyHint: true },
});

test("OAuth owner_root remains a ChatGPT client and cannot see vertical capabilities", () => {
  const identity = {
    kind: "oauth",
    role: "owner_root",
    godMode: true,
    tenantId: "codexai",
    scopes: ["core:read", "owner:root"],
    serverClientType: "admin",
  };
  assert.deepEqual(capabilityAccessContext(identity), {
    tenant_id: "codexai",
    client_type: "chatgpt",
    audience: "chatgpt_connector",
    entitlements: ["core:read", "owner:root"],
    role: "owner_root",
    source: "authenticated_mcp_identity",
  });
  assert.equal(capabilityAvailableForIdentity(readTool("skin_analyzer"), identity), false);
  assert.equal(capabilityAvailableForIdentity(readTool("suite_status"), identity), false);
  assert.equal(capabilityAvailableForIdentity(readTool("ai_eval_scorecard_read"), identity), true);
});

test("server-bound adjacent identity sees only its vertical surface", () => {
  const analyzer = {
    kind: "service",
    serverClientType: "analyzer",
    tenantId: "tenant-a",
    scopes: ["core:read"],
  };
  assert.equal(capabilityAvailableForIdentity(readTool("skin_analyzer"), analyzer), true);
  assert.equal(capabilityAvailableForIdentity(readTool("scalp_analyzer"), analyzer), true);
  assert.equal(capabilityAvailableForIdentity(readTool("suite_status"), analyzer), false);
});

test("semantic candidates with vertical identifiers are recognized fail-closed", () => {
  assert.equal(candidateLooksVertical({ id: "skin_analyzer" }), true);
  assert.equal(candidateLooksVertical({ branch_id: "smartdesk_operations_guard" }), true);
  assert.equal(candidateLooksVertical({ id: "ai_eval_scorecard_read" }), false);
});
