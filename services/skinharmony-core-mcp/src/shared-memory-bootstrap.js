import crypto from "node:crypto";

export const SHARED_MEMORY_BOOTSTRAP_PATHS = Object.freeze([
  "SHARED_MEMORY/STATE.json",
  "SHARED_MEMORY/TASKS.json",
  "SHARED_MEMORY/LOCKS.json",
  "SHARED_MEMORY/ARTIFACTS.json",
  "SHARED_MEMORY/HANDOFF.md",
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
    agent_id: task.agent_id ?? null,
    session_id: task.session_id ?? null,
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
      if (!store || typeof store.inspectBySourcePaths !== "function" || typeof store.fetchBySourcePaths !== "function") {
        return failed(tenantId, [...SHARED_MEMORY_BOOTSTRAP_PATHS], "cloud_memory_unavailable");
      }

      const manifest = await store.inspectBySourcePaths(tenantId, SHARED_MEMORY_BOOTSTRAP_PATHS);
      const present = new Set(manifest.map((record) => record.source_path));
      const missingFiles = SHARED_MEMORY_BOOTSTRAP_PATHS.filter((path) => !present.has(path));
      if (missingFiles.length) {
        cache.delete(tenantId);
        return failed(tenantId, missingFiles);
      }

      const manifestSignature = signature(manifest);
      const cached = cache.get(tenantId);
      if (cached && cached.signature === manifestSignature && cached.expiresAt > now()) return cached.value;

      const records = await store.fetchBySourcePaths(tenantId, SHARED_MEMORY_BOOTSTRAP_PATHS);
      const byPath = new Map(records.map((record) => [record.source_path, record]));
      const missingAfterFetch = SHARED_MEMORY_BOOTSTRAP_PATHS.filter((path) => !byPath.has(path));
      if (missingAfterFetch.length) {
        cache.delete(tenantId);
        return failed(tenantId, missingAfterFetch);
      }

      const state = parseJsonDocument(byPath.get("SHARED_MEMORY/STATE.json"));
      const tasks = parseJsonDocument(byPath.get("SHARED_MEMORY/TASKS.json"));
      const locks = parseJsonDocument(byPath.get("SHARED_MEMORY/LOCKS.json"));
      const artifacts = parseJsonDocument(byPath.get("SHARED_MEMORY/ARTIFACTS.json"));
      const handoff = byPath.get("SHARED_MEMORY/HANDOFF.md");
      const value = {
        loaded: true,
        tenant_id: tenantId,
        generated_at: state.generated_at ?? tasks.generated_at ?? artifacts.generated_at ?? null,
        active_task_count: Number(state.active_task_count ?? tasks.count) || 0,
        active_lock_count: Number(state.active_lock_count ?? locks.count) || 0,
        artifact_count: Number(artifacts.count) || 0,
        latest_handoff: latestHandoff(handoff.content),
        recent_tasks: Array.isArray(tasks.tasks) ? tasks.tasks.slice(0, RECENT_LIMIT).map(compactTask) : [],
        recent_artifacts: Array.isArray(artifacts.artifacts) ? artifacts.artifacts.slice(0, RECENT_LIMIT).map(compactArtifact) : [],
        checksum: manifestSignature,
        cache_ttl_seconds: Math.floor(cacheTtlMs / 1000),
      };
      cache.set(tenantId, { signature: manifestSignature, expiresAt: now() + cacheTtlMs, value });
      return value;
    },
    clear(tenantId) {
      if (tenantId) cache.delete(safeTenant(tenantId));
      else cache.clear();
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
