import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { nyraDigest } from "../../shared/nyra-work-automation-receipts.js";

export const NYRA_WORK_AUTOMATION_VERSION = "nyra_work_automation_v3";
export const NYRA_WORK_AUTOMATION_STATES = Object.freeze([
  "PLAN_PENDING", "BUILDER_PENDING", "BUILDING", "COMMIT_READBACK_PENDING",
  "BUILDER_REPORT_PENDING", "PUSH_PENDING", "DRAFT_PR_PENDING", "READY_PENDING",
  "CI_WAIT", "VERIFIER_PENDING", "READINESS_PENDING", "CORE_JOIN_PENDING",
  "MERGE_PENDING", "DEPLOYMENT_READBACK_PENDING", "OBSERVE_PENDING",
  "FINAL_ACCEPTANCE_PENDING", "CLOSURE_PENDING", "COMPLETED", "BLOCKED",
  "CANCELLED", "QUARANTINED",
]);

const TERMINAL = new Set(["COMPLETED", "BLOCKED", "CANCELLED", "QUARANTINED"]);
const TRANSITIONS = Object.freeze({
  PLAN_PENDING: new Set(["BUILDER_PENDING"]),
  BUILDER_PENDING: new Set(["BUILDING"]),
  BUILDING: new Set(["COMMIT_READBACK_PENDING"]),
  COMMIT_READBACK_PENDING: new Set(["BUILDER_REPORT_PENDING"]),
  BUILDER_REPORT_PENDING: new Set(["PUSH_PENDING"]),
  PUSH_PENDING: new Set(["DRAFT_PR_PENDING"]),
  DRAFT_PR_PENDING: new Set(["READY_PENDING", "CI_WAIT"]),
  READY_PENDING: new Set(["CI_WAIT"]),
  CI_WAIT: new Set(["VERIFIER_PENDING"]),
  VERIFIER_PENDING: new Set(["READINESS_PENDING"]),
  READINESS_PENDING: new Set(["CORE_JOIN_PENDING"]),
  CORE_JOIN_PENDING: new Set(["MERGE_PENDING"]),
  MERGE_PENDING: new Set(["DEPLOYMENT_READBACK_PENDING"]),
  DEPLOYMENT_READBACK_PENDING: new Set(["OBSERVE_PENDING"]),
  OBSERVE_PENDING: new Set(["FINAL_ACCEPTANCE_PENDING"]),
  FINAL_ACCEPTANCE_PENDING: new Set(["CLOSURE_PENDING"]),
  CLOSURE_PENDING: new Set(["COMPLETED"]),
});
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SMART_DESK_DENY = [
  /^smartdesk-live(?:\/|$)/,
  /^services\/universal-core-service\/branches\/branch-smartdesk-operations-guard\.js$/,
  /^personal-control-center\/data\/nyra-deep-branch-v2\.shards\/.*\/smartdesk_domain--.*\.json\.gz$/,
];

function fail(code) { throw new Error(code); }
function text(value, code, maximum = 4_000) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum || normalized.includes("\u0000")) fail(code);
  return normalized;
}
function digest(value, code) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!DIGEST.test(normalized)) fail(code);
  return normalized;
}
function normalizeList(value, max = 200) {
  if (!Array.isArray(value) || value.length > max) fail("nyra_automation_lifecycle_dependency_invalid");
  const values = value.map((item) => text(item, "nyra_automation_lifecycle_dependency_invalid", 100));
  if (new Set(values).size !== values.length) fail("nyra_automation_lifecycle_dependency_invalid");
  return values;
}
function sha(value, code) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA.test(normalized)) fail(code);
  return normalized;
}
function iso(now) {
  const value = typeof now === "function" ? now() : now;
  const parsed = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) fail("nyra_automation_clock_invalid");
  return new Date(parsed).toISOString();
}
function normalizedPaths(values, code, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length < 1) || values.length > 10_000) fail(code);
  const result = values.map((entry) => text(entry, code, 800).replace(/^\.\//, ""));
  if (result.some((entry) => entry.startsWith("/") || entry.includes("\\") || entry.split("/").some((part) => !part || part === "." || part === ".."))) fail(code);
  const stable = [...new Set(result)].sort();
  if (stable.length !== result.length) fail(code);
  return stable;
}
function lifecycleDag(value, allowedPaths) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema_version !== "nyra_branch_lifecycle_dag_v1") fail("nyra_automation_lifecycle_dag_invalid");
  if (!Array.isArray(value.tasks) || value.tasks.length < 2 || value.tasks.length > 200) fail("nyra_automation_lifecycle_dag_invalid");
  const ids = new Set(); const worktrees = new Set(); const branches = new Set(); const tasks = [];
  for (const raw of value.tasks) {
    const task_id = text(raw?.task_id, "nyra_automation_lifecycle_task_invalid", 100);
    if (!/^[a-z][a-z0-9_-]{1,99}$/.test(task_id) || ids.has(task_id)) fail("nyra_automation_lifecycle_task_invalid");
    const role = text(raw?.role, "nyra_automation_lifecycle_task_invalid", 30);
    if (!['builder', 'verifier'].includes(role)) fail("nyra_automation_lifecycle_task_invalid");
    const branch = text(raw?.branch, "nyra_automation_lifecycle_task_invalid", 240);
    const worktree_id = text(raw?.worktree_id, "nyra_automation_lifecycle_task_invalid", 160);
    if (branches.has(branch) || worktrees.has(worktree_id)) fail("nyra_automation_lifecycle_isolation_required");
    const taskPaths = normalizedPaths(raw?.allowed_paths, "nyra_automation_lifecycle_task_paths_invalid");
    if (taskPaths.some((file) => !allowedPaths.includes(file) && !allowedPaths.some((allowed) => allowed.endsWith('/**') && (file === allowed.slice(0, -3) || file.startsWith(`${allowed.slice(0, -3)}/`))))) fail("nyra_automation_lifecycle_task_paths_invalid");
    const depends_on = normalizeList(raw?.depends_on, 200);
    if (depends_on.includes(task_id)) fail("nyra_automation_lifecycle_cycle");
    ids.add(task_id); branches.add(branch); worktrees.add(worktree_id);
    tasks.push({ task_id, role, branch, worktree_id, allowed_paths: taskPaths, depends_on });
  }
  if (!tasks.some((task) => task.role === 'builder') || !tasks.some((task) => task.role === 'verifier')) fail("nyra_automation_lifecycle_roles_required");
  if (tasks.some((task) => task.depends_on.some((id) => !ids.has(id)))) fail("nyra_automation_lifecycle_dependency_invalid");
  const unresolved = new Map(tasks.map((task) => [task.task_id, new Set(task.depends_on)]));
  while (unresolved.size) {
    const ready = [...unresolved.entries()].filter(([, dependencies]) => [...dependencies].every((id) => !unresolved.has(id))).map(([id]) => id);
    if (!ready.length) fail("nyra_automation_lifecycle_cycle");
    ready.forEach((id) => unresolved.delete(id));
  }
  return { schema_version: "nyra_branch_lifecycle_dag_v1", tasks };
}
function clone(value) { return structuredClone(value); }
function validateRecord(record, workId) {
  if (!record || record.schema_version !== NYRA_WORK_AUTOMATION_VERSION || record.work_id !== workId || !NYRA_WORK_AUTOMATION_STATES.includes(record.state)) fail("nyra_automation_store_record_invalid");
  if (!Array.isArray(record.events) || record.events.length !== record.revision) fail("nyra_automation_event_chain_invalid");
  let previous = null;
  for (let index = 0; index < record.events.length; index += 1) {
    const current = record.events[index];
    const unsigned = { sequence_number: current.sequence_number, event_type: current.event_type, at: current.at, previous_event_hash: current.previous_event_hash, payload: current.payload };
    if (current.sequence_number !== index + 1 || current.previous_event_hash !== previous || current.event_hash !== nyraDigest(unsigned)) fail("nyra_automation_event_chain_invalid");
    previous = current.event_hash;
  }
  if (record.record_digest !== nyraDigest({ ...record, record_digest: undefined })) fail("nyra_automation_record_digest_invalid");
}
function validateStore(state) {
  if (!state || state.schema_version !== "nyra_work_automation_store_v1" || !state.records || typeof state.records !== "object" || Array.isArray(state.records)) fail("nyra_automation_store_invalid");
  for (const [workId, record] of Object.entries(state.records)) validateRecord(record, workId);
  return state;
}
function event(record, event_type, payload, at) {
  const previous = record.events.at(-1)?.event_hash || null;
  const unsigned = {
    sequence_number: record.events.length + 1,
    event_type,
    at,
    previous_event_hash: previous,
    payload: clone(payload),
  };
  const next = { ...unsigned, event_hash: nyraDigest(unsigned) };
  record.events.push(next);
  record.updated_at = at;
  record.revision += 1;
  record.record_digest = nyraDigest({ ...record, record_digest: undefined });
  return next;
}
function assertStageArtifact(nextState, input) {
  const required = {
    BUILDER_PENDING: ["builder_binding", "nyra_authoritative_builder_binding_v1"],
    COMMIT_READBACK_PENDING: ["commit_readback", "nyra_authoritative_commit_readback_v1"],
    BUILDER_REPORT_PENDING: ["commit_attestation", "nyra_commit_attestation_v2"],
    PUSH_PENDING: ["builder_report", "nyra_internal_capability_receipt_v1"],
    DRAFT_PR_PENDING: ["push_receipt", "host_native_action_completion_receipt_v1"],
    CI_WAIT: ["pull_request", "nyra_authoritative_pull_request_readback_v1"],
    VERIFIER_PENDING: ["ci_attestation", "nyra_ci_verification_attestation_v2"],
    CORE_JOIN_PENDING: ["criterion_readiness", "nyra_ci_criterion_proofs_v1"],
    MERGE_PENDING: ["core_join", "host_native_core_join_verdict_v1"],
    DEPLOYMENT_READBACK_PENDING: ["merge_readback", "nyra_authoritative_merge_readback_v1"],
    OBSERVE_PENDING: ["deployment_readback", "nyra_authoritative_deployment_readback_v1"],
    FINAL_ACCEPTANCE_PENDING: ["service_observations", "nyra_service_observations_v1"],
    CLOSURE_PENDING: ["final_acceptance", "intent_final_acceptance_proof_v1"],
    COMPLETED: ["closure", "nyra_authoritative_closure_receipt_v1"],
  }[nextState];
  if (!required) return;
  if (input.artifact_name !== required[0] || input.artifact?.schema_version !== required[1] || !DIGEST.test(String(input.evidence_digest || ""))) fail("nyra_automation_stage_evidence_required");
  const artifactDigest = input.artifact.receipt_digest || input.artifact.readback_digest || input.artifact.verdict_digest || input.artifact.closure_digest || input.artifact.binding_digest || nyraDigest(input.artifact);
  if (input.evidence_digest !== artifactDigest) fail("nyra_automation_stage_evidence_mismatch");
}

export function assertNyraAutomationPaths({ allowed_paths, changed_files }) {
  const allowed = normalizedPaths(allowed_paths, "nyra_automation_allowed_paths_invalid");
  const changed = normalizedPaths(changed_files, "nyra_automation_changed_files_invalid", { allowEmpty: true });
  if (changed.some((file) => SMART_DESK_DENY.some((pattern) => pattern.test(file)))) fail("nyra_automation_smart_desk_denied");
  const exact = new Set(allowed);
  const prefixes = allowed.filter((value) => value.endsWith("/**")).map((value) => value.slice(0, -3));
  if (changed.some((file) => !exact.has(file) && !prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)))) {
    fail("nyra_automation_path_outside_mandate");
  }
  return changed;
}

export function createNyraMemoryStore(initial = null) {
  let state = initial ? clone(initial) : { schema_version: "nyra_work_automation_store_v1", records: {} };
  return Object.freeze({
    kind: "memory_cas",
    restart_durable: false,
    async read() { return clone(validateStore(state)); },
    async compareAndSwap(expectedDigest, next) {
      const currentDigest = nyraDigest(state);
      if (expectedDigest !== currentDigest) return false;
      state = clone(validateStore(next));
      return true;
    },
  });
}

export function createNyraFileStore({ filePath, lockLeaseMs = 15_000, now = () => Date.now() }) {
  const target = path.resolve(text(filePath, "nyra_automation_store_path_invalid", 2_000));
  const lockPath = `${target}.lock`;
  async function read() {
    try { return validateStore(JSON.parse(await fs.promises.readFile(target, "utf8"))); }
    catch (error) {
      if (error?.code === "ENOENT") return { schema_version: "nyra_work_automation_store_v1", records: {} };
      throw error;
    }
  }
  async function compareAndSwap(expectedDigest, next) {
    await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    let handle;
    let temporary = null;
    try {
      for (let attempt = 0; attempt < 2 && !handle; attempt += 1) {
        try {
          handle = await fs.promises.open(lockPath, "wx", 0o600);
          const acquiredAt = Number(typeof now === "function" ? now() : now);
          await handle.writeFile(JSON.stringify({ schema_version: "nyra_work_automation_lock_v1", pid: process.pid, fencing_token: crypto.randomUUID(), acquired_at: new Date(acquiredAt).toISOString(), expires_at: new Date(acquiredAt + lockLeaseMs).toISOString() }));
          await handle.sync();
        } catch (error) {
          if (error?.code !== "EEXIST" || attempt > 0) throw error;
          let stale = false;
          try {
            const lock = JSON.parse(await fs.promises.readFile(lockPath, "utf8"));
            let pidAlive = true;
            if (Number.isSafeInteger(lock.pid) && lock.pid > 0) {
              try { process.kill(lock.pid, 0); } catch (error) { pidAlive = error?.code === "EPERM"; }
            }
            stale = Number.isSafeInteger(lock.pid) && lock.pid > 0 && !pidAlive && Date.parse(lock.expires_at) <= Number(typeof now === "function" ? now() : now);
          } catch { stale = false; }
          if (!stale) fail("nyra_automation_store_busy");
          await fs.promises.unlink(lockPath);
        }
      }
      const current = await read();
      if (nyraDigest(current) !== expectedDigest) return false;
      validateStore(next);
      temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
      const output = `${JSON.stringify(next)}\n`;
      const tempHandle = await fs.promises.open(temporary, "wx", 0o600);
      try { await tempHandle.writeFile(output); await tempHandle.sync(); } finally { await tempHandle.close(); }
      await fs.promises.rename(temporary, target);
      const directory = await fs.promises.open(path.dirname(target), "r");
      try { await directory.sync(); } finally { await directory.close(); }
      return true;
    } catch (error) {
      if (error?.code === "EEXIST") fail("nyra_automation_store_busy");
      throw error;
    } finally {
      if (temporary) await fs.promises.unlink(temporary).catch(() => {});
      await handle?.close();
      if (handle) await fs.promises.unlink(lockPath).catch(() => {});
    }
  }
  return Object.freeze({ kind: "file_atomic_cas", restart_durable: true, lock_protocol: "pid_lease_bounded_recovery_v1", read, compareAndSwap });
}

export function createNyraWorkAutomationRuntime({ store = createNyraMemoryStore(), now = () => Date.now(), maxCasAttempts = 8, reconciliationVerifier = null } = {}) {
  async function mutate(workId, operation) {
    for (let attempt = 0; attempt < maxCasAttempts; attempt += 1) {
      const state = validateStore(await store.read());
      const expected = nyraDigest(state);
      const record = state.records[workId];
      const result = await operation(state, record);
      if (await store.compareAndSwap(expected, state)) return clone(result);
    }
    fail("nyra_automation_store_conflict");
  }
  function getRecord(state, tenantId, workId) {
    const record = state.records[workId];
    if (!record || record.tenant_id !== tenantId) fail("nyra_automation_work_not_found");
    return record;
  }
  const api = {
    version: NYRA_WORK_AUTOMATION_VERSION,
    storage: Object.freeze({ kind: store.kind || "custom_cas", restart_durable: store.restart_durable === true, lock_protocol: store.lock_protocol || null }),
    async create(input) {
      const tenantId = text(input.tenant_id, "nyra_automation_tenant_invalid", 240);
      const workId = text(input.work_id, "nyra_automation_work_invalid", 240);
      const objective = text(input.intent_objective, "nyra_automation_objective_invalid");
      const intentDigest = digest(input.intent_anchor_digest, "nyra_automation_intent_invalid");
      const taskObjectiveDigest = digest(input.task_objective_digest, "nyra_automation_task_objective_invalid");
      if (taskObjectiveDigest !== nyraDigest(objective)) fail("nyra_automation_task_objective_mismatch");
      const allowedPaths = normalizedPaths(input.allowed_paths, "nyra_automation_allowed_paths_invalid");
      if (allowedPaths.some((file) => SMART_DESK_DENY.some((pattern) => pattern.test(file)))) fail("nyra_automation_smart_desk_denied");
      const skills = [...new Set((input.advisory_capabilities || []).map((item) => text(item, "nyra_automation_capabilities_invalid", 160)))].sort();
      if (skills.length > 6) fail("nyra_automation_capability_budget_exceeded");
      const orchestrationDag = input.lifecycle_dag ? lifecycleDag(input.lifecycle_dag, allowedPaths) : null;
      return mutate(workId, (state, existing) => {
        if (existing) {
          if (existing.tenant_id !== tenantId || existing.intent_anchor_digest !== intentDigest || existing.task_objective_digest !== taskObjectiveDigest) fail("nyra_automation_idempotency_conflict");
          return existing;
        }
        const at = iso(now);
        const record = {
          schema_version: NYRA_WORK_AUTOMATION_VERSION,
          tenant_id: tenantId, work_id: workId, intent_anchor_digest: intentDigest,
          intent_objective: objective, task_objective_digest: taskObjectiveDigest,
          repository: text(input.repository, "nyra_automation_repository_invalid", 240),
          base_branch: text(input.base_branch, "nyra_automation_base_branch_invalid", 240),
          delivery_branch: text(input.delivery_branch, "nyra_automation_delivery_branch_invalid", 240),
          base_commit: sha(input.base_commit, "nyra_automation_base_commit_invalid"),
          allowed_paths: allowedPaths, advisory_capabilities: skills, lifecycle_dag: orchestrationDag,
          state: "PLAN_PENDING", active_builder: null, system_verifier: null,
          attempts: {}, consumed_receipt_ids: [], artifacts: { intent_readback: clone(input.intent_readback) }, events: [],
          revision: 0, created_at: at, updated_at: at,
        };
        event(record, "automation_created", { task_objective_digest: taskObjectiveDigest }, at);
        state.records[workId] = record;
        return record;
      });
    },
    async read({ tenant_id, work_id, includePrivate = false }) {
      const state = validateStore(await store.read());
      const record = clone(getRecord(state, text(tenant_id, "nyra_automation_tenant_invalid"), text(work_id, "nyra_automation_work_invalid")));
      if (!includePrivate) {
        delete record.consumed_receipt_ids;
        record.artifacts = Object.fromEntries(Object.entries(record.artifacts || {}).map(([name, artifact]) => [name, {
          schema_version: artifact?.schema_version || null,
          digest: artifact?.receipt_digest || artifact?.readback_digest || artifact?.verdict_digest || artifact?.closure_digest || nyraDigest(artifact),
        }]));
        record.events = record.events.map((item) => ({ sequence_number: item.sequence_number, event_type: item.event_type, at: item.at, previous_event_hash: item.previous_event_hash, event_hash: item.event_hash }));
      }
      return record;
    },
    async transition(input) {
      const tenantId = text(input.tenant_id, "nyra_automation_tenant_invalid");
      const workId = text(input.work_id, "nyra_automation_work_invalid");
      const expectedState = text(input.expected_state, "nyra_automation_expected_state_invalid", 100);
      const nextState = text(input.next_state, "nyra_automation_next_state_invalid", 100);
      if (!NYRA_WORK_AUTOMATION_STATES.includes(nextState)) fail("nyra_automation_next_state_invalid");
      return mutate(workId, (_state, existing) => {
        const record = existing && existing.tenant_id === tenantId ? existing : fail("nyra_automation_work_not_found");
        if (record.state !== expectedState) fail("nyra_automation_state_conflict");
        if (TERMINAL.has(record.state)) fail("nyra_automation_terminal");
        if (!TRANSITIONS[record.state]?.has(nextState) && !["BLOCKED", "CANCELLED", "QUARANTINED"].includes(nextState)) {
          fail("nyra_automation_transition_denied");
        }
        if (input.changed_files) assertNyraAutomationPaths({ allowed_paths: record.allowed_paths, changed_files: input.changed_files });
        if (!["BLOCKED", "CANCELLED", "QUARANTINED"].includes(nextState)) assertStageArtifact(nextState, input);
        const attemptKey = `${expectedState}->${nextState}`;
        record.attempts[attemptKey] = Number(record.attempts[attemptKey] || 0) + 1;
        if (record.attempts[attemptKey] > 3) fail("nyra_automation_attempt_budget_exceeded");
        if (input.receipt_id) {
          const receiptId = text(input.receipt_id, "nyra_automation_receipt_id_invalid", 240);
          if (input.artifact?.receipt_digest !== receiptId) fail("nyra_automation_receipt_binding_mismatch");
          if (record.consumed_receipt_ids.includes(receiptId)) fail("nyra_automation_receipt_replayed");
          record.consumed_receipt_ids.push(receiptId);
        }
        if (nextState === "BUILDING") {
          const binding = record.artifacts?.builder_binding;
          const builder = text(input.actor_id, "nyra_automation_builder_invalid", 160);
          if (!binding || binding.builder_agent_id !== builder || binding.session_fingerprint !== input.session_fingerprint || Date.parse(binding.expires_at || "") <= Number(typeof now === "function" ? now() : now)) fail("nyra_automation_builder_binding_mismatch");
          if (record.active_builder && record.active_builder !== builder) fail("nyra_automation_builder_parallelism_denied");
          record.active_builder = builder;
        }
        if (nextState === "VERIFIER_PENDING") {
          const verifier = text(input.actor_id, "nyra_automation_verifier_invalid", 160);
          if (verifier === record.active_builder) fail("nyra_automation_independent_verifier_required");
          record.system_verifier = verifier;
        }
        record.state = nextState;
        if (input.artifact_name) record.artifacts[text(input.artifact_name, "nyra_automation_artifact_invalid", 160)] = clone(input.artifact);
        event(record, "automation_transitioned", { from: expectedState, to: nextState, evidence_digest: input.evidence_digest || null }, iso(now));
        return record;
      });
    },
    async reconcileUnknown(input) {
      if (typeof reconciliationVerifier !== "function") fail("nyra_automation_reconciliation_verifier_unavailable");
      const record = await api.read({ tenant_id: input.tenant_id, work_id: input.work_id, includePrivate: true });
      const verified = await reconciliationVerifier(input, record);
      if (verified?.authoritative !== true || !String(verified.verifier_id || "").startsWith("core_server_") || verified.tenant_id !== record.tenant_id || verified.work_id !== record.work_id || verified.intent_anchor_digest !== record.intent_anchor_digest || !DIGEST.test(String(verified.readback_digest || "")) || nyraDigest({ ...verified, readback_digest: undefined }) !== verified.readback_digest) fail("nyra_automation_authoritative_readback_mismatch");
      const verifiedAt = Date.parse(verified.verified_at || "");
      const current = Number(typeof now === "function" ? now() : now);
      if (!Number.isFinite(verifiedAt) || verifiedAt > current + 30_000 || current - verifiedAt > 300_000) fail("nyra_automation_authoritative_readback_stale");
      return api.transition({ ...input, artifact_name: verified.artifact_name, artifact: verified.artifact, evidence_digest: verified.artifact?.receipt_digest || verified.artifact?.readback_digest || verified.artifact?.verdict_digest || verified.artifact?.closure_digest, receipt_id: verified.artifact?.receipt_digest });
    },
    async completeFromPostReleaseReconciliation(input) {
      if (typeof reconciliationVerifier !== "function") fail("nyra_automation_reconciliation_verifier_unavailable");
      const tenantId = text(input.tenant_id, "nyra_automation_tenant_invalid");
      const workId = text(input.work_id, "nyra_automation_work_invalid");
      return mutate(workId, async (_state, record) => {
        if (!record || record.tenant_id !== tenantId) fail("nyra_automation_work_not_found");
        const verified = await reconciliationVerifier({ ...input, reconciliation_kind: "post_release_completion" }, clone(record));
        const valid = verified?.schema_version === "nyra_authoritative_post_release_reconciliation_v1" &&
          verified.authoritative === true && String(verified.verifier_id || "").startsWith("core_server_") &&
          verified.tenant_id === record.tenant_id && verified.work_id === record.work_id &&
          verified.intent_anchor_digest === record.intent_anchor_digest && verified.repository === record.repository &&
          verified.delivery_branch === record.delivery_branch && verified.head_commit === record.artifacts?.commit_attestation?.commit &&
          SHA.test(String(verified.merge_commit || "")) && verified.live_commit === verified.merge_commit &&
          verified.final_acceptance_proven === true && Array.isArray(verified.services) && verified.services.length > 0 &&
          verified.services.every((service) => service?.health_status === "healthy" && service.live_commit === verified.live_commit) &&
          DIGEST.test(String(verified.reconciliation_digest || "")) && nyraDigest({ ...verified, reconciliation_digest: undefined }) === verified.reconciliation_digest;
        if (!valid) fail("nyra_automation_post_release_reconciliation_invalid");
        if (record.state === "COMPLETED") {
          if (record.artifacts?.post_release_reconciliation?.reconciliation_digest !== verified.reconciliation_digest) fail("nyra_automation_reconciliation_idempotency_conflict");
          return record;
        }
        if (TERMINAL.has(record.state)) fail("nyra_automation_terminal");
        const previousState = record.state;
        record.state = "COMPLETED";
        record.artifacts.post_release_reconciliation = clone(verified);
        event(record, "post_release_reconciled_and_completed", { from: previousState, reconciliation_digest: verified.reconciliation_digest }, iso(now));
        return record;
      });
    },
  };
  return Object.freeze(api);
}
