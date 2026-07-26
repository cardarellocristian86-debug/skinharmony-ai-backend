import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRelationalSupervisionContract,
  createRelationalOrchestrationSupervisor,
} from "../src/relationalOrchestrationSupervisor.js";
import { governedAgentCatalog, createGovernedAgentRegistry } from "../src/governedAgentRegistry.js";

const fixture = {
  tenant_id: "tenant-a",
  objective: "Coordinate bounded research and synthesis",
  actors: [
    { actor_id: "core", role: "core", capabilities: ["verdict"] },
    { actor_id: "relations", role: "relational_supervisor", capabilities: ["reconcile"] },
    { actor_id: "nyra", role: "nyra", capabilities: ["interpret"] },
    { actor_id: "scout", role: "agent", capabilities: ["research"] },
  ],
  relations: [
    { from: "core", to: "relations", type: "governs" },
    { from: "relations", to: "nyra", type: "coordinates" },
    { from: "nyra", to: "scout", type: "delegates" },
  ],
};

test("relational supervision is deterministic, advisory and preserves Core authority", () => {
  const first = buildRelationalSupervisionContract(fixture);
  const second = buildRelationalSupervisionContract(fixture);
  assert.deepEqual(second, first);
  const reordered = buildRelationalSupervisionContract({
    ...fixture,
    actors: [...fixture.actors].reverse(),
    relations: [...fixture.relations].reverse(),
  });
  assert.equal(reordered.supervision_id, first.supervision_id);
  assert.match(first.supervision_id, /^ros_/);
  assert.equal(first.hierarchy.decision_authority, "universal_core");
  assert.equal(first.guarantees.execution_authorized, false);
  assert.equal(first.guarantees.model_invocation, false);
  assert.equal(first.guarantees.external_actions, false);
});

test("relational supervision rejects authority inversions and isolates tenants", () => {
  assert.throws(() => buildRelationalSupervisionContract({
    ...fixture,
    relations: [
      { from: "nyra", to: "core", type: "governs" },
      { from: "relations", to: "nyra", type: "coordinates" },
    ],
  }), /core_authority_inversion_denied/);
  assert.throws(() => buildRelationalSupervisionContract({
    ...fixture,
    actors: fixture.actors.filter((actor) => actor.role !== "nyra"),
    relations: fixture.relations.filter((relation) => relation.from !== "nyra" && relation.to !== "nyra"),
  }), /single_nyra_required/);

  const supervisor = createRelationalOrchestrationSupervisor();
  const created = supervisor.create(fixture);
  assert.equal(supervisor.create(fixture).reused, true);
  assert.throws(
    () => supervisor.get({ tenant_id: "tenant-b", supervision_id: created.supervision_id }),
    /cross_tenant_relational_supervision_denied/,
  );
});

test("governed registry exposes relational supervisor separately from Nyra", () => {
  const catalog = governedAgentCatalog();
  const relational = catalog.find((agent) => agent.agent_id === "relational-supervisor");
  const nyra = catalog.find((agent) => agent.agent_id === "nyra-supervisor");
  assert.equal(relational.role, "relational_supervisor");
  assert.equal(relational.model_execution, "forbidden");
  assert.equal(relational.external_actions, "forbidden");
  assert.notDeepEqual(relational.allowed_capabilities, nyra.allowed_capabilities);

  const registry = createGovernedAgentRegistry({ idFactory: () => "fixed" });
  const activation = registry.proposeActivation({
    tenant_id: "tenant-a",
    agent_id: "relational-supervisor",
    trigger: "manual",
    task: "Coordinate Nyra and bounded workers",
  });
  assert.deepEqual(activation.proposed_workers, ["nyra-supervisor", "governance-watchdog"]);
  assert.equal(activation.execution.external_action, false);
});
