import crypto from "node:crypto";

export const SHARED_MEMORY_BOOTSTRAP_PATHS = Object.freeze([
  "SHARED_MEMORY/INDEX.md",
  "SHARED_MEMORY/STATE.json",
  "SHARED_MEMORY/TASKS.json",
  "SHARED_MEMORY/LOCKS.json",
  "SHARED_MEMORY/ARTIFACTS.json",
  "SHARED_MEMORY/HANDOFF.md",
  "SHARED_MEMORY/handoffs/MCP_STAGING_MULTI_SESSION_COORDINATION_2026-07-21.md",
  "SHARED_MEMORY/snapshots/WORK_SNAPSHOT.md",
]);

const MAX_CACHE_MS = 300_000;
const RECENT_LIMIT = 5;

function safeTenant(value) {
  const tenantId = String(value || "");
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(tenantId)) throw new Error("tenant_invalid");
  return tenantId;
}

function parseJsonDocument(record) {
  try {
    const parsed = JSON.parse(String(record?.content || ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`shared_memory_bootstrap_invalid_json:${record?.source_path || "unknown"}`);
  }
}

function compactTask(task = {}) {
  return {
    contract_id: task.contract_id ?? null,
    trace_id: task.trace_id ?? null,
    agent_id: task.agent_id ?? null,
    session_id: task.session_id ?? null,
    agent_signature: task.agent_signature ?? null,
    session_fingerprint: task.session_fingerprint ?? null,
    title: String(task.title || "Untitled task").slice(0, 240),
    status: String(task.status || "current").slice(0, 80),
    updated_at: task.updated_at ?? null,
    source: task.source ?? null,
  };
}

function compactArtifact(artifact = {}) {
  return {
    path: artifact.path ?? null,
    size_bytes: Number(artifact.size_bytes) || 0,
    modified_at: artifact.modified_at ?? null,
    sha256: /^[a-f0-9]{64}$/.test(String(artifact.sha256 || "")) ? artifact.sha256 : null,
  };
}

function compactLock(lock = {}) {
  return {
    name: lock.name ?? null,
    trace_id: lock.trace_id ?? null,
    agent_id: lock.agent_id ?? null,
    session_id: lock.session_id ?? null,
    agent_signature: lock.agent_signature ?? null,
    session_fingerprint: lock.session_fingerprint ?? null,
    acquired_at: lock.acquired_at ?? null,
    source: lock.source ?? null,
  };
}

function canonicalCollection(document, key, label) {
  const values = document?.[key];
  const count = Number(document?.count);
  if (!Array.isArray(values) || !Number.isSafeInteger(count) || count < 0 || count !== values.length) {
    throw new Error(`shared_memory_bootstrap_inconsistent:${label}`);
  }
  return values;
}

function requireCanonicalTenant(tenantId, ...documents) {
  if (documents.some((document) => document?.tenant !== tenantId)) {
    throw new Error("shared_memory_bootstrap_tenant_mismatch");
  }
}

function coordinationBinding(identity, tasks, locks) {
  const presence = identity?.agentPresence || {};
  const agentId = String(presence.agent_id || "").trim();
  const sessionId = String(presence.session_id || "").trim();
  const signature = String(presence.signature || "").trim();
  const sessionFingerprint = String(presence.session_fingerprint || "").trim();
  if (!agentId || !sessionId || !signature || !sessionFingerprint) {
    return { taskContract: null, coordinationLock: null };
  }
  const task = tasks.filter((candidate) =>
    candidate?.agent_id === agentId && candidate?.session_id === sessionId &&
    candidate?.agent_signature === signature && candidate?.session_fingerprint === sessionFingerprint &&
    candidate?.status === "current" && Number.isFinite(Date.parse(candidate?.updated_at)) &&
    typeof candidate?.contract_id === "string" && candidate.contract_id.length > 0 &&
    typeof candidate?.trace_id === "string" && candidate.trace_id.length > 0)
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0];
  if (!task) return { taskContract: null, coordinationLock: null };
  const lock = locks.filter((candidate) =>
    candidate?.agent_id === agentId && candidate?.session_id === sessionId &&
    candidate?.agent_signature === signature && candidate?.session_fingerprint === sessionFingerprint &&
    candidate?.trace_id === task.trace_id &&
    typeof candidate?.name === "string" && candidate.name.length > 0 &&
    Number.isFinite(Date.parse(candidate?.acquired_at)))
    .sort((left, right) => Date.parse(right.acquired_at) - Date.parse(left.acquired_at))[0];
  return {
    taskContract: compactTask(task),
    coordinationLock: lock ? compactLock(lock) : null,
  };
}

function liveCoordinationBinding(identity, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { taskContract: null, coordinationLock: null };
  }
  const task = value.taskContract;
  const lock = value.coordinationLock;
  if (!task) {
    if (lock) throw new Error("shared_memory_bootstrap_live_binding_invalid");
    return { taskContract: null, coordinationLock: null };
  }
  const presence = identity?.agentPresence || {};
  const compactedTask = compactTask(task);
  if (!compactedTask.contract_id || !compactedTask.trace_id ||
      compactedTask.status !== "current" ||
      !Number.isFinite(Date.parse(compactedTask.updated_at)) ||
      compactedTask.agent_id !== presence.agent_id ||
      compactedTask.session_id !== presence.session_id ||
      compactedTask.agent_signature !== presence.signature ||
      compactedTask.session_fingerprint !== presence.session_fingerprint) {
    throw new Error("shared_memory_bootstrap_live_binding_invalid");
  }
  if (!lock) return { taskContract: compactedTask, coordinationLock: null };
  const compactedLock = compactLock(lock);
  if (!compactedLock.name || compactedLock.trace_id !== compactedTask.trace_id ||
      !Number.isFinite(Date.parse(compactedLock.acquired_at)) ||
      compactedLock.agent_id !== presence.agent_id ||
      compactedLock.session_id !== presence.session_id ||
      compactedLock.agent_signature !== presence.signature ||
      compactedLock.session_fingerprint !== presence.session_fingerprint) {
    throw new Error("shared_memory_bootstrap_live_binding_invalid");
  }
  return { taskContract: compactedTask, coordinationLock: compactedLock };
}

function latestHandoff(content) {
  const match = String(content || "").match(/^- `([^`]+)` — ([^\n]+)$/m);
  return match ? { path: match[1], modified_at: match[2].trim() } : null;
}

function signature(records) {
  return crypto.createHash("sha256").update(records
    .map((record) => `${record.source_path}\0${record.content_sha256}\0${new Date(record.updated_at).toISOString()}`)
    .sort()
    .join("\n"))
    .digest("hex");
}

function failed(tenantId, missingFiles, reason = "shared_memory_bootstrap_incomplete") {
  return {
    loaded: false,
    tenant_id: tenantId,
    missing_files: missingFiles,
    reason,
  };
}

export function createSharedMemoryBootstrap(store, options = {}) {
  const cacheTtlMs = Math.min(Math.max(Number(options.cacheTtlMs) || MAX_CACHE_MS, 1), MAX_CACHE_MS);
  const now = options.now || (() => Date.now());
  const cache = new Map();

  return {
    async load(identity) {
      const tenantId = safeTenant(identity?.tenantId);
      const presence = identity?.agentPresence || {};
      const cacheKey = [
        tenantId,
        presence.agent_id,
        presence.session_id,
        presence.signature,
        presence.session_fingerprint,
      ].map((value) => String(value || "")).join("\0");
      if (!store || typeof store.inspectBySourcePaths !== "function" || typeof store.fetchBySourcePaths !== "function") {
        return failed(tenantId, [...SHARED_MEMORY_BOOTSTRAP_PATHS], "cloud_memory_unavailable");
      }

      const manifest = await store.inspectBySourcePaths(tenantId, SHARED_MEMORY_BOOTSTRAP_PATHS);
      const present = new Set(manifest.map((record) => record.source_path));
      const missingFiles = SHARED_MEMORY_BOOTSTRAP_PATHS.filter((path) => !present.has(path));
      if (missingFiles.length) {
        cache.delete(cacheKey);
        return failed(tenantId, missingFiles);
      }

      const manifestSignature = signature(manifest);
      const liveBinding = typeof store.findCoordinationBinding === "function"
        ? liveCoordinationBinding(identity, await store.findCoordinationBinding(identity))
        : { taskContract: null, coordinationLock: null };
      const liveBindingSignature = crypto.createHash("sha256")
        .update(JSON.stringify(liveBinding))
        .digest("hex");
      const cacheSignature = `${manifestSignature}:${liveBindingSignature}`;
      const cached = cache.get(cacheKey);
      if (cached && cached.signature === cacheSignature && cached.expiresAt > now()) return cached.value;

      const records = await store.fetchBySourcePaths(tenantId, SHARED_MEMORY_BOOTSTRAP_PATHS);
      const byPath = new Map(records.map((record) => [record.source_path, record]));
      const missingAfterFetch = SHARED_MEMORY_BOOTSTRAP_PATHS.filter((path) => !byPath.has(path));
      if (missingAfterFetch.length) {
        cache.delete(cacheKey);
        return failed(tenantId, missingAfterFetch);
      }
      if (signature(records) !== manifestSignature) {
        cache.delete(cacheKey);
        return failed(tenantId, [], "shared_memory_bootstrap_changed_during_load");
      }

      const state = parseJsonDocument(byPath.get("SHARED_MEMORY/STATE.json"));
      const tasks = parseJsonDocument(byPath.get("SHARED_MEMORY/TASKS.json"));
      const locks = parseJsonDocument(byPath.get("SHARED_MEMORY/LOCKS.json"));
      const artifacts = parseJsonDocument(byPath.get("SHARED_MEMORY/ARTIFACTS.json"));
      requireCanonicalTenant(tenantId, state, tasks, locks, artifacts);
      const taskRecords = canonicalCollection(tasks, "tasks", "tasks");
      const lockRecords = canonicalCollection(locks, "locks", "locks");
      const artifactRecords = canonicalCollection(artifacts, "artifacts", "artifacts");
      const activeTaskCount = Number(state.active_task_count);
      const activeLockCount = Number(state.active_lock_count);
      if (!Number.isSafeInteger(activeTaskCount) || activeTaskCount !== taskRecords.length ||
          !Number.isSafeInteger(activeLockCount) || activeLockCount !== lockRecords.length) {
        throw new Error("shared_memory_bootstrap_inconsistent:state_counts");
      }
      const snapshotBinding = coordinationBinding(identity, taskRecords, lockRecords);
      const binding = liveBinding.taskContract ? liveBinding : snapshotBinding;
      const handoff = byPath.get("SHARED_MEMORY/HANDOFF.md");
      const value = {
        loaded: true,
        tenant_id: tenantId,
        generated_at: state.generated_at ?? tasks.generated_at ?? artifacts.generated_at ?? null,
        active_task_count: activeTaskCount,
        active_lock_count: activeLockCount,
        artifact_count: artifactRecords.length,
        latest_handoff: latestHandoff(handoff.content),
        recent_tasks: taskRecords.slice(0, RECENT_LIMIT).map(compactTask),
        recent_artifacts: artifactRecords.slice(0, RECENT_LIMIT).map(compactArtifact),
        task_contract: binding.taskContract,
        coordination_lock: binding.coordinationLock,
        coordination_binding_source: liveBinding.taskContract
          ? "postgres"
          : snapshotBinding.taskContract ? "canonical_snapshot" : "none",
        checksum: manifestSignature,
        cache_ttl_seconds: Math.floor(cacheTtlMs / 1000),
        required_paths: [...SHARED_MEMORY_BOOTSTRAP_PATHS],
      };
      cache.set(cacheKey, { signature: cacheSignature, expiresAt: now() + cacheTtlMs, value });
      return value;
    },
    clear(tenantId) {
      if (!tenantId) return cache.clear();
      const prefix = `${safeTenant(tenantId)}\0`;
      for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
    },
  };
}

export function attachSharedMemoryBootstrap(payload, bootstrap) {
  const failClosed = bootstrap?.loaded !== true;
  const apply = (value) => ({
    ...(value || {}),
    shared_memory_bootstrap: bootstrap,
    ...(failClosed ? {
      state: "shared_memory_bootstrap_required",
      governance: {
        ...(value?.governance || {}),
        execution_allowed_by_preflight: false,
        shared_memory_bootstrap_required: true,
      },
    } : {}),
  });
  if (payload?.work_preflight && typeof payload.work_preflight === "object") {
    return { ...payload, shared_memory_bootstrap: bootstrap, work_preflight: apply(payload.work_preflight) };
  }
  return apply(payload);
}
