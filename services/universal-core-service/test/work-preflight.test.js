import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkPreflight, ROLE_CATALOG } from "../src/workPreflight.js";
import { routeNyraBranches } from "../src/nyraBranchNetwork.js";

function fixture(overrides = {}) {
  return buildWorkPreflight({
    tenantId: "tenant-a",
    requestText: "Pubblica le modifiche nel repository GitHub e poi prepara il deploy",
    targetSystem: "github",
    operationType: "repository_release",
    availableCapabilities: ["github_connected_app"],
    memoryContext: {
      tenant_id: "tenant-a",
      revision: 9,
      latest_checkpoint: { id: "checkpoint-1" },
      relevant_memories: [{ id: "memory-1" }],
      pending_handoffs: [{ id: "handoff-1" }],
    },
    branchContext: {
      selected_branches: [
        "work_intake_intelligence",
        "research_evidence_intelligence",
        "planning_priority_intelligence",
        "execution_coordination_intelligence",
        "quality_verification_intelligence",
        "adaptive_learning_intelligence",
      ],
      denied_branches: [],
      selected_groups: ["work_cortex"],
    },
    nyraNetwork: routeNyraBranches({
      text: "GitHub deploy test learn",
      requestedBranches: ["work_intake", "parallel_coordination", "quality_verification", "adaptive_learning"],
      domainPackId: "generic",
    }),
    domainPack: { id: "generic", version: "1.0.0", domain: "horizontal" },
    ...overrides,
  });
}

test("builds a mandatory memory-first role and task contract", () => {
  const result = fixture();
  assert.equal(result.mandatory, true);
  assert.equal(result.memory_first.status, "recalled");
  assert.equal(result.memory_first.revision, 9);
  assert.deepEqual(result.roles.map((role) => role.id), ROLE_CATALOG.map((role) => role.id));
  assert(result.task_graph.nodes.some((node) => node.id === "interpret_request" && node.dependencies.includes("recall_tenant_memory")));
  assert(result.task_graph.nodes.some((node) => node.id === "learn_from_verified_outcome"));
  assert.equal(result.task_graph.join_authority, "universal_core");
  assert.equal(result.governance.execution_allowed_by_preflight, false);
  assert.equal(result.protocol.fail_closed_when_preflight_unavailable, true);
  assert.equal(result.governed_learning.policy_activation_requires_verify, true);
});

test("routes GitHub to the connected app and prevents the previous CLI error", () => {
  const result = fixture();
  assert.equal(result.tool_routing.preferred_route.id, "github_connected_app");
  assert.equal(result.tool_routing.preferred_route.status, "available");
  assert(result.tool_routing.prohibited_when_preferred_available.includes("github_cli"));
  assert(result.tool_routing.fallback.allowed_only_if.includes("github_connected_app_unavailable"));
  assert.equal(result.tool_routing.release_policy.merge_requires_core_verdict, "ALLOW");
  assert.equal(result.tool_routing.release_policy.merge_requires_owner_confirmation, true);
  assert.equal(result.tool_routing.release_policy.deploy_requires_owner_confirmation, true);
});

test("fails closed when the tenant memory provider has not supplied context", () => {
  const result = fixture({ memoryContext: null, requestText: "Analizza il lavoro" });
  assert.equal(result.state, "memory_recall_required");
  assert.equal(result.memory_first.status, "required_from_tenant_memory_provider");
  assert.equal(result.task_graph.nodes.find((node) => node.id === "interpret_request").status, "blocked_by_memory_recall");
  assert.equal(result.governance.execution_allowed_by_preflight, false);
});

test("redacts secrets from the preflight request summary", () => {
  const result = fixture({ requestText: "Use GitHub token=super-secret-value password=hunter2" });
  assert(!JSON.stringify(result).includes("super-secret-value"));
  assert(!JSON.stringify(result).includes("hunter2"));
});

test("marks tenant-scoped reads ready without a redundant confirmation gate", () => {
  const result = fixture({
    requestText: "reports/core-nyra/status.md",
    operationType: "workspace_read_document",
    toolName: "workspace_read_document",
  });
  assert.equal(result.state, "ready_read_only");
  assert.equal(result.governance.core_verdict_required_before_execution, false);
  assert.equal(result.governance.owner_confirmation_required, false);
  assert.equal(result.governance.execution_allowed_by_preflight, true);
  assert.equal(result.task_graph.nodes.find((node) => node.id === "execute_approved_scope").status, "ready_read_only");
});

test("tracks explicit owner confirmation while keeping a write Core-gated", () => {
  const result = fixture({
    requestText: "Write shared document reports/core-nyra/status.md",
    operationType: "workspace_write_document",
    toolName: "workspace_write_document",
    ownerConfirmed: true,
  });
  assert.equal(result.state, "routed_owner_confirmed_waiting_for_core_verdict");
  assert.equal(result.governance.core_verdict_required_before_execution, true);
  assert.equal(result.governance.owner_confirmation_required, false);
  assert.equal(result.governance.owner_confirmation_satisfied, true);
  assert.equal(result.governance.execution_allowed_by_preflight, false);
});
