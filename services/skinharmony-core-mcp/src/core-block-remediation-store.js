import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CORE_BLOCK_REMEDIATION_SCHEMA_VERSION,
  CORE_BLOCK_REMEDIATION_STATUS,
  assertSameTenant,
  assertTransitionAllowed,
  normalizeRemediationList,
  sha256,
} from "../../shared/core-block-remediation.js";

function tenantId(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(normalized)) throw new Error("tenant_invalid");
  return normalized;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanState(value) {
  const state = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : { schema_version: CORE_BLOCK_REMEDIATION_SCHEMA_VERSION, version: 0, remediations: [], idempotency: {} };
  if (!Array.isArray(state.remediations)) state.remediations = [];
  if (!state.idempotency || typeof state.idempotency !== "object" || Array.isArray(state.idempotency)) state.idempotency = {};
  state.schema_version = CORE_BLOCK_REMEDIATION_SCHEMA_VERSION;
  state.version = Number.isInteger(state.version) && state.version >= 0 ? state.version : 0;
  return state;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function remediationTenantRoot(config = {}, options = {}) {
  const root = String(
    options.root ||
    config.sharedMemoryRoot ||
    config.agentWorkspaceRoot ||
    path.join(process.cwd(), "storage"),
  ).trim();
  return path.resolve(root, "core-block-remediations");
}

function tenantRoot(root, tenant) {
  const resolvedRoot = path.resolve(root);
  const tenantDir = tenantId(tenant);
  const resolved = path.resolve(resolvedRoot, tenantDir);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("tenant_path_rejected");
  return resolved;
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
  throw new Error("workspace_busy");
}

function releaseLock(lock) {
  try { fs.closeSync(lock.handle); } catch {}
  try { fs.unlinkSync(lock.lockPath); } catch {}
}

function readTenantState(root, tenant) {
  const dir = tenantRoot(root, tenant);
  const file = path.join(dir, "core-block-remediations.json");
  if (!fs.existsSync(file)) {
    return cleanState();
  }
  return cleanState(JSON.parse(fs.readFileSync(file, "utf8")));
}

async function updateTenantState(root, tenant, mutate) {
  const dir = tenantRoot(root, tenant);
  const lock = await acquireLock(dir);
  try {
    const state = readTenantState(root, tenant);
    const result = await mutate(state);
    state.version += 1;
    const file = path.join(dir, "core-block-remediations.json");
    const temp = path.join(dir, `.core-block-remediations-${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
    return { result, version: state.version };
  } finally {
    releaseLock(lock);
  }
}

function canonicalRecord(remediation) {
  const clone = JSON.parse(JSON.stringify(remediation));
  clone.contract_digest = null;
  clone.contract_digest = digest(clone);
  return clone;
}

function indexBy(remediations, key) {
  return new Map(remediations.map((record) => [record[key], record]).filter(([value]) => Boolean(value)));
}

function idempotencyKey(remediation_id, key) {
  return `${String(remediation_id || "").trim()}::${String(key || "").trim()}`;
}

export function createCoreBlockRemediationStore(config = {}, options = {}) {
  const root = remediationTenantRoot(config, options);

  async function list(tenant, { work_id, status } = {}) {
    const state = readTenantState(root, tenant);
    const items = normalizeRemediationList(state.remediations).filter((record) => {
      if (work_id && record.work_id !== work_id) return false;
      if (status && record.status !== status) return false;
      return true;
    });
    return items.sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
  }

  async function findById({ tenant_id, remediation_id }) {
    const state = readTenantState(root, tenant_id);
    return normalizeRemediationList(state.remediations).find((record) => record.remediation_id === remediation_id) || null;
  }

  async function findByOriginalDecision({ tenant_id, decision_id }) {
    const state = readTenantState(root, tenant_id);
    return normalizeRemediationList(state.remediations).find((record) => record.original_decision?.decision_id === decision_id) || null;
  }

  async function findIdempotency({ tenant_id, remediation_id, idempotency_key }) {
    const state = readTenantState(root, tenant_id);
    return state.idempotency?.[idempotencyKey(remediation_id, idempotency_key)] || null;
  }

  async function rememberIdempotency({ tenant_id, remediation_id, idempotency_key, proposal_digest, result }) {
    const tenant = tenantId(tenant_id);
    const key = idempotencyKey(remediation_id, idempotency_key);
    const transaction = await updateTenantState(root, tenant, async (state) => {
      state.idempotency[key] = {
        remediation_id,
        idempotency_key,
        proposal_digest,
        result,
        updated_at: new Date().toISOString(),
      };
      return state.idempotency[key];
    });
    return transaction.result;
  }

  async function create(remediation) {
    const tenant = tenantId(remediation.tenant_id);
    assertSameTenant(tenant, remediation.tenant_id);
    const existing = await findByOriginalDecision({ tenant_id: tenant, decision_id: remediation.original_decision.decision_id });
    if (existing) return existing;
    const payload = canonicalRecord(remediation);
    const transaction = await updateTenantState(root, tenant, async (state) => {
      const remediations = normalizeRemediationList(state.remediations);
      remediations.push(payload);
      state.remediations = remediations;
      return payload;
    });
    return { ...transaction.result, version: transaction.version };
  }

  async function update({ tenant_id, remediation_id, expected_version, mutate }) {
    const tenant = tenantId(tenant_id);
    const transaction = await updateTenantState(root, tenant, async (state) => {
      const remediations = normalizeRemediationList(state.remediations);
      const index = remediations.findIndex((item) => item.remediation_id === remediation_id);
      if (index < 0) throw new Error("remediation_not_found");
      const current = remediations[index];
      if (Number(expected_version) !== Number(current.version)) throw new Error("remediation_version_conflict");
      const next = await mutate(JSON.parse(JSON.stringify(current)));
      if (!next || typeof next !== "object" || Array.isArray(next)) throw new Error("remediation_update_invalid");
      if (next.tenant_id !== current.tenant_id ||
          next.original_decision?.decision_id !== current.original_decision?.decision_id ||
          next.bound_scope?.scope_digest !== current.bound_scope?.scope_digest) {
        throw new Error("remediation_immutable_identity_changed");
      }
      next.version = Number(current.version) + 1;
      next.updated_at = new Date().toISOString();
      next.contract_digest = null;
      next.contract_digest = digest(next);
      remediations[index] = next;
      state.remediations = remediations;
      return next;
    });
    return transaction.result;
  }

  async function attachNyraReview({ tenant_id, remediation_id, expected_version, review }) {
    return update({
      tenant_id,
      remediation_id,
      expected_version,
      mutate: async (current) => {
        const nextStatus = review.status === "approve_for_core"
          ? CORE_BLOCK_REMEDIATION_STATUS.NYRA_REVIEWED
          : review.status === "request_revision"
            ? CORE_BLOCK_REMEDIATION_STATUS.REVISION_REQUIRED
            : CORE_BLOCK_REMEDIATION_STATUS.HARD_DENIED;
        assertTransitionAllowed(current.status, nextStatus);
        current.nyra_review = review;
        current.status = nextStatus;
        return current;
      },
    });
  }

  async function appendAttempt({ tenant_id, remediation_id, expected_version, attempt, next_status }) {
    return update({
      tenant_id,
      remediation_id,
      expected_version,
      mutate: async (current) => {
        const nextStatus = next_status || CORE_BLOCK_REMEDIATION_STATUS.PROPOSAL_READY;
        if (current.status === CORE_BLOCK_REMEDIATION_STATUS.OPEN && nextStatus === CORE_BLOCK_REMEDIATION_STATUS.WAITING_OWNER) {
          assertTransitionAllowed(current.status, nextStatus);
        } else if (current.status === CORE_BLOCK_REMEDIATION_STATUS.OPEN) {
          assertTransitionAllowed(current.status, CORE_BLOCK_REMEDIATION_STATUS.DIAGNOSING);
          assertTransitionAllowed(CORE_BLOCK_REMEDIATION_STATUS.DIAGNOSING, nextStatus);
        } else assertTransitionAllowed(current.status, nextStatus);
        current.attempts = [...normalizeRemediationList(current.attempts), attempt];
        current.attempt_count = Number(current.attempt_count || 0) + 1;
        current.status = nextStatus;
        current.diagnosis = {
          ...(current.diagnosis || {}),
          status: "submitted",
          submitted_by: attempt.submitted_by,
          root_cause: attempt.diagnosis?.root_cause || null,
          evidence: attempt.diagnosis?.evidence || [],
          unknowns: attempt.diagnosis?.unknowns || [],
          affected_components: attempt.diagnosis?.affected_components || [],
          submitted_at: attempt.created_at,
          diagnosis_digest: digest(attempt.diagnosis || {}),
        };
        return current;
      },
    });
  }

  async function appendAttemptIdempotent({ tenant_id, remediation_id, expected_version, attempt, next_status,
    idempotency_key, proposal_digest }) {
    const tenant = tenantId(tenant_id);
    const key = idempotencyKey(remediation_id, idempotency_key);
    const transaction = await updateTenantState(root, tenant, async (state) => {
      const replay = state.idempotency?.[key];
      if (replay) {
        if (replay.proposal_digest !== proposal_digest) throw new Error("core_block_remediation_replay_rejected");
        return { idempotent: true, remediation: replay.result?.remediation || null };
      }
      const remediations = normalizeRemediationList(state.remediations);
      const index = remediations.findIndex((item) => item.remediation_id === remediation_id);
      if (index < 0) throw new Error("remediation_not_found");
      const current = remediations[index];
      if (Number(current.version) !== Number(expected_version)) throw new Error("remediation_version_conflict");
      const next = JSON.parse(JSON.stringify(current));
      const nextStatus = next_status || CORE_BLOCK_REMEDIATION_STATUS.PROPOSAL_READY;
      if (next.status === CORE_BLOCK_REMEDIATION_STATUS.OPEN && nextStatus === CORE_BLOCK_REMEDIATION_STATUS.WAITING_OWNER) {
        assertTransitionAllowed(next.status, nextStatus);
      } else if (next.status === CORE_BLOCK_REMEDIATION_STATUS.OPEN) {
        assertTransitionAllowed(next.status, CORE_BLOCK_REMEDIATION_STATUS.DIAGNOSING);
        assertTransitionAllowed(CORE_BLOCK_REMEDIATION_STATUS.DIAGNOSING, nextStatus);
      } else assertTransitionAllowed(next.status, nextStatus);
      next.attempts = [...normalizeRemediationList(next.attempts), attempt];
      next.attempt_count = Number(next.attempt_count || 0) + 1;
      next.status = nextStatus;
      next.diagnosis = { ...(next.diagnosis || {}), status: "submitted", submitted_by: attempt.submitted_by,
        root_cause: attempt.diagnosis?.root_cause || null, evidence: attempt.diagnosis?.evidence || [],
        unknowns: attempt.diagnosis?.unknowns || [], affected_components: attempt.diagnosis?.affected_components || [],
        submitted_at: attempt.created_at, diagnosis_digest: digest(attempt.diagnosis || {}) };
      next.version = Number(current.version) + 1;
      next.updated_at = new Date().toISOString();
      next.contract_digest = null;
      next.contract_digest = digest(next);
      remediations[index] = next;
      state.remediations = remediations;
      state.idempotency[key] = { remediation_id, idempotency_key, proposal_digest,
        result: { remediation: next }, updated_at: next.updated_at };
      return { idempotent: false, remediation: next };
    });
    return transaction.result;
  }

  async function markStatus({ tenant_id, remediation_id, expected_version, status, fields = {} }) {
    return update({
      tenant_id,
      remediation_id,
      expected_version,
      mutate: async (current) => {
        assertTransitionAllowed(current.status, status);
        current.status = status;
        Object.assign(current, fields);
        return current;
      },
    });
  }

  async function recordResubmission({ tenant_id, remediation_id, expected_version, resubmission }) {
    return update({
      tenant_id,
      remediation_id,
      expected_version,
      mutate: async (current) => {
        assertTransitionAllowed(current.status, CORE_BLOCK_REMEDIATION_STATUS.RESUBMITTED);
        current.resubmission = resubmission;
        current.status = CORE_BLOCK_REMEDIATION_STATUS.RESUBMITTED;
        return current;
      },
    });
  }

  async function recordOutcome({ tenant_id, remediation_id, expected_version, outcome }) {
    return update({
      tenant_id,
      remediation_id,
      expected_version,
      mutate: async (current) => {
        current.outcome = { ...(current.outcome || {}), ...outcome };
        return current;
      },
    });
  }

  async function cancel({ tenant_id, remediation_id, expected_version, reason }) {
    return markStatus({
      tenant_id,
      remediation_id,
      expected_version,
      status: CORE_BLOCK_REMEDIATION_STATUS.CANCELLED,
      fields: { cancel_reason: reason || "cancelled" },
    });
  }

  async function listBlockers(tenant_id) {
    return list(tenant_id);
  }

  return {
    root,
    list,
    listBlockers,
    findById,
    findByOriginalDecision,
    findIdempotency,
    rememberIdempotency,
    create,
    update,
    attachNyraReview,
    appendAttempt,
    appendAttemptIdempotent,
    markStatus,
    recordResubmission,
    recordOutcome,
    cancel,
  };
}
