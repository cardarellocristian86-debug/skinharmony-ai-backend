import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const EVENTS = new Set([
  "work_created", "branch_opened", "function_added", "dependency_changed",
  "checkpoint_created", "handoff_created", "test_completed", "defect_found",
  "correction_verified", "work_resumed",
]);
const ROLES = new Set([
  "nyra_interpreter", "architecture_mapper", "impact_analyzer", "dtt_event_agent",
  "codex_worker", "test_agent", "verification_agent", "supervisor", "memory_curator",
]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function text(value, field, max = 4000, optional = false) {
  const out = String(value || "").trim();
  if ((!out && !optional) || out.length > max) throw new Error(`${field}_invalid`);
  return out;
}
function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field}_invalid`);
  return value;
}
function safeFile(root, tenant, work) {
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  return path.join(root, hash(tenant), `${hash(work)}.json`);
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
}
function read(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null; }
function identity(input, tenantId) {
  const projectId = text(input.project_id, "project_id", 160);
  const workId = input.work_id ? text(input.work_id, "work_id", 160) : `work_${crypto.randomUUID()}`;
  return {
    tenant_id: tenantId,
    project_id: projectId,
    work_id: workId,
    session_id: input.session_id ? text(input.session_id, "session_id", 160) : `session_${crypto.randomUUID()}`,
    parent_work_id: input.parent_work_id ? text(input.parent_work_id, "parent_work_id", 160) : null,
  };
}
function append(record, type, actor, data, now) {
  if (!EVENTS.has(type)) throw new Error("continuity_event_type_invalid");
  if (!ROLES.has(actor)) throw new Error("continuity_role_invalid");
  const previous = record.event_ledger.at(-1)?.event_digest || "genesis";
  const event = { schema_version: "work_continuity_event_v1", event_id: `wce_${crypto.randomUUID()}`, type, actor, at: now(), data: clone(data || {}), previous_event_digest: previous };
  event.event_digest = digest({ ...event });
  record.event_ledger.push(event);
  return event;
}
function architecture(input = {}) {
  const source = object(input, "architecture_map");
  return {
    schema_version: "work_architecture_map_v1",
    idea_origin: text(source.idea_origin, "idea_origin"), objective: text(source.objective, "objective"),
    components: Array.isArray(source.components) ? clone(source.components).slice(0, 200) : [],
    functions: Array.isArray(source.functions) ? clone(source.functions).slice(0, 200) : [],
    connections: Array.isArray(source.connections) ? clone(source.connections).slice(0, 500) : [],
    dependencies: Array.isArray(source.dependencies) ? clone(source.dependencies).slice(0, 500) : [],
    depth: Number.isInteger(source.depth) && source.depth >= 0 && source.depth <= 32 ? source.depth : 0,
    decisions: Array.isArray(source.decisions) ? clone(source.decisions).slice(0, 200) : [],
    current_state: text(source.current_state || "planned", "current_state", 160),
    revision: 1,
  };
}
function capsule(record, nextAction, now) {
  const payload = {
    schema_version: "continuity_capsule_v1", identity: record.identity,
    architecture_map: record.architecture_map, dynamic_thought_tree: record.dynamic_thought_tree,
    evidence: record.verified_memory, commit_patch: record.commit_patch, tests: record.tests,
    authorizations: record.authorizations, rollback: record.rollback, next_action: nextAction,
    event_head: record.event_ledger.at(-1)?.event_digest || "genesis", created_at: now(),
  };
  return { ...payload, digest: digest(payload) };
}

export function createWorkContinuityRuntime({ root, now = () => new Date().toISOString() } = {}) {
  const storageRoot = text(root, "work_continuity_root", 2000);
  function load(tenantId, workId) {
    const record = read(safeFile(storageRoot, tenantId, workId));
    if (!record) throw new Error("work_not_found");
    if (record.identity.tenant_id !== tenantId) throw new Error("cross_tenant_work_denied");
    return record;
  }
  function save(record) { record.updated_at = now(); atomicWrite(safeFile(storageRoot, record.identity.tenant_id, record.identity.work_id), record); return clone(record); }
  function idempotent(record, key) { return key && record.idempotency[key] ? clone(record.idempotency[key]) : null; }
  return {
    create(input, tenantId) {
      const work = identity(input, tenantId);
      const file = safeFile(storageRoot, tenantId, work.work_id);
      if (read(file)) throw new Error("work_already_exists");
      const record = { schema_version: "work_continuity_runtime_v1", identity: work, architecture_map: architecture(input.architecture_map), impact_maps: [], dynamic_thought_tree: { root: input.dynamic_thought_tree?.root || work.work_id, branches: [], subbranches: [], hypotheses: [], blocks: [], next_step: input.next_action || "map_architecture" }, event_ledger: [], checkpoints: [], handoffs: [], verified_memory: [], tests: [], commit_patch: input.commit_patch || null, authorizations: [], rollback: input.rollback || null, idempotency: {}, capsule: null, created_at: now(), updated_at: now() };
      append(record, "work_created", "nyra_interpreter", { project_id: work.project_id }, now);
      record.capsule = capsule(record, record.dynamic_thought_tree.next_step, now);
      return save(record);
    },
    read({ tenant_id, work_id }) { return clone(load(tenant_id, work_id)); },
    append({ tenant_id, work_id, event_type, actor, data = {}, idempotency_key }) {
      const record = load(tenant_id, work_id); const prior = idempotent(record, idempotency_key); if (prior) return prior;
      if (event_type === "function_added") {
        const impact = object(data.impact_map, "impact_map");
        record.architecture_map.functions.push(clone(data.function || impact.function || {}));
        record.architecture_map.connections.push(...(Array.isArray(impact.connections) ? clone(impact.connections) : []));
        record.architecture_map.dependencies.push(...(Array.isArray(impact.dependencies) ? clone(impact.dependencies) : []));
        record.architecture_map.depth = Math.max(record.architecture_map.depth, Number.isInteger(impact.depth) ? impact.depth : 0);
        record.architecture_map.revision += 1; record.impact_maps.push({ schema_version: "work_impact_map_v1", at: now(), ...clone(impact) });
      }
      if (event_type === "dependency_changed") { record.architecture_map.dependencies.push(clone(data.dependency || data)); record.architecture_map.revision += 1; }
      const event = append(record, event_type, actor, data, now);
      const result = { ok: true, event, revision: record.event_ledger.length };
      if (idempotency_key) record.idempotency[text(idempotency_key, "idempotency_key", 160)] = result;
      save(record); return clone(result);
    },
    checkpoint({ tenant_id, work_id, actor, next_action, commit_patch = null, tests = [], rollback = null, idempotency_key }) {
      const record = load(tenant_id, work_id); const prior = idempotent(record, idempotency_key); if (prior) return prior;
      if (!ROLES.has(actor)) throw new Error("continuity_role_invalid");
      record.commit_patch = commit_patch || record.commit_patch; record.tests = Array.isArray(tests) ? clone(tests).slice(0, 200) : record.tests; record.rollback = rollback || record.rollback;
      const item = { checkpoint_id: `wcp_${crypto.randomUUID()}`, actor, next_action: text(next_action, "next_action"), at: now(), event_head: record.event_ledger.at(-1)?.event_digest || "genesis" };
      record.checkpoints.push(item); append(record, "checkpoint_created", actor, { checkpoint_id: item.checkpoint_id }, now); record.dynamic_thought_tree.next_step = item.next_action; record.capsule = capsule(record, item.next_action, now);
      const result = { ok: true, checkpoint: item, capsule: record.capsule }; if (idempotency_key) record.idempotency[text(idempotency_key, "idempotency_key", 160)] = result; save(record); return clone(result);
    },
    resume({ tenant_id, work_id, session_id, repository_digest, policy_digest }) {
      const record = load(tenant_id, work_id); const saved = record.capsule;
      if (!saved || saved.digest !== digest(Object.fromEntries(Object.entries(saved).filter(([key]) => key !== "digest")))) throw new Error("continuity_capsule_digest_invalid");
      const drift = { repository: repository_digest && record.commit_patch?.digest && repository_digest !== record.commit_patch.digest, policy: policy_digest && record.authorizations.at(-1)?.policy_digest && policy_digest !== record.authorizations.at(-1).policy_digest };
      if (drift.repository || drift.policy) throw new Error("continuity_drift_detected");
      record.identity.session_id = text(session_id, "session_id", 160); append(record, "work_resumed", "supervisor", { checkpoint_id: record.checkpoints.at(-1)?.checkpoint_id || null }, now); save(record);
      return { ok: true, identity: clone(record.identity), capsule: clone(record.capsule), revalidation_required: true, execution_authorized: false };
    },
    verifyMemory({ tenant_id, work_id, actor, memory, test_reference, supervisor_approved }) {
      if (actor !== "memory_curator" || supervisor_approved !== true) throw new Error("verified_memory_supervisor_approval_required");
      const record = load(tenant_id, work_id); if (!record.tests.some((item) => item.id === test_reference && item.passed === true)) throw new Error("verified_memory_test_evidence_required");
      const entry = { memory_id: `wvm_${crypto.randomUUID()}`, provenance: text(memory.provenance, "memory_provenance"), confidence: Number(memory.confidence), valid_until: text(memory.valid_until, "memory_valid_until", 80), relation_work_id: work_id, summary: text(memory.summary, "memory_summary") };
      if (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) throw new Error("memory_confidence_invalid");
      record.verified_memory.push(entry); append(record, "correction_verified", "memory_curator", { memory_id: entry.memory_id }, now); save(record); return clone(entry);
    },
  };
}
