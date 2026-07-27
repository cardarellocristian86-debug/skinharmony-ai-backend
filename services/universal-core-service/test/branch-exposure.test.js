import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  branchAvailableForContext,
  branchExposureValidation,
  deriveBranchAccessContext,
  filterBranchGroups,
  filterBranchPackages,
  filterBranchRegistry,
  filterBranchTaxonomy,
  filterSemanticBranchCandidates,
} from "../src/branchExposure.js";

const horizontal = Object.freeze({
  label: "Horizontal",
  exposure_class: "chatgpt_horizontal",
  allowed_client_types: ["chatgpt", "codex", "admin"],
  allowed_audiences: ["chatgpt_connector", "codex_internal", "admin_control_room"],
  required_entitlements: [],
  discoverable_in_connector: true,
  semantic_select_allowed: true,
});
const vertical = Object.freeze({
  label: "Vertical",
  exposure_class: "software_adjacent",
  allowed_client_types: ["analyzer", "tricocamera", "admin"],
  allowed_audiences: ["analyzer_runtime", "admin_control_room"],
  required_entitlements: ["branch:vertical"],
  discoverable_in_connector: true,
  semantic_select_allowed: true,
});
const registry = Object.freeze({
  horizontal,
  vertical,
  incomplete: { label: "Incomplete", exposure_class: "chatgpt_horizontal" },
});
const chatgpt = Object.freeze({
  client_type: "chatgpt",
  audience: "chatgpt_connector",
  entitlements: [],
});
const analyzer = Object.freeze({
  client_type: "analyzer",
  audience: "analyzer_runtime",
  entitlements: ["branch:vertical"],
});

test("exposure metadata is complete and fail-closed", () => {
  assert.equal(branchExposureValidation(horizontal).ok, true);
  assert.equal(branchExposureValidation(registry.incomplete).ok, false);
  assert.equal(branchAvailableForContext(registry.incomplete, chatgpt), false);
});

test("ChatGPT cannot discover or select vertical branches, including by forced id", () => {
  assert.deepEqual(Object.keys(filterBranchRegistry(registry, chatgpt)), ["horizontal"]);
  assert.deepEqual(
    filterSemanticBranchCandidates(
      [
        { id: "horizontal", text: "Horizontal" },
        { id: "vertical", text: "Vertical" },
        { id: "generic", text: "Generic text" },
      ],
      registry,
      chatgpt,
    ).map((item) => item.id),
    ["horizontal", "generic"],
  );
});

test("software-adjacent clients see only entitled vertical branches", () => {
  assert.deepEqual(Object.keys(filterBranchRegistry(registry, analyzer)), ["vertical"]);
  assert.equal(
    branchAvailableForContext(vertical, { ...analyzer, entitlements: [] }),
    false,
  );
  assert.equal(
    branchAvailableForContext(vertical, { ...analyzer, audience: "chatgpt_connector" }),
    false,
  );
});

test("admin control room has complete visibility without turning ChatGPT owner_root into admin", () => {
  const admin = {
    client_type: "admin",
    audience: "admin_control_room",
    entitlements: [],
  };
  assert.deepEqual(Object.keys(filterBranchRegistry(registry, admin)), ["horizontal", "vertical"]);
  assert.equal(
    branchAvailableForContext(vertical, {
      client_type: "chatgpt",
      audience: "chatgpt_connector",
      entitlements: ["branch:vertical", "owner:root"],
      role: "owner_root",
    }),
    false,
  );
});

test("Agentic Efficiency remains horizontal while its budget guard stays internal", () => {
  const agenticRegistry = {
    agentic_efficiency_intelligence: {
      ...horizontal,
      label: "Agentic Efficiency Intelligence",
    },
    agentic_budget_governance_guard: {
      label: "Agentic Budget Governance Guard",
      exposure_class: "codex_internal",
      allowed_client_types: ["codex", "admin"],
      allowed_audiences: ["codex_internal", "admin_control_room"],
      required_entitlements: [],
      discoverable_in_connector: true,
      semantic_select_allowed: true,
    },
  };
  assert.deepEqual(Object.keys(filterBranchRegistry(agenticRegistry, chatgpt)), [
    "agentic_efficiency_intelligence",
  ]);
  assert.deepEqual(Object.keys(filterBranchRegistry(agenticRegistry, {
    client_type: "chatgpt",
    audience: "chatgpt_connector",
    entitlements: ["owner:root"],
    role: "owner_root",
  })), ["agentic_efficiency_intelligence"]);
  assert.deepEqual(Object.keys(filterBranchRegistry(agenticRegistry, {
    client_type: "codex",
    audience: "codex_internal",
    entitlements: [],
  })), ["agentic_efficiency_intelligence", "agentic_budget_governance_guard"]);
});

test("signed client context is tenant-bound and tampering falls back closed", () => {
  const secret = "test-client-context-secret-1234567890";
  const context = {
    version: "mcp_client_context_v1",
    tenant_id: "tenant-a",
    client_type: "chatgpt",
    audience: "chatgpt_connector",
    entitlements: ["core:read"],
    role: "owner_root",
    issued_at: new Date().toISOString(),
  };
  const canonical = JSON.stringify({ ...context, entitlements: [...context.entitlements].sort() });
  const assertion = `mcc_${crypto.createHmac("sha256", secret)
    .update(`mcp-client-context\u0000${canonical}`)
    .digest("hex")}`;
  const header = Buffer.from(JSON.stringify({ ...context, assertion })).toString("base64url");
  const keyRecord = {
    tenant_id: "tenant-b",
    preset: "nyra_core_360_connector",
    allowed_scopes: ["read:decision"],
    metadata: {},
  };
  const access = deriveBranchAccessContext({
    tenantId: "tenant-b",
    get: () => header,
  }, keyRecord, secret);
  assert.equal(access.client_type, "api_agent");
  assert.equal(access.audience, "api_agent");
  assert.equal(access.source, "server_key_fail_closed_default");
});

test("groups, packages and taxonomy never leak hidden branch labels", () => {
  const visible = ["horizontal"];
  const groups = filterBranchGroups({
    mixed: { label: "Mixed", branches: ["horizontal", "vertical"] },
    vertical_only: { label: "Vertical only", branches: ["vertical"] },
  }, visible);
  assert.deepEqual(groups, { mixed: { label: "Mixed", branches: ["horizontal"] } });
  assert.deepEqual(filterBranchPackages({ all: ["horizontal", "vertical"] }, visible), {
    all: ["horizontal"],
  });

  const taxonomy = filterBranchTaxonomy({
    nodes: [
      { node_id: "root", parent_id: null, branch_bindings: [] },
      { node_id: "horizontal_domain", parent_id: "root", branch_bindings: [] },
      { node_id: "horizontal__branch", parent_id: "horizontal_domain", branch_bindings: ["horizontal"] },
      { node_id: "vertical_domain", parent_id: "root", branch_bindings: [] },
      { node_id: "vertical__branch", parent_id: "vertical_domain", branch_bindings: ["vertical"] },
    ],
    synapses: [{
      from_node_id: "horizontal__branch",
      to_node_id: "vertical__branch",
      shared_branch_ids: ["horizontal", "vertical"],
    }],
  }, visible);
  assert.deepEqual(
    taxonomy.nodes.map((node) => node.node_id),
    ["root", "horizontal_domain", "horizontal__branch"],
  );
  assert.equal(taxonomy.synapses.length, 0);
});
