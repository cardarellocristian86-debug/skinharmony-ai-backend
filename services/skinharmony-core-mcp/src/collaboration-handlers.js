import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createAgentPresence } from "./agent-presence.js";
import { createCollaborationPostgresStore } from "./collaboration-postgres-store.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const TASK_STATUSES = new Set(["open", "claimed", "in_progress", "blocked", "completed", "cancelled"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const AGENT_ACTIVE_WINDOW_MS = 5 * 60 * 1_000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function textResult(payload) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }]
  };
}

function requiredText(value, name, max = 10_000) {
  const text = String(value || "").trim();
  if (!text || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) fail(`${name}_invalid`);
  return text;
}

function optionalText(value, name, max = 10_000) {
  if (value === undefined || value === null || value === "") return "";
  return requiredText(value, name, max);
}

function safeId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) fail(`${name}_invalid`);
  return id;
}

function logicalPath(value, { folder = false } = {}) {
  const raw = String(value || "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const normalized = folder ? raw.replace(/\/+$/, "") : raw;
  if (!normalized || normalized.length > 240 || normalized.startsWith("/") || normalized.includes("//")) fail("workspace_path_invalid");
  const parts = normalized.split("/");
  if (parts.length > 16 || parts.some((part) => !part || part === "." || part === ".." || part.length > 80 || /[\u0000-\u001f]/.test(part))) {
    fail("workspace_path_invalid");
  }
  return parts.join("/");
}

function actor(identity) {
  return String(identity.subject || identity.kind || "unknown").slice(0, 200);
}

function publicAgent(agent) {
  const { actor_subject: _subject, ...record } = agent;
  const lastSeen = Date.parse(record.last_seen_at || "");
  const active = Number.isFinite(lastSeen) && Date.now() - lastSeen <= AGENT_ACTIVE_WINDOW_MS;
  return { ...record, active, status: active ? "active" : "stale" };
}

function tenantRoot(root, tenantId) {
  const tenant = safeId(tenantId, "tenant");
  const base = path.resolve(root, "tenants");
  const resolved = path.resolve(base, tenant, "agent-workspace");
  if (!resolved.startsWith(`${base}${path.sep}`)) fail("tenant_path_rejected");
  return resolved;
}

function emptyState() {
  return { schema_version: 2, revision: 0, folders: [], documents: [], tasks: [], messages: [], agents: [], audit: [] };
}

function normalizeState(value) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value : emptyState();
  for (const key of ["folders", "documents", "tasks", "messages", "agents", "audit"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  state.schema_version = 2;
  for (const agent of state.agents) {
    agent.client_type ||= "legacy";
    agent.session_fingerprint ||= null;
    agent.signature ||= `ags_legacy_${crypto.createHash("sha256").update(`${agent.actor_subject || "unknown"}\u0000${agent.id || "unknown"}`).digest("hex").slice(0, 24)}`;
  }
  state.revision = Number.isInteger(state.revision) && state.revision >= 0 ? state.revision : 0;
  return state;
}

function readState(root, tenantId) {
  const dir = tenantRoot(root, tenantId);
  const file = path.join(dir, "state.json");
  if (!fs.existsSync(file)) return emptyState();
  return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(dir, ".write.lock");
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
  fail("workspace_busy");
}

function releaseLock(lock) {
  try { fs.closeSync(lock.handle); } catch {}
  try { fs.unlinkSync(lock.lockPath); } catch {}
}

async function updateState(root, tenantId, mutate) {
  const dir = tenantRoot(root, tenantId);
  const lock = await acquireLock(dir);
  try {
    const state = readState(root, tenantId);
    const result = await mutate(state);
    state.revision += 1;
    const file = path.join(dir, "state.json");
    const temporary = path.join(dir, `.state-${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
    return { result, revision: state.revision };
  } finally {
    releaseLock(lock);
  }
}

function audit(state, identity, type, target, gate, result = {}) {
  const boundPresence = identity.agentPresence || {};
  const agentId = result.agent?.id || result.task?.claimed_by || result.message?.from_agent_id || result.acknowledged_by || boundPresence.agent_id || null;
  const agentSignature = result.agent?.signature || result.task?.claimed_by_signature || result.message?.from_agent_signature || result.acknowledged_by_signature || boundPresence.signature || null;
  const clientType = result.agent?.client_type || result.message?.from_client_type || boundPresence.client_type || null;
  state.audit.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor_subject: actor(identity),
    agent_id: agentId,
    agent_signature: agentSignature,
    client_type: clientType,
    type,
    target,
    gate: gate ? { allowed: gate.allowed === true, decision: gate.decision || "unknown", mediation: gate.mediation || "unknown" } : null
  });
  if (state.audit.length > 2_000) state.audit.splice(0, state.audit.length - 2_000);
}

function publicDocument(document, includeContent = false) {
  const result = {
    id: document.id,
    path: document.path,
    title: document.title,
    version: document.version,
    created_at: document.created_at,
    updated_at: document.updated_at,
    created_by: document.created_by,
    updated_by: document.updated_by
  };
  if (includeContent) result.content = document.content;
  return result;
}

function publicTask(task) {
  return { ...task, history: task.history.slice(-20) };
}

function requireOwnedAgent(state, agentId, identity) {
  const registered = state.agents.find((agent) => agent.id === agentId && agent.actor_subject === actor(identity));
  if (!registered) fail("agent_not_registered");
  if (!registered.session_fingerprint || String(registered.signature || "").startsWith("ags_legacy_")) fail("agent_reregistration_required");
  return registered;
}

export function createCollaborationHandlers(config, options = {}) {
  const root = String(config.agentWorkspaceRoot || "").trim();
  const postgres = createCollaborationPostgresStore(config, options);
  if (!root && !postgres) throw new Error("agent_workspace_not_configured");
  const govern = options.govern;

  async function governed(identity, action, mutate) {
    if (typeof govern !== "function") fail("governance_unavailable");
    const gate = await govern(action, identity);
    if (!gate?.allowed) fail("core_gate_denied");
    const transaction = await updateState(root, identity.tenantId, async (state) => {
      const result = await mutate(state, gate);
      audit(state, identity, action.action_type, action.target, gate, result);
      return result;
    });
    return textResult({
      ...transaction.result,
      workspace_revision: transaction.revision,
      gate: {
        allowed: gate.allowed === true,
        decision: gate.decision,
        mediation: gate.mediation,
        owner_confirmation_required: gate.owner_confirmation_required === true,
        confirmation_satisfied: gate.confirmation_satisfied === true
      }
    });
  }

  return {
    workspace_list: async ({ prefix = "" }, identity) => {
      const state = readState(root, identity.tenantId);
      const normalizedPrefix = prefix ? logicalPath(prefix, { folder: true }) : "";
      const matches = (entry) => !normalizedPrefix || entry.path === normalizedPrefix || entry.path.startsWith(`${normalizedPrefix}/`);
      return textResult({
        revision: state.revision,
        folders: state.folders.filter(matches),
        documents: state.documents.filter(matches).map((document) => publicDocument(document))
      });
    },

    workspace_create_folder: async ({ path: requestedPath }, identity) => {
      const folderPath = logicalPath(requestedPath, { folder: true });
      return governed(identity, { action_type: "workspace.create_folder", action_label: `Create shared folder ${folderPath}`, target: folderPath }, async (state) => {
        const existing = state.folders.find((folder) => folder.path === folderPath);
        if (existing) return { folder: existing, created: false };
        const folder = { id: crypto.randomUUID(), path: folderPath, created_at: new Date().toISOString(), created_by: actor(identity) };
        state.folders.push(folder);
        return { folder, created: true };
      });
    },

    workspace_read_document: async ({ id, path: requestedPath }, identity) => {
      if ((!id && !requestedPath) || (id && requestedPath)) fail("document_selector_invalid");
      const state = readState(root, identity.tenantId);
      const document = id
        ? state.documents.find((candidate) => candidate.id === String(id))
        : state.documents.find((candidate) => candidate.path === logicalPath(requestedPath));
      if (!document) fail("document_not_found");
      return textResult({ document: publicDocument(document, true), revision: state.revision });
    },

    workspace_write_document: async ({ path: requestedPath, title, content, expected_version, idempotency_key }, identity) => {
      const documentPath = logicalPath(requestedPath);
      const documentTitle = optionalText(title, "document_title", 200) || documentPath.split("/").at(-1);
      const documentContent = requiredText(content, "document_content", 100_000);
      const idempotencyKey = optionalText(idempotency_key, "idempotency_key", 120);
      return governed(identity, { action_type: "workspace.write_document", action_label: `Write shared document ${documentPath}`, target: documentPath }, async (state) => {
        const existing = state.documents.find((document) => document.path === documentPath);
        if (existing && idempotencyKey && existing.last_idempotency_key === idempotencyKey && existing.updated_by === actor(identity)) {
          return { document: publicDocument(existing), created: false, idempotent_replay: true };
        }
        const timestamp = new Date().toISOString();
        if (!existing) {
          if (expected_version !== undefined && Number(expected_version) !== 0) fail("document_version_conflict");
          const document = {
            id: crypto.randomUUID(), path: documentPath, title: documentTitle, content: documentContent, version: 1,
            created_at: timestamp, updated_at: timestamp, created_by: actor(identity), updated_by: actor(identity),
            last_idempotency_key: idempotencyKey
          };
          state.documents.push(document);
          return { document: publicDocument(document), created: true, idempotent_replay: false };
        }
        if (expected_version === undefined) fail("document_expected_version_required");
        if (Number(expected_version) !== existing.version) fail("document_version_conflict");
        existing.title = documentTitle;
        existing.content = documentContent;
        existing.version += 1;
        existing.updated_at = timestamp;
        existing.updated_by = actor(identity);
        existing.last_idempotency_key = idempotencyKey;
        return { document: publicDocument(existing), created: false, idempotent_replay: false };
      });
    },

    task_list: async ({ status, limit = 50 }, identity) => {
      if (postgres) return postgres.listTasks({ status, limit }, identity);
      if (status && !TASK_STATUSES.has(status)) fail("task_status_invalid");
      const state = readState(root, identity.tenantId);
      const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
      const tasks = state.tasks.filter((task) => !status || task.status === status).slice(-boundedLimit).reverse().map(publicTask);
      return textResult({ tasks, revision: state.revision });
    },

    task_create: async ({ title, description = "", priority = "normal", idempotency_key = "" }, identity) => {
      if (postgres) return postgres.createTask({ title, description, priority, idempotency_key }, identity);
      const taskTitle = requiredText(title, "task_title", 240);
      const taskDescription = optionalText(description, "task_description", 20_000);
      if (!PRIORITIES.has(priority)) fail("task_priority_invalid");
      const key = optionalText(idempotency_key, "idempotency_key", 120);
      return governed(identity, { action_type: "task.create", action_label: `Create shared task ${taskTitle}`, target: taskTitle }, async (state) => {
        const existing = key && state.tasks.find((task) => task.idempotency_key === key && task.created_by === actor(identity));
        if (existing) return { task: publicTask(existing), created: false, idempotent_replay: true };
        const timestamp = new Date().toISOString();
        const task = {
          id: crypto.randomUUID(), title: taskTitle, description: taskDescription, priority, status: "open", version: 1,
          claimed_by: null, created_at: timestamp, updated_at: timestamp, created_by: actor(identity), idempotency_key: key,
          history: [{ at: timestamp, actor_subject: actor(identity), action: "created" }]
        };
        state.tasks.push(task);
        return { task: publicTask(task), created: true, idempotent_replay: false };
      });
    },

    task_claim: async ({ task_id, agent_id, expected_version }, identity) => {
      if (postgres) return postgres.claimTask({ task_id, agent_id, expected_version }, identity);
      const taskId = requiredText(task_id, "task_id", 80);
      const agentId = safeId(agent_id, "agent");
      if (!Number.isInteger(Number(expected_version)) || Number(expected_version) < 1) fail("task_expected_version_required");
      return governed(identity, { action_type: "task.claim", action_label: `Claim shared task ${taskId}`, target: taskId }, async (state) => {
        const registeredAgent = requireOwnedAgent(state, agentId, identity);
        const task = state.tasks.find((candidate) => candidate.id === taskId);
        if (!task) fail("task_not_found");
        if (task.version !== Number(expected_version)) fail("task_version_conflict");
        if (task.claimed_by && task.claimed_by !== agentId) fail("task_already_claimed");
        if (["completed", "cancelled"].includes(task.status)) fail("task_closed");
        const timestamp = new Date().toISOString();
        task.claimed_by = agentId;
        task.claimed_by_signature = registeredAgent.signature;
        task.claimed_by_client_type = registeredAgent.client_type;
        task.status = task.status === "open" ? "claimed" : task.status;
        task.version += 1;
        task.updated_at = timestamp;
        task.history.push({ at: timestamp, actor_subject: actor(identity), agent_id: agentId, agent_signature: registeredAgent.signature, client_type: registeredAgent.client_type, action: "claimed" });
        return { task: publicTask(task) };
      });
    },

    task_update: async ({ task_id, agent_id, status, note = "", expected_version }, identity) => {
      if (postgres) return postgres.updateTask({ task_id, agent_id, status, note, expected_version }, identity);
      const taskId = requiredText(task_id, "task_id", 80);
      const agentId = safeId(agent_id, "agent");
      if (!TASK_STATUSES.has(status) || status === "open") fail("task_status_invalid");
      if (!Number.isInteger(Number(expected_version)) || Number(expected_version) < 1) fail("task_expected_version_required");
      const taskNote = optionalText(note, "task_note", 10_000);
      return governed(identity, { action_type: "task.update", action_label: `Update shared task ${taskId} to ${status}`, target: taskId }, async (state) => {
        const registeredAgent = requireOwnedAgent(state, agentId, identity);
        const task = state.tasks.find((candidate) => candidate.id === taskId);
        if (!task) fail("task_not_found");
        if (task.version !== Number(expected_version)) fail("task_version_conflict");
        if (task.claimed_by && task.claimed_by !== agentId) fail("task_claim_mismatch");
        const timestamp = new Date().toISOString();
        task.claimed_by ||= agentId;
        task.claimed_by_signature ||= registeredAgent.signature;
        task.claimed_by_client_type ||= registeredAgent.client_type;
        task.status = status;
        task.version += 1;
        task.updated_at = timestamp;
        task.history.push({ at: timestamp, actor_subject: actor(identity), agent_id: agentId, agent_signature: registeredAgent.signature, client_type: registeredAgent.client_type, action: "status_updated", status, note: taskNote });
        return { task: publicTask(task) };
      });
    },

    agent_heartbeat: async ({ agent_id, client_type, session_id, display_name = "", capabilities = [] }, identity) => {
      if (postgres) return postgres.heartbeat({ agent_id, client_type, session_id, display_name, capabilities }, identity);
      const presence = createAgentPresence(config, identity, { agent_id, client_type, session_id });
      const agentId = presence.agent_id;
      const clientType = presence.client_type;
      const fingerprint = presence.session_fingerprint;
      const signature = presence.signature;
      const displayName = optionalText(display_name, "display_name", 120) || agentId;
      const safeCapabilities = Array.isArray(capabilities) ? [...new Set(capabilities.map((value) => safeId(value, "capability")))].slice(0, 20) : fail("capabilities_invalid");
      return governed(identity, { action_type: "agent.heartbeat", action_label: `Register agent ${agentId}`, target: agentId }, async (state) => {
        const timestamp = new Date().toISOString();
        let record = state.agents.find((candidate) => candidate.id === agentId);
        if (!record) {
          record = {
            id: agentId,
            opaque_agent_id: presence.opaque_agent_id,
            signature,
            signature_version: presence.signature_version,
            client_type: clientType,
            session_fingerprint: fingerprint,
            display_name: displayName,
            capabilities: safeCapabilities,
            actor_subject: actor(identity),
            first_seen_at: timestamp,
            last_seen_at: timestamp
          };
          state.agents.push(record);
        } else {
          if (record.actor_subject !== actor(identity)) fail("agent_identity_conflict");
          if (record.session_fingerprint && record.signature !== signature) fail("agent_instance_conflict");
          record.opaque_agent_id = presence.opaque_agent_id;
          record.signature = signature;
          record.signature_version = presence.signature_version;
          record.client_type = clientType;
          record.session_fingerprint = fingerprint;
          record.display_name = displayName;
          record.capabilities = safeCapabilities;
          record.last_seen_at = timestamp;
        }
        return { agent: publicAgent(record) };
      });
    },

    agent_list: async (_args, identity) => {
      if (postgres) return postgres.listAgents(identity);
      const state = readState(root, identity.tenantId);
      return textResult({ agents: state.agents.map(publicAgent), revision: state.revision });
    },

    message_post: async ({ from_agent_id, to_agent_id = "all", body, thread_id = "", idempotency_key = "" }, identity) => {
      if (postgres) return postgres.postMessage({ from_agent_id, to_agent_id, body, thread_id, idempotency_key }, identity);
      const fromAgentId = safeId(from_agent_id, "agent");
      const toAgentId = to_agent_id === "all" ? "all" : safeId(to_agent_id, "agent");
      const messageBody = requiredText(body, "message_body", 20_000);
      const threadId = optionalText(thread_id, "thread_id", 80);
      const key = optionalText(idempotency_key, "idempotency_key", 120);
      return governed(identity, { action_type: "message.post", action_label: `Post agent message from ${fromAgentId} to ${toAgentId}`, target: toAgentId }, async (state) => {
        const sender = requireOwnedAgent(state, fromAgentId, identity);
        const recipient = toAgentId === "all" ? null : state.agents.find((agent) => agent.id === toAgentId);
        if (toAgentId !== "all" && !recipient) fail("recipient_not_registered");
        if (recipient && (!recipient.session_fingerprint || String(recipient.signature || "").startsWith("ags_legacy_"))) fail("message_recipient_reregistration_required");
        const existing = key && state.messages.find((message) => message.idempotency_key === key && message.from_agent_id === fromAgentId);
        if (existing) return { message: existing, created: false, idempotent_replay: true };
        const message = {
          id: crypto.randomUUID(),
          thread_id: threadId || crypto.randomUUID(),
          from_agent_id: fromAgentId,
          from_agent_signature: sender.signature,
          from_client_type: sender.client_type,
          to_agent_id: toAgentId,
          to_agent_signature: recipient?.signature || null,
          body: messageBody,
          created_at: new Date().toISOString(),
          read_by: [],
          read_by_signatures: [],
          idempotency_key: key
        };
        state.messages.push(message);
        return { message, created: true, idempotent_replay: false };
      });
    },

    message_inbox: async ({ agent_id, unread_only = false, limit = 50 }, identity) => {
      if (postgres) return postgres.inbox({ agent_id, unread_only, limit }, identity);
      const agentId = safeId(agent_id, "agent");
      const state = readState(root, identity.tenantId);
      requireOwnedAgent(state, agentId, identity);
      const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
      const messages = state.messages
        .filter((message) => (message.to_agent_id === "all" || message.to_agent_id === agentId) && (!unread_only || !message.read_by.includes(agentId)))
        .slice(-boundedLimit).reverse();
      return textResult({ messages, revision: state.revision });
    },

    message_acknowledge: async ({ message_id, agent_id }, identity) => {
      if (postgres) return postgres.acknowledge({ message_id, agent_id }, identity);
      const messageId = requiredText(message_id, "message_id", 80);
      const agentId = safeId(agent_id, "agent");
      return governed(identity, { action_type: "message.acknowledge", action_label: `Acknowledge agent message ${messageId}`, target: messageId }, async (state) => {
        const registeredAgent = requireOwnedAgent(state, agentId, identity);
        const message = state.messages.find((candidate) => candidate.id === messageId);
        if (!message || (message.to_agent_id !== "all" && message.to_agent_id !== agentId)) fail("message_not_found");
        if (!message.read_by.includes(agentId)) message.read_by.push(agentId);
        message.read_by_signatures ||= [];
        if (!message.read_by_signatures.includes(registeredAgent.signature)) message.read_by_signatures.push(registeredAgent.signature);
        return { message_id: message.id, acknowledged_by: agentId, acknowledged_by_signature: registeredAgent.signature };
      });
    }
  };
}

export { logicalPath, tenantRoot };
