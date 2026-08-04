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
    galleryContext: {
      schema_version: "tenant_work_gallery_v1",
      tenant_id: "tenant-a",
      available: true,
      state: "ready",
      generated_at: "2026-07-30T12:00:00.000Z",
      work_count: 1,
      filters: { status: "active" },
      works: [{
        work_id: "11111111-1111-4111-8111-111111111111",
        project_id: "gallery",
        status: "active",
        current_version: 3,
        active_participants: 2,
        active_leases: 1,
        active_branches: 2,
      }],
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
  assert.equal(result.operational_surface, "tenant_work_gallery");
  assert.equal(result.gallery_version, "tenant_work_gallery_v1");
  assert.equal(result.tenant_work_gallery.available, true);
  assert.equal(result.tenant_work_gallery.tenant_isolated, true);
  assert.equal(result.tenant_work_gallery.work_count, 1);
  assert.equal(result.mandatory_sequence[0], "open_tenant_work_gallery");
  assert.equal(result.memory_first.revision, 9);
  assert.deepEqual(result.roles.map((role) => role.id), ROLE_CATALOG.map((role) => role.id));
  assert(result.task_graph.nodes.some((node) => node.id === "interpret_request" && node.dependencies.includes("recall_tenant_memory")));
  assert(result.task_graph.nodes.some((node) => node.id === "learn_from_verified_outcome"));
  assert.equal(result.task_graph.join_authority, "universal_core");
  assert.equal(result.governance.execution_allowed_by_preflight, false);
  assert.equal(result.protocol.fail_closed_when_preflight_unavailable, true);
  assert.equal(result.governed_learning.policy_activation_requires_verify, true);
  assert.equal(result.core_research.assessment.required, true);
  assert.equal(result.core_research.directive.issued_by, "universal_core");
  assert.equal(result.core_research.directive.authority.research_execution_authorized, false);
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

test("routes interactive web work to the governed Web Agent", () => {
  const result = fixture({
    requestText: "Apri una pagina dinamica, fai click sul form ed esegui JavaScript con screenshot",
    targetSystem: "web",
    operationType: "web_compatibility_execute",
    toolName: "web_compatibility_execute",
  });
  assert.equal(result.tool_routing.preferred_route.id, "web_compatibility_execute");
  assert.equal(result.tool_routing.preferred_route.status, "available");
  assert.equal(result.tool_routing.required_tool, "web_compatibility_execute");
  assert(result.tool_routing.prohibited_when_preferred_available.includes("unbounded_browser"));
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

test("keeps Deep V2 evaluation read-only while research and distillation remain Core-gated", () => {
  for (const operationType of [
    "nyra_v2_preview",
    "nyra_v2_requirements",
    "nyra_v2_evidence_prepare",
    "nyra_v2_evaluate",
  ]) {
    const result = fixture({
      requestText: "Valuta il ramo Deep V2 con evidenze governate",
      operationType,
      toolName: operationType,
    });
    assert.equal(result.state, "ready_read_only");
    assert.equal(result.memory_first.status, "recalled");
    assert.equal(result.governance.execution_allowed_by_preflight, true);
    assert.equal(result.core_research.directive.authority.research_execution_authorized, false);
    assert.equal(result.core_research.directive.authority.distillation_authorized, false);
    assert.equal(result.governed_learning.policy_activation_requires_verify, true);
  }
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

test("preflight emits no directive when supplied evidence is fresh and sufficient", () => {
  const result = fixture({
    requestText: "Riassumi il documento verificato",
    operationType: "advisory_work",
    evidenceState: { source_count: 2, confidence: 0.92, freshness_state: "fresh" },
  });
  assert.equal(result.core_research.assessment.required, false);
  assert.equal(result.core_research.directive, null);
  assert.equal(result.task_graph.nodes.find((node) => node.id === "research_and_plan").status, "not_required_by_core_evidence_gate");
});
