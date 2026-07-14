import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const CLASSIFICATIONS = new Set(["internal", "customer_aggregate", "customer_personal", "restricted"]);
const EVENT_KINDS = new Set(["observation", "decision", "action", "outcome", "learning", "checkpoint", "handoff"]);
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g,
  /\bSHX-[A-Z]+-[A-Za-z0-9_-]{12,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,
];
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function safeId(value, name, { optional = false } = {}) {
  const id = String(value || "").trim();
  if (!id && optional) return "";
  if (!ID_PATTERN.test(id)) fail(`${name}_invalid`);
  return id;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function redactText(value, max = 20_000) {
  let text = String(value || "").trim().slice(0, max);
  let redactionCount = 0;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      redactionCount += 1;
      return "[REDACTED_SECRET]";
    });
  }
  text = text.replace(EMAIL_PATTERN, () => {
    redactionCount += 1;
    return "[REDACTED_EMAIL]";
  });
  return { text, redaction_count: redactionCount };
}

function requiredText(value, name, max = 20_000) {
  const redacted = redactText(value, max);
  if (!redacted.text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(redacted.text)) fail(`${name}_invalid`);
  return redacted;
}

function optionalText(value, max = 20_000) {
  if (value === undefined || value === null || value === "") return { text: "", redaction_count: 0 };
  return redactText(value, max);
}

function textList(value, maxItems = 20, maxLength = 1_000) {
  if (value === undefined) return { values: [], redaction_count: 0 };
  if (!Array.isArray(value)) fail("memory_list_invalid");
  let redactionCount = 0;
  const values = value.slice(0, maxItems).map((item) => {
    const redacted = requiredText(item, "memory_list_item", maxLength);
    redactionCount += redacted.redaction_count;
    return redacted.text;
  });
  return { values: [...new Set(values)], redaction_count: redactionCount };
}

function tagList(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("memory_tags_invalid");
  return [...new Set(value.slice(0, 30).map((item) => safeId(item, "memory_tag")))];
}

function actor(identity) {
  return String(identity?.subject || identity?.kind || "system").slice(0, 200);
}

// Never trust a client-provided agent id for the durable collaboration trail.
// A stable, opaque id lets any Core/Nyra-connected client resume its own work
// without disclosing its OAuth subject to another tenant participant.
function connectedAgentId(identity) {
  const subject = actor(identity);
  return `ai_${crypto.createHash("sha256").update(subject).digest("hex").slice(0, 24)}`;
}

function tenantRoot(root, tenantId) {
  const tenant = safeId(tenantId, "tenant");
  const base = path.resolve(root, "tenants");
  const resolved = path.resolve(base, tenant, "memory-fabric");
  if (!resolved.startsWith(`${base}${path.sep}`)) fail("tenant_path_rejected");
  return resolved;
}

function emptyState() {
  return {
    schema_version: "tenant_memory_fabric_v1",
    revision: 0,
    events: [],
    memories: [],
    checkpoints: [],
    handoffs: [],
    audit: [],
  };
}

function normalizeState(value) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value : emptyState();
  for (const key of ["events", "memories", "checkpoints", "handoffs", "audit"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  state.schema_version = "tenant_memory_fabric_v1";
  state.revision = Number.isInteger(state.revision) && state.revision >= 0 ? state.revision : 0;
  return state;
}

function stateFile(root, tenantId) {
  return path.join(tenantRoot(root, tenantId), "state.json");
}

function readState(root, tenantId) {
  const file = stateFile(root, tenantId);
  if (!fs.existsSync(file)) return emptyState();
  return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(dir, ".memory.lock");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const handle = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
      return { handle, lockPath };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 30_000) fs.unlinkSync(lockPath);
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      await wait(25);
    }
  }
  fail("memory_fabric_busy");
}

function releaseLock(lock) {
  try { fs.closeSync(lock.handle); } catch {}
  try { fs.unlinkSync(lock.lockPath); } catch {}
}

function pruneState(state, now = Date.now()) {
  const active = (item) => !item.expires_at || new Date(item.expires_at).getTime() > now;
  state.events = state.events.filter(active).slice(-5_000);
  state.memories = state.memories.filter(active).slice(-2_000);
  state.checkpoints = state.checkpoints.filter(active).slice(-500);
  state.handoffs = state.handoffs.filter(active).slice(-1_000);
  state.audit = state.audit.slice(-5_000);
}

async function updateState(root, tenantId, mutate) {
  const dir = tenantRoot(root, tenantId);
  const lock = await acquireLock(dir);
  try {
    const state = readState(root, tenantId);
    pruneState(state);
    const result = await mutate(state);
    state.revision += 1;
    const file = stateFile(root, tenantId);
    const temporary = path.join(dir, `.state-${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
    return { result, revision: state.revision };
  } finally {
    releaseLock(lock);
  }
}

function classification(input) {
  const value = String(input.data_classification || "internal").trim().toLowerCase();
  if (!CLASSIFICATIONS.has(value)) fail("memory_classification_invalid");
  if (value === "restricted") fail("restricted_memory_not_storable");
  if (value === "customer_personal" && !String(input.consent_reference || "").trim()) fail("memory_consent_reference_required");
  return value;
}

function expiry(input, config, classificationValue) {
  const requested = boundedNumber(input.retention_days, config.memoryRetentionDays, 1, 3_650);
  const days = classificationValue === "customer_personal" ? Math.min(requested, config.personalMemoryRetentionDays) : requested;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function normalizeMemoryInput(input, identity, config, kindOverride = "") {
  const kind = String(kindOverride || input.kind || "observation").trim().toLowerCase();
  if (!EVENT_KINDS.has(kind)) fail("memory_kind_invalid");
  const title = requiredText(input.title, "memory_title", 240);
  const summary = requiredText(input.summary, "memory_summary", 20_000);
  const facts = textList(input.facts);
  const decisions = textList(input.decisions);
  const actions = textList(input.actions);
  const outcomes = textList(input.outcomes);
  const nextSteps = textList(input.next_steps);
  const classificationValue = classification(input);
  const consent = optionalText(input.consent_reference, 240);
  const redactionCount = title.redaction_count + summary.redaction_count + facts.redaction_count + decisions.redaction_count
    + actions.redaction_count + outcomes.redaction_count + nextSteps.redaction_count + consent.redaction_count;
  return {
    id: `mem_${crypto.randomUUID()}`,
    kind,
    title: title.text,
    summary: summary.text,
    facts: facts.values,
    decisions: decisions.values,
    actions: actions.values,
    outcomes: outcomes.values,
    next_steps: nextSteps.values,
    tags: tagList(input.tags),
    importance: boundedNumber(input.importance, 50, 1, 100),
    data_classification: classificationValue,
    consent_reference: consent.text || null,
    project_id: safeId(input.project_id, "project", { optional: true }) || null,
    session_id: safeId(input.session_id, "session", { optional: true }) || null,
    agent_id: safeId(input.agent_id, "agent", { optional: true }) || null,
    source: safeId(input.source || "mcp_explicit", "source"),
    actor_subject: actor(identity),
    created_at: new Date().toISOString(),
    expires_at: expiry(input, config, classificationValue),
    redacted: true,
    redaction_count: redactionCount,
    idempotency_key: optionalText(input.idempotency_key, 120).text || null,
  };
}

function publicRecord(record) {
  const { actor_subject: _actor, idempotency_key: _key, ...safe } = record;
  return safe;
}

function audit(state, identity, type, target, gate = null) {
  state.audit.push({
    id: `ma_${crypto.randomUUID()}`,
    created_at: new Date().toISOString(),
    actor_subject: actor(identity),
    type,
    target,
    gate: gate ? { decision: gate.decision || "unknown", mediation: gate.mediation || "unknown" } : null,
  });
}

function tokens(value) {
  return [...new Set(String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9_\s-]+/g, " ").split(/\s+/).filter((item) => item.length > 1).slice(0, 30))];
}

function searchableText(record) {
  return [record.title, record.summary, ...(record.facts || []), ...(record.decisions || []), ...(record.actions || []),
    ...(record.outcomes || []), ...(record.next_steps || []), ...(record.tags || [])].join(" ").toLowerCase();
}

function searchState(state, input = {}) {
  const queryTokens = tokens(input.query);
  const projectId = safeId(input.project_id, "project", { optional: true });
  const sessionId = safeId(input.session_id, "session", { optional: true });
  const limit = boundedNumber(input.limit, 10, 1, 50);
  const records = [...state.memories, ...state.checkpoints];
  return records
    // Lifecycle checkpoints are surfaced deterministically as latest_checkpoint
    // and recent_activity; keep free-text recall focused on user/agent knowledge.
    .filter((record) => record.source !== "mcp_work_lifecycle")
    .filter((record) => !projectId || !record.project_id || record.project_id === projectId)
    .filter((record) => !sessionId || !record.session_id || record.session_id === sessionId)
    .map((record) => {
      const haystack = searchableText(record);
      const lexical = queryTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 12 : 0), 0);
      const ageHours = Math.max(0, (Date.now() - new Date(record.created_at).getTime()) / 3_600_000);
      const recency = Math.max(0, 20 - Math.log2(ageHours + 1) * 3);
      return { record, lexical, score: lexical + recency + Number(record.importance || 50) * 0.25 };
    })
    .filter(({ lexical }) => !queryTokens.length || lexical > 0)
    .sort((a, b) => b.score - a.score || b.record.created_at.localeCompare(a.record.created_at))
    .slice(0, limit)
    .map(({ record, score }) => ({ ...publicRecord(record), relevance_score: Number(score.toFixed(2)) }));
}

function textResult(payload) {
  return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function resultPayload(result) {
  return result?.structuredContent && typeof result.structuredContent === "object" ? result.structuredContent : {};
}

function safeAutomaticDetails(toolName, args = {}, result = null) {
  const payload = resultPayload(result);
  const target = redactText(args.path || args.task_id || args.action_type || "", 240);
  const safeResultId = (value) => ID_PATTERN.test(String(value || "")) ? String(value) : null;
  const details = {
    tool_name: toolName,
    target: target.text || null,
    project_id: ID_PATTERN.test(String(args.project_id || "")) ? String(args.project_id) : null,
    session_id: ID_PATTERN.test(String(args.session_id || "")) ? String(args.session_id) : null,
    domain_pack_id: safeResultId(payload.domain_pack?.id || payload.result?.domain_pack?.id),
    decision_state: safeResultId(payload.decision_contract?.state || payload.result?.selected_by_core?.state),
    execution_allowed: payload.guardrail?.execution_allowed === true || payload.result?.automation_plan?.execution_allowed === true,
    opened_branches: Array.isArray(payload.result?.nyra_neural_network?.opened_branches)
      ? payload.result.nyra_neural_network.opened_branches.map((item) => safeResultId(item.id)).filter(Boolean).slice(0, 20)
      : [],
  };
  return details;
}

export function createMemoryFabric(config, options = {}) {
  const root = String(config.memoryFabricRoot || config.agentWorkspaceRoot || "").trim();
  if (!root) throw new Error("memory_fabric_not_configured");
  const govern = options.govern;

  function read(tenantId) {
    const state = readState(root, tenantId);
    pruneState(state);
    return state;
  }

  async function governed(identity, action, mutate) {
    if (typeof govern !== "function") fail("memory_governance_unavailable");
    const gate = await govern(action, identity);
    if (!gate?.allowed) fail("core_gate_denied");
    const transaction = await updateState(root, identity.tenantId, async (state) => {
      const result = await mutate(state, gate);
      audit(state, identity, action.action_type, action.target, gate);
      return result;
    });
    return { ...transaction.result, revision: transaction.revision, gate: { decision: gate.decision, mediation: gate.mediation } };
  }

  async function append(input, identity) {
    const record = normalizeMemoryInput(input, identity, config);
    return governed(identity, { action_type: "memory.append", action_label: `Append tenant memory ${record.kind}`, target: record.project_id || record.session_id || record.id }, async (state) => {
      const existing = record.idempotency_key && state.memories.find((item) => item.idempotency_key === record.idempotency_key && item.actor_subject === record.actor_subject);
      if (existing) return { memory: publicRecord(existing), created: false, idempotent_replay: true };
      state.memories.push(record);
      state.events.push({ ...record, id: `evt_${crypto.randomUUID()}`, memory_id: record.id });
      return { memory: publicRecord(record), created: true, idempotent_replay: false };
    });
  }

  async function checkpoint(input, identity) {
    const record = normalizeMemoryInput({ ...input, kind: "checkpoint", title: input.title || "Agent checkpoint" }, identity, config, "checkpoint");
    return governed(identity, { action_type: "memory.checkpoint", action_label: "Create tenant memory checkpoint", target: record.project_id || record.session_id || record.id }, async (state) => {
      state.checkpoints.push(record);
      state.events.push({ ...record, id: `evt_${crypto.randomUUID()}`, checkpoint_id: record.id });
      return { checkpoint: publicRecord(record), created: true };
    });
  }

  async function handoff(input, identity) {
    const record = normalizeMemoryInput({ ...input, kind: "handoff", title: input.title || "Agent handoff" }, identity, config, "handoff");
    const toAgentId = input.to_agent_id === "all" ? "all" : safeId(input.to_agent_id, "to_agent");
    return governed(identity, { action_type: "memory.handoff", action_label: `Create memory handoff to ${toAgentId}`, target: toAgentId }, async (state) => {
      const handoffRecord = { ...record, to_agent_id: toAgentId, status: "pending", acknowledged_at: null, acknowledged_by: null };
      state.handoffs.push(handoffRecord);
      state.events.push({ ...record, id: `evt_${crypto.randomUUID()}`, handoff_id: record.id, to_agent_id: toAgentId });
      return { handoff: publicRecord(handoffRecord), created: true };
    });
  }

  async function acknowledge(input, identity) {
    const handoffId = String(input.handoff_id || "").trim();
    if (!/^mem_[a-f0-9-]{36}$/.test(handoffId)) fail("handoff_id_invalid");
    const agentId = safeId(input.agent_id, "agent");
    return governed(identity, { action_type: "memory.handoff_acknowledge", action_label: `Acknowledge memory handoff ${handoffId}`, target: handoffId }, async (state) => {
      const record = state.handoffs.find((item) => item.id === handoffId);
      if (!record) fail("handoff_not_found");
      if (record.to_agent_id !== "all" && record.to_agent_id !== agentId) fail("handoff_recipient_mismatch");
      record.status = "acknowledged";
      record.acknowledged_at = new Date().toISOString();
      record.acknowledged_by = agentId;
      return { handoff: publicRecord(record) };
    });
  }

  function context(input, identity) {
    const state = read(identity.tenantId);
    const projectId = safeId(input.project_id, "project", { optional: true });
    const sessionId = safeId(input.session_id, "session", { optional: true });
    const agentId = safeId(input.agent_id, "agent", { optional: true });
    const matchesScope = (record) => (!projectId || !record.project_id || record.project_id === projectId)
      && (!sessionId || !record.session_id || record.session_id === sessionId);
    const relevant = searchState(state, { ...input, project_id: projectId, session_id: sessionId, limit: input.limit || 10 });
    const checkpoints = state.checkpoints.filter(matchesScope).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const pending = state.handoffs
      .filter(matchesScope)
      .filter((item) => item.status === "pending" && (!agentId || item.to_agent_id === "all" || item.to_agent_id === agentId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 20)
      .map(publicRecord);
    const recent = state.events.filter(matchesScope).slice(-boundedNumber(input.activity_limit, 20, 1, 50)).reverse().map(publicRecord);
    return {
      schema_version: "tenant_memory_context_v1",
      tenant_id: identity.tenantId,
      revision: state.revision,
      project_id: projectId || null,
      session_id: sessionId || null,
      latest_checkpoint: checkpoints[0] ? publicRecord(checkpoints[0]) : null,
      pending_handoffs: pending,
      relevant_memories: relevant,
      recent_activity: recent,
      policy: {
        tenant_isolated: true,
        raw_prompts_stored_automatically: false,
        secrets_storable: false,
        customer_personal_requires_consent: true,
      },
    };
  }

  async function recordToolActivity({ identity, toolName, args = {}, result = null, error = null, preflight = null }) {
    if (!identity?.tenantId || String(toolName || "").startsWith("memory_")) return;
    const details = safeAutomaticDetails(toolName, args, result);
    const agentId = connectedAgentId(identity);
    const preflightId = String(preflight?.work_preflight?.preflight_id || preflight?.preflight_id || "").trim();
    await updateState(root, identity.tenantId, async (state) => {
      const timestamp = new Date().toISOString();
      const lifecycleKey = `agent_lifecycle:${preflightId || `${agentId}:${toolName}:${timestamp}`}`;
      // A preflight is the durable task contract. Every subsequent Core/Nyra
      // operation is a checkpoint, so a different connected AI can continue
      // even if the original ChatGPT/Codex session disappears.
      const lifecycleRecord = normalizeMemoryInput({
        kind: "checkpoint",
        title: toolName === "work_preflight" ? "Connected AI task contract" : "Connected AI progress checkpoint",
        summary: error
          ? `Connected AI ${agentId} failed while running ${toolName}; the next agent must inspect this checkpoint before retrying.`
          : toolName === "work_preflight"
            ? `Connected AI ${agentId} opened governed work through Core/Nyra.`
            : `Connected AI ${agentId} completed ${toolName} through Core/Nyra.`,
        facts: preflightId ? [`Preflight: ${preflightId}`] : [],
        decisions: details.decision_state ? [`Core state: ${details.decision_state}`] : [],
        actions: [`Tool call: ${toolName}`],
        outcomes: [error ? "failed" : "completed"],
        next_steps: error ? ["Inspect the failed checkpoint and continue with a governed retry or handoff."] : ["Read tenant memory context before the next action."],
        tags: ["connected_ai", "core_nyra", toolName === "work_preflight" ? "task_contract" : "checkpoint", error ? "failed" : "completed"],
        importance: error ? 75 : toolName === "work_preflight" ? 70 : 45,
        data_classification: "internal",
        project_id: details.project_id,
        session_id: details.session_id,
        agent_id: agentId,
        source: "mcp_work_lifecycle",
        idempotency_key: lifecycleKey,
      }, identity, config, "checkpoint");
      const existing = state.checkpoints.find((item) => item.idempotency_key === lifecycleRecord.idempotency_key && item.actor_subject === lifecycleRecord.actor_subject);
      if (!existing) {
        state.checkpoints.push(lifecycleRecord);
        state.events.push({ ...lifecycleRecord, id: `evt_${crypto.randomUUID()}`, checkpoint_id: lifecycleRecord.id });
      }
      state.events.push({
        id: `evt_${crypto.randomUUID()}`,
        kind: error ? "outcome" : "action",
        title: `MCP ${toolName}`,
        summary: error ? `Tool ${toolName} failed.` : `Tool ${toolName} completed.`,
        facts: [],
        decisions: details.decision_state ? [`Core state: ${details.decision_state}`] : [],
        actions: [`Tool call: ${toolName}`],
        outcomes: [error ? "failed" : "completed"],
        next_steps: [],
        tags: ["mcp_auto_journal", error ? "failed" : "completed"],
        importance: error ? 70 : 35,
        data_classification: "internal",
        consent_reference: null,
        project_id: details.project_id,
        session_id: details.session_id,
        agent_id: agentId,
        source: "mcp_auto_journal",
        actor_subject: actor(identity),
        created_at: timestamp,
        expires_at: new Date(Date.now() + config.memoryRetentionDays * 86_400_000).toISOString(),
        redacted: true,
        redaction_count: 0,
        tool_activity: details,
      });
      audit(state, identity, error ? "tool.failed" : "tool.completed", toolName);
      return { recorded: true, agent_id: agentId, task_contract_id: preflightId || null, checkpoint_created: !existing };
    });
  }

  return {
    append,
    checkpoint,
    handoff,
    acknowledge,
    context,
    search: (input, identity) => ({
      schema_version: "tenant_memory_search_v1",
      tenant_id: identity.tenantId,
      results: searchState(read(identity.tenantId), input),
    }),
    recordToolActivity,
  };
}

export function createMemoryFabricHandlers(fabric) {
  return {
    memory_context: async (args, identity) => textResult(fabric.context(args, identity)),
    memory_search: async (args, identity) => textResult(fabric.search(args, identity)),
    memory_append: async (args, identity) => textResult(await fabric.append(args, identity)),
    memory_checkpoint: async (args, identity) => textResult(await fabric.checkpoint(args, identity)),
    memory_handoff: async (args, identity) => textResult(await fabric.handoff(args, identity)),
    memory_handoff_acknowledge: async (args, identity) => textResult(await fabric.acknowledge(args, identity)),
  };
}

export { redactText, tenantRoot };
