import assert from "node:assert/strict";
import test from "node:test";

import {
  capabilityAccessContext,
  capabilityAvailableForIdentity,
  capabilityExposureRegistryValidation,
  candidateLooksVertical,
} from "../src/capability-exposure.js";
import { TOOLS } from "../src/tool-definitions.js";

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
  const allScopes = [...new Set(TOOLS.flatMap((tool) => tool.scopes || []))];
  const analyzer = {
    kind: "service",
    serverClientType: "analyzer",
    tenantId: "tenant-a",
    scopes: allScopes,
  };
  const analyzerVisible = TOOLS
    .filter((tool) => capabilityAvailableForIdentity(tool, analyzer))
    .map((tool) => tool.name)
    .sort();
  assert.deepEqual(analyzerVisible, ["scalp_analyzer", "skin_analyzer"]);

  const suite = { ...analyzer, serverClientType: "suite" };
  const suiteVisible = TOOLS
    .filter((tool) => capabilityAvailableForIdentity(tool, suite))
    .map((tool) => tool.name)
    .sort();
  assert.deepEqual(suiteVisible, [
    "suite_branch_catalog",
    "suite_branch_read",
    "suite_cockpit_360",
    "suite_decision_preview",
    "suite_runbook_catalog",
    "suite_runbook_preview",
    "suite_status",
  ]);
});

test("semantic candidates with vertical identifiers are recognized fail-closed", () => {
  assert.equal(candidateLooksVertical({ id: "skin_analyzer" }), true);
  assert.equal(candidateLooksVertical({ branch_id: "smartdesk_operations_guard" }), true);
  assert.equal(candidateLooksVertical({ id: "ai_eval_scorecard_read" }), false);
});

test("the current connector capability registry is exhaustively classified", () => {
  assert.deepEqual(capabilityExposureRegistryValidation(TOOLS), {
    ok: true,
    classified_count: 128,
    capability_count: 128,
    duplicate_ids: [],
    incomplete_ids: [],
  });
});

test("unknown capability and unbound client identity fail closed", () => {
  assert.equal(
    capabilityAvailableForIdentity(readTool("mystery_capability"), {
      tenantId: "tenant-a",
      scopes: ["core:read"],
    }),
    false,
  );
  assert.equal(
    capabilityAvailableForIdentity(readTool("ai_eval_scorecard_read"), {
      tenantId: "tenant-a",
      scopes: ["core:read"],
    }),
    false,
  );
});
