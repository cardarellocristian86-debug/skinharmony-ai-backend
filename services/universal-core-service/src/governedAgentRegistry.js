import crypto from "node:crypto";

const AGENT_CATALOG = Object.freeze([
  {
    agent_id: "nyra-supervisor",
    role: "supervisor",
    description: "Creates read-only plans, routes evidence work, and synthesizes recommendations.",
    allowed_triggers: ["manual", "event", "schedule"],
    allowed_capabilities: ["plan", "handoff", "join", "synthesize"],
    model_execution: "budgeted_only",
    external_actions: "owner_confirmation_required",
  },
  {
    agent_id: "research-scout",
    role: "research",
    description: "Collects bounded evidence for a supervisor-approved research task.",
    allowed_triggers: ["supervisor_handoff"],
    allowed_capabilities: ["research", "cite_evidence"],
    model_execution: "budgeted_only",
    external_actions: "owner_confirmation_required",
  },
  {
    agent_id: "evidence-critic",
    role: "verification",
    description: "Checks source quality, contradictions, freshness, and policy compliance.",
    allowed_triggers: ["supervisor_handoff"],
    allowed_capabilities: ["verify", "flag_risk"],
    model_execution: "budgeted_only",
    external_actions: "forbidden",
  },
  {
    agent_id: "governance-watchdog",
    role: "watchdog",
    description: "Monitors limits, deadlines, cancellation, and zombie-branch indicators.",
    allowed_triggers: ["event", "schedule"],
    allowed_capabilities: ["monitor", "cancel", "alert"],
    model_execution: "forbidden",
    external_actions: "forbidden",
  },
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireText(value, field, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function getAgent(agentId) {
  const agent = AGENT_CATALOG.find((candidate) => candidate.agent_id === requireText(agentId, "agent_id", 120));
  if (!agent) throw new Error("agent_not_registered");
  return agent;
}

export function governedAgentCatalog() {
  return clone(AGENT_CATALOG);
}

export function buildGovernedResearchWorkers({ task }) {
  const researchTask = requireText(task, "task", 4_000);
  return [
    { worker_id: "research", agent_id: "research-scout", task: `Collect bounded cited evidence for: ${researchTask}`, dependencies: [], branch_depth: 1 },
    { worker_id: "critic", agent_id: "evidence-critic", task: "Check freshness, contradictions, source quality, and policy compliance of the research evidence.", dependencies: ["research"], parent_worker_id: "research", branch_depth: 2 },
    { worker_id: "synthesis", agent_id: "nyra-supervisor", task: "Synthesize verified evidence into a read-only recommendation and unresolved-risk list.", dependencies: ["critic"], parent_worker_id: "critic", branch_depth: 3 },
  ];
}

export function createGovernedAgentRegistry({ now = () => new Date().toISOString(), idFactory = () => crypto.randomUUID() } = {}) {
  const activations = new Map();

  return {
    listAgents() {
      return governedAgentCatalog();
    },

    proposeActivation({ tenant_id, agent_id = "nyra-supervisor", trigger, task, idempotency_key = null, metadata = {} }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const agent = getAgent(agent_id);
      const normalizedTrigger = requireText(trigger, "activation_trigger", 64);
      if (!agent.allowed_triggers.includes(normalizedTrigger)) throw new Error("agent_trigger_not_allowed");
      const normalizedTask = requireText(task, "task", 4_000);
      const normalizedKey = idempotency_key ? requireText(idempotency_key, "idempotency_key", 160) : null;
      if (["event", "schedule"].includes(normalizedTrigger) && !normalizedKey) throw new Error("activation_idempotency_key_required");
      const safeMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? clone(metadata) : {};

      for (const activation of activations.values()) {
        if (normalizedKey && activation.tenant_id === tenantId && activation.idempotency_key === normalizedKey) return { ...clone(activation), reused: true };
      }

      const activation = {
        schema_version: "governed_agent_activation_v1",
        activation_id: `activation_${idFactory()}`,
        tenant_id: tenantId,
        agent_id: agent.agent_id,
        role: agent.role,
        trigger: normalizedTrigger,
        task: normalizedTask,
        metadata: safeMetadata,
        idempotency_key: normalizedKey,
        status: "dry_run_ready",
        created_at: now(),
        execution: {
          mode: "dry_run",
          model_invocation: false,
          tool_invocation: false,
          external_action: false,
          owner_confirmation_required_for_execution: true,
        },
        proposed_workers: agent.agent_id === "nyra-supervisor"
          ? ["research-scout", "evidence-critic", "governance-watchdog"]
          : [],
        limits: {
          max_branch_depth: 3,
          max_workers: 4,
          model_budget_required: true,
          learning_mode: "frozen",
        },
        reused: false,
      };
      activations.set(activation.activation_id, activation);
      return clone(activation);
    },
  };
}
