import assert from "node:assert/strict";
import test from "node:test";
import {
  createNyraAutopilotRuntime,
  nyraAutopilotCoreEvidence,
  NYRA_AUTOPILOT_ACTIVE_WORK_ADOPTION_LIMIT,
  NYRA_AUTOPILOT_SCHEMA_VERSION,
  validateNyraAutopilotBranchMaterialization,
  validateNyraAutopilotMaterialization,
} from "../src/nyra-autopilot-runtime.js";
import { NYRA_AUTOPILOT_TOOLS } from "../src/nyra-autopilot-tools.js";
import { digest } from "../src/work-continuity-runtime.js";

const ATOMIC_WORK_ID = "a7448d84-3113-4c4f-9ff6-0b0a436f19c9";

function atomicVerdict() {
  const bindingMaterial = {
    schema_version: "nyra_canonical_intent_binding_v1",
    intent_digest: "a".repeat(64), raw_text_digest: "b".repeat(64),
    operation_class: "EXTERNAL_MUTATION", work_requirement: "NEW",
    consequential_intent: true, ambiguity: false,
  };
  const material = {
    schema_version: "core_orchestration_verdict_v1", authority: "UNIVERSAL_CORE", verdict: "HOLD",
    reason_codes: ["new_work_identity_required"],
    canonical_intent_binding: { ...bindingMaterial, binding_digest: digest(bindingMaterial) },
    required_nyra_branches: [
      { id: "execution_planning", work_phase: "implementation", core_branch_bindings: ["workspace.write"] },
      { id: "quality_verification", work_phase: "verification", core_branch_bindings: ["test.read"] },
    ],
    denied_nyra_branches: [], required_roles: ["planner", "independent_verifier"],
    task_graph_digest: "c".repeat(64), maximum_parallel_assignments: 2,
    independent_verifier_required: true, nyra_materializes_branches: true, core_join_required: true,
    permitted_progress: ["ANALYSIS", "PLANNING", "EVIDENCE", "BOUNDED_WORKSPACE"],
    external_execution_authorized: false,
  };
  return { ...material, verdict_digest: digest(material) };
}

function atomicHarness({ failOnBranch = 0, failAssignment = false } = {}) {
  const committed = [];
  const verdict = atomicVerdict();
  let staged = [];
  let branchCount = 0;
  const client = {
    async query(sql) {
      const statement = String(sql).trim();
      if (statement === "BEGIN") { staged = []; return { rows: [] }; }
      if (statement === "COMMIT") { committed.push(...staged); staged = []; return { rows: [] }; }
      if (statement === "ROLLBACK") { staged = []; return { rows: [] }; }
      if (statement.includes("FROM core_nyra_autopilot_tenants")) return { rows: [{ status: "active", policy_version: "v1" }] };
      if (statement.includes("FROM core_continuity_works w JOIN core_continuity_intent_anchors")) return { rows: [{
        project_id: "skinharmony-ai-backend", idea: "Bound work", objective: "Implement and verify",
        current_version: 1,
        anchor: { canonical_intent_binding: {
          canonical_intent_digest: "a".repeat(64),
          core_orchestration_verdict_digest: verdict.verdict_digest,
          core_orchestration_verdict: verdict,
        } },
        intent_digest: "a".repeat(64),
      }] };
      if (statement.includes("SELECT tenant_id,work_id,run_id")) return { rows: [] };
      if (statement.includes("SELECT status FROM core_nyra_autopilot_runs")) return { rows: [{ status: "pending" }] };
      if (statement.includes("INSERT INTO core_continuity_branches")) {
        branchCount += 1;
        if (failOnBranch === branchCount) throw new Error("injected_branch_failure");
        const branchKey = branchCount === 1 ? "execution_planning" : "quality_verification";
        staged.push(`branch:${branchKey}`);
        return { rows: [{ branch_id: `${branchCount}`.repeat(8) + "-1111-4111-8111-111111111111", branch_key: branchKey, status: "active" }] };
      }
      if (statement.includes("INSERT INTO core_nyra_autopilot_assignments")) {
        if (failAssignment) throw new Error("injected_assignment_failure");
        staged.push("assignment");
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    query: async (sql) => String(sql).includes("FROM core_nyra_autopilot_tenants")
      ? ({ rows: [{ status: "active", policy_version: "v1" }] })
      : ({ rows: [] }),
    connect: async () => client,
    end() {},
  };
  const teamRuntime = {
    schemaSql: "",
    async materializeForWorkInTransaction(receivedClient, _identity, input) {
      assert.equal(receivedClient, client);
      staged.push("team");
      return { instances: input.blueprint_ids.map((blueprint_id, index) => ({
        blueprint_id, agent_instance_id: `agent-${index}`,
      })) };
    },
  };
  return { pool, teamRuntime, committed };
}

test("Nyra Autopilot persists tenant and Work scoped plans, assignments and append-only receipts", () => {
  const runtime = createNyraAutopilotRuntime({}, {
    pool: { query: async () => ({ rows: [] }), end() {} },
    teamRuntime: { schemaSql: "", status: async () => ({ package: { enabled: false } }), enable: async () => ({}), materializeForWork: async () => ({}) },
  });
  assert.ok(runtime);
  assert.equal(typeof runtime.reconcile, "function");
  assert.equal(typeof runtime.claim, "function");
  assert.equal(typeof runtime.submit, "function");
  assert.match(runtime.schemaSql, /core_nyra_autopilot_tenants/);
  assert.match(runtime.schemaSql, /core_nyra_autopilot_runs/);
  assert.match(runtime.schemaSql, /core_nyra_autopilot_assignments/);
  assert.match(runtime.schemaSql, /core_nyra_autopilot_receipts_append_only/);
  assert.match(runtime.schemaSql, /FOREIGN KEY \(tenant_id, work_id\) REFERENCES core_continuity_works/);
  assert.equal(NYRA_AUTOPILOT_SCHEMA_VERSION, "nyra_work_autopilot_v1");
});

test("a rejected verification atomically reoffers every assignment and replays the same remediation run", async () => {
  const workId = "11111111-1111-4111-8111-111111111111";
  const parentRunId = "22222222-2222-4222-8222-222222222222";
  const rejectionDigest = "e".repeat(64);
  const prior = [
    { assignment_key: "planner", agent_instance_id: "33333333-3333-4333-8333-333333333333",
      blueprint_id: "planner", role: "planner", task_contract: { plan_digest: "a".repeat(64) },
      dependencies: [], eligible_client_types: ["codex"] },
    { assignment_key: "independent_verifier", agent_instance_id: "44444444-4444-4444-8444-444444444444",
      blueprint_id: "independent_verifier", role: "independent_verifier",
      task_contract: { plan_digest: "a".repeat(64) }, dependencies: ["planner"],
      eligible_client_types: ["chatgpt", "codex"] },
  ];
  let parentStatus = "materialized";
  let child = null;
  const reopened = [];
  const client = { async query(sql, parameters = []) {
    const statement = String(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(statement.trim()) || statement.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (statement.includes("SELECT project_id,architecture_version,intent_digest,plan,status")) return { rows: [{
      project_id: "skinharmony-ai-backend", architecture_version: 1, intent_digest: "b".repeat(64),
      plan: { schema_version: "nyra_autopilot_plan_v1" }, status: parentStatus,
    }] };
    if (statement.includes("plan->'remediation'->>'parent_run_id'")) return { rows: child ? [child] : [] };
    if (statement.includes("INSERT INTO core_nyra_autopilot_runs")) {
      child = { run_id: parameters[2], plan_digest: parameters[7], status: "materialized" };
      return { rows: [] };
    }
    if (statement.includes("SELECT assignment_key,agent_instance_id")) return { rows: prior };
    if (statement.includes("INSERT INTO core_nyra_autopilot_assignments")) {
      reopened.push({ assignment_id: parameters[3], assignment_key: parameters[4], role: parameters[7],
        task_contract: JSON.parse(parameters[8]), dependencies: JSON.parse(parameters[9]),
        eligible_client_types: JSON.parse(parameters[10]), status: "offered" });
      return { rows: [] };
    }
    if (statement.includes("UPDATE core_nyra_autopilot_runs SET status='completed'")) {
      parentStatus = "completed";
      return { rows: [] };
    }
    if (statement.includes("SELECT sequence_number,receipt_hash")) return { rows: [] };
    if (statement.includes("INSERT INTO core_nyra_autopilot_receipts")) return { rows: [] };
    if (statement.includes("SELECT * FROM core_nyra_autopilot_assignments")) return { rows: reopened };
    return { rows: [] };
  }, release() {} };
  const pool = { query: async () => ({ rows: [] }), connect: async () => client, end() {} };
  const runtime = createNyraAutopilotRuntime({}, { pool, teamRuntime: { schemaSql: "" } });
  const identity = { tenantId: "codexai", subject: "coordinator" };
  const input = { work_id: workId, run_id: parentRunId, evidence_digest: rejectionDigest };
  const first = await runtime.remediateRejectedVerification(identity, input);
  assert.equal(first.idempotent_replay, false);
  assert.equal(first.assignments.length, 2);
  assert.deepEqual(first.assignments.map((item) => item.status), ["offered", "offered"]);
  assert.deepEqual(first.assignments[1].dependencies, ["planner"]);
  assert.notEqual(first.assignments[0].task_contract.plan_digest, "a".repeat(64));
  assert.equal(first.assignments[1].task_contract.remediation.rejection_evidence_digest, rejectionDigest);
  const replay = await runtime.remediateRejectedVerification(identity, input);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.run_id, first.run_id);
  assert.equal(reopened.length, 2);
});

test("Nyra Autopilot MCP surface has one owner activation and bounded claim/submit", () => {
  const tools = Object.fromEntries(NYRA_AUTOPILOT_TOOLS.map((item) => [item.name, item]));
  assert.deepEqual(Object.keys(tools).sort(), [
    "nyra_autopilot_enable", "nyra_autopilot_reconcile", "nyra_autopilot_status", "nyra_autopilot_work_read",
    "nyra_work_assignment_claim", "nyra_work_assignment_inbox", "nyra_work_assignment_submit",
  ]);
  assert.equal(tools.nyra_autopilot_enable._meta["skinharmony/ownerConfirmationRequired"], true);
  assert.equal(tools.nyra_autopilot_reconcile._meta["skinharmony/ownerConfirmationRequired"], true);
  for (const name of ["nyra_work_assignment_claim", "nyra_work_assignment_submit"]) {
    assert.equal(tools[name]._meta["skinharmony/ownerConfirmationRequired"], false);
    assert.equal(tools[name]._meta["skinharmony/tenantBoundedCollaboration"], true);
  }
});

test("Nyra Autopilot activation adopts already active Work without granting execution", async () => {
  const adopted = [];
  const pool = {
    query: async (sql) => {
      if (sql.includes("FROM core_nyra_autopilot_tenants")) return { rows: [] };
      if (sql.includes("SELECT work_id,project_id FROM core_continuity_works")) {
        return { rows: [{ work_id: "a7448d84-3113-4c4f-9ff6-0b0a436f19c9", project_id: "skinharmony-ai-backend" }] };
      }
      return { rows: [] };
    },
    end() {},
  };
  const runtime = createNyraAutopilotRuntime({}, {
    pool,
    teamRuntime: {
      schemaSql: "",
      status: async () => ({ package: { enabled: true } }),
      materializeForWork: async () => ({}),
    },
  });
  runtime.reconcile = async (_identity, input) => {
    adopted.push(input);
    return { status: "materialized", run_id: "adoption-run" };
  };
  const result = await runtime.enable({ tenantId: "codexai", subject: "owner" }, { idempotency_key: "enable-autopilot-adoption" });
  assert.equal(NYRA_AUTOPILOT_ACTIVE_WORK_ADOPTION_LIMIT, 100);
  assert.deepEqual(adopted, [{
    work_id: "a7448d84-3113-4c4f-9ff6-0b0a436f19c9",
    project_id: "skinharmony-ai-backend",
    trigger_type: "reconcile",
  }]);
  assert.deepEqual(result.active_work_adoption, {
    attempted: 1,
    limit: 100,
    results: [{
      work_id: "a7448d84-3113-4c4f-9ff6-0b0a436f19c9",
      project_id: "skinharmony-ai-backend",
      status: "materialized",
      run_id: "adoption-run",
    }],
    execution_authorized: false,
  });
});

test("Autopilot materialization requires the exact Core role set without missing, extra or duplicate instances", () => {
  const plan = {
    required_roles: [{ blueprint_id: "planner" }, { blueprint_id: "independent_verifier" }],
  };
  const exact = {
    instances: [
      { blueprint_id: "independent_verifier", agent_instance_id: "verifier" },
      { blueprint_id: "planner", agent_instance_id: "planner" },
    ],
  };
  assert.equal(validateNyraAutopilotMaterialization(plan, exact).size, 2);
  for (const instances of [
    exact.instances.slice(0, 1),
    [...exact.instances, { blueprint_id: "researcher", agent_instance_id: "extra" }],
    [exact.instances[0], exact.instances[0]],
  ]) {
    assert.throws(() => validateNyraAutopilotMaterialization(plan, { instances }),
      /nyra_autopilot_materialization_set_mismatch/);
  }
});

test("Autopilot persists exactly the Nyra branches selected by Core", () => {
  const plan = {
    required_nyra_branches: [
      { id: "execution_planning" },
      { id: "quality_verification" },
    ],
  };
  const exact = [
    { branch_id: "11111111-1111-4111-8111-111111111111", branch_key: "quality_verification", status: "active" },
    { branch_id: "22222222-2222-4222-8222-222222222222", branch_key: "execution_planning", status: "active" },
  ];
  assert.equal(validateNyraAutopilotBranchMaterialization(plan, exact).length, 2);
  for (const materialized of [
    exact.slice(0, 1),
    [...exact, { branch_id: "33333333-3333-4333-8333-333333333333", branch_key: "risk_governance", status: "active" }],
    [{ ...exact[0], status: "closed" }, exact[1]],
  ]) {
    assert.throws(() => validateNyraAutopilotBranchMaterialization(plan, materialized),
      /nyra_autopilot_branch_materialization_set_mismatch/);
  }
});

test("Autopilot task and receipt evidence preserve Core verdict, canonical binding and exact branches", () => {
  const branches = [{
    id: "quality_verification",
    work_phase: "verification",
    core_branch_bindings: ["test.read"],
  }];
  const evidence = nyraAutopilotCoreEvidence({
    core_orchestration: {
      verdict_digest: "a".repeat(64),
      canonical_intent_digest: "c".repeat(64),
      canonical_intent_binding_digest: "b".repeat(64),
    },
    required_nyra_branches: branches,
  });
  assert.deepEqual(evidence, {
    core_orchestration_verdict_digest: "a".repeat(64),
    canonical_intent_digest: "c".repeat(64),
    canonical_intent_binding_digest: "b".repeat(64),
    required_nyra_branches: branches,
  });
  branches[0].id = "tampered";
  assert.equal(evidence.required_nyra_branches[0].id, "quality_verification");
});

for (const [name, failure] of [
  ["during the second branch materialization", { failOnBranch: 2 }],
  ["after team materialization", { failAssignment: true }],
]) {
  test(`Autopilot rolls back branches, team and assignments ${name}`, async () => {
    const harness = atomicHarness(failure);
    const runtime = createNyraAutopilotRuntime({}, {
      pool: harness.pool,
      teamRuntime: harness.teamRuntime,
    });
    const result = await runtime.reconcile({ tenantId: "codexai", subject: "owner" }, {
      work_id: ATOMIC_WORK_ID,
      project_id: "skinharmony-ai-backend",
      trigger_type: "work_created",
      core_orchestration_verdict: atomicVerdict(),
    });
    assert.equal(result.status, "deferred");
    assert.equal(harness.committed.some((entry) => /^(branch:|team|assignment)/.test(entry)), false);
  });
}
