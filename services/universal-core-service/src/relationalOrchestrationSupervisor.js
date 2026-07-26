import crypto from "node:crypto";

const SCHEMA_VERSION = "relational_orchestration_supervision_v1";
const VALID_ROLES = new Set(["core", "relational_supervisor", "nyra", "orchestrator", "agent", "ai", "human"]);
const VALID_RELATIONS = new Set(["governs", "coordinates", "advises", "opens_context_for", "delegates", "verifies", "joins"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireText(value, field, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(canonical(value)).digest("hex").slice(0, 24)}`;
}

function normalizeActor(actor) {
  const actorId = requireText(actor?.actor_id, "actor_id", 120);
  const role = requireText(actor?.role, "actor_role", 64);
  if (!VALID_ROLES.has(role)) throw new Error("actor_role_invalid");
  return {
    actor_id: actorId,
    role,
    capabilities: [...new Set((Array.isArray(actor?.capabilities) ? actor.capabilities : [])
      .map((item) => requireText(item, "capability", 120)))].sort(),
    authority: role === "core" ? "decision" : "advisory",
    external_actions: false,
  };
}

function normalizeRelation(relation, actorIds) {
  const from = requireText(relation?.from, "relation_from", 120);
  const to = requireText(relation?.to, "relation_to", 120);
  const type = requireText(relation?.type, "relation_type", 64);
  if (!actorIds.has(from) || !actorIds.has(to)) throw new Error("relation_actor_not_found");
  if (from === to) throw new Error("self_relation_denied");
  if (!VALID_RELATIONS.has(type)) throw new Error("relation_type_invalid");
  return { from, to, type };
}

function validateAuthority(actors, relations) {
  const byId = new Map(actors.map((actor) => [actor.actor_id, actor]));
  const cores = actors.filter((actor) => actor.role === "core");
  const supervisors = actors.filter((actor) => actor.role === "relational_supervisor");
  const nyras = actors.filter((actor) => actor.role === "nyra");
  if (cores.length !== 1) throw new Error("single_core_required");
  if (supervisors.length !== 1) throw new Error("single_relational_supervisor_required");
  if (nyras.length !== 1) throw new Error("single_nyra_required");

  for (const relation of relations) {
    const from = byId.get(relation.from);
    const to = byId.get(relation.to);
    if (relation.type === "governs" && from.role !== "core") throw new Error("core_authority_inversion_denied");
    if (to.role === "core" && ["governs", "delegates", "coordinates"].includes(relation.type)) {
      throw new Error("core_authority_inversion_denied");
    }
    if (from.role === "nyra" && to.role === "relational_supervisor" && relation.type !== "advises") {
      throw new Error("relational_hierarchy_inversion_denied");
    }
  }

  const coreId = cores[0].actor_id;
  const supervisorId = supervisors[0].actor_id;
  if (!relations.some((item) => item.from === coreId && item.to === supervisorId && item.type === "governs")) {
    throw new Error("core_supervisor_binding_required");
  }
  for (const nyra of nyras) {
    if (!relations.some((item) => item.from === supervisorId && item.to === nyra.actor_id && item.type === "coordinates")) {
      throw new Error("supervisor_nyra_binding_required");
    }
  }
}

export function buildRelationalSupervisionContract({
  tenant_id,
  objective,
  actors,
  relations,
  unresolved_conflicts = [],
} = {}) {
  const tenantId = requireText(tenant_id, "tenant_id", 120);
  const normalizedActors = (Array.isArray(actors) ? actors : []).map(normalizeActor);
  if (normalizedActors.length < 3 || normalizedActors.length > 64) throw new Error("actors_invalid");
  if (new Set(normalizedActors.map((actor) => actor.actor_id)).size !== normalizedActors.length) {
    throw new Error("actor_id_duplicate");
  }
  const actorIds = new Set(normalizedActors.map((actor) => actor.actor_id));
  const normalizedRelations = (Array.isArray(relations) ? relations : []).map((relation) => normalizeRelation(relation, actorIds));
  validateAuthority(normalizedActors, normalizedRelations);

  const conflicts = [...new Set((Array.isArray(unresolved_conflicts) ? unresolved_conflicts : [])
    .map((item) => requireText(item, "unresolved_conflict", 500)))].sort();
  const stableInput = {
    tenant_id: tenantId,
    objective: requireText(objective, "objective", 4_000),
    actors: [...normalizedActors].sort((a, b) => a.actor_id.localeCompare(b.actor_id)),
    relations: [...normalizedRelations].sort((a, b) => canonical(a).localeCompare(canonical(b))),
    unresolved_conflicts: conflicts,
  };
  return {
    schema_version: SCHEMA_VERSION,
    supervision_id: digest("ros", stableInput),
    ...stableInput,
    hierarchy: {
      decision_authority: "universal_core",
      relational_coordinator: normalizedActors.find((actor) => actor.role === "relational_supervisor").actor_id,
      nyra_role: "interpret_context_and_advise",
      worker_role: "bounded_advice_only",
      core_join_required: true,
    },
    conflict_resolution: {
      state: conflicts.length ? "requires_core_reconciliation" : "clear",
      method: "evidence_provenance_then_core_join",
      unresolved_conflicts: conflicts,
    },
    guarantees: {
      tenant_bound: true,
      deterministic: true,
      model_invocation: false,
      tool_invocation: false,
      external_actions: false,
      execution_authorized: false,
    },
  };
}

export function createRelationalOrchestrationSupervisor() {
  const contracts = new Map();
  return {
    create(input) {
      const contract = buildRelationalSupervisionContract(input);
      const existing = contracts.get(contract.supervision_id);
      if (existing) return { ...clone(existing), reused: true };
      contracts.set(contract.supervision_id, contract);
      return { ...clone(contract), reused: false };
    },
    get({ tenant_id, supervision_id }) {
      const contract = contracts.get(requireText(supervision_id, "supervision_id", 160));
      if (!contract) throw new Error("relational_supervision_not_found");
      if (contract.tenant_id !== requireText(tenant_id, "tenant_id", 120)) {
        throw new Error("cross_tenant_relational_supervision_denied");
      }
      return clone(contract);
    },
  };
}
