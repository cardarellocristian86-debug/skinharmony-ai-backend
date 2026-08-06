import crypto from "node:crypto";
import { redactText } from "./memory-fabric.js";
import { requireTenantWorkCapability } from "./tenant-work-authorization.js";

const DEFAULT_MAX_WORKS = 5;
const MAX_WORKS_LIMIT = 10;
const DEFAULT_ACTIVITY_LIMIT = 20;
const MAX_ACTIVITY_LIMIT = 50;

const EVENT_REFERENCE_FIELDS = Object.freeze([
  "architecture_digest",
  "branch_id",
  "capsule_digest",
  "capsule_id",
  "decision_id",
  "evaluation_id",
  "lease_id",
  "message_id",
  "plan_id",
  "remediation_id",
  "status",
  "task_id",
  "verdict_id",
  "version",
]);

function boundedInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function redactedText(value, maximum) {
  // Redact before applying the public bound so a credential crossing the
  // truncation boundary cannot be returned as an unrecognized fragment.
  const text = redactText(String(value ?? "").replaceAll("\u0000", "")).text.trim();
  return text ? text.slice(0, maximum) : null;
}

function safeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeDigest(value) {
  const candidate = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{32,128}$/.test(candidate) ? candidate : null;
}

function assertTenantResult(result, tenantId) {
  if (String(result?.tenant_id || "") !== tenantId) {
    throw new Error("tenant_memory_context_tenant_mismatch");
  }
  return result;
}

function assertProjectResult(result, projectId) {
  const expected = String(projectId || "").trim();
  if (expected && String(result?.work?.project_id || "") !== expected) {
    throw new Error("tenant_memory_context_project_mismatch");
  }
  return result;
}

function emptyContext(identity, input = {}) {
  return {
    schema_version: "tenant_memory_context_v1",
    tenant_id: String(identity.tenantId),
    revision: 0,
    project_id: redactedText(input.project_id, 160),
    session_id: redactedText(input.session_id, 160),
    latest_checkpoint: null,
    pending_handoffs: [],
    relevant_memories: [],
    recent_activity: [],
    policy: {
      source: "tenant_work_gallery_postgresql",
      tenant_isolated: true,
      read_only: true,
      raw_prompts_stored_automatically: false,
      secrets_storable: false,
    },
  };
}

function compactStateHash(value) {
  const digest = safeDigest(value);
  return digest || null;
}

function compactCheckpoint(state) {
  const row = state?.latest_capsule;
  if (!row) return null;
  const capsule = row.capsule && typeof row.capsule === "object" && !Array.isArray(row.capsule)
    ? row.capsule
    : {};
  const stateHashes = capsule.state_hashes && typeof capsule.state_hashes === "object"
    ? capsule.state_hashes
    : {};
  return {
    schema_version: "tenant_gallery_checkpoint_v1",
    work_id: redactedText(state.work?.work_id, 160),
    capsule_id: redactedText(row.capsule_id, 160),
    capsule_digest: safeDigest(row.capsule_digest),
    architecture_version: nonNegativeInteger(row.architecture_version),
    supervisor_approved: row.supervisor_approved === true,
    verified_memory: row.verified_memory === true,
    created_at: safeDate(row.created_at),
    next_action: redactedText(capsule.next_action || state.work?.next_action, 1_000),
    evidence_count: Array.isArray(capsule.evidence) ? capsule.evidence.length : 0,
    test_count: Array.isArray(capsule.tests) ? capsule.tests.length : 0,
    authorization_count: Array.isArray(capsule.authorizations) ? capsule.authorizations.length : 0,
    rollback_ready: capsule.rollback?.available === true || capsule.rollback?.ready === true,
    state_hashes: {
      repository_hash: compactStateHash(stateHashes.repository_hash),
      policy_hash: compactStateHash(stateHashes.policy_hash),
      live_state_hash: compactStateHash(stateHashes.live_state_hash),
    },
  };
}

function compactWorkMemory(state) {
  const work = state.work || {};
  const workId = redactedText(work.work_id, 160);
  const status = redactedText(work.status, 40);
  const currentVersion = nonNegativeInteger(work.current_version);
  const nextAction = redactedText(work.next_action, 1_000);
  return {
    kind: "tenant_work",
    work_id: workId,
    project_id: redactedText(work.project_id, 160),
    parent_work_id: redactedText(work.parent_work_id, 160),
    status,
    current_version: currentVersion,
    summary: [
      `work_id=${workId || "unknown"}`,
      `status=${status || "unknown"}`,
      `current_version=${currentVersion}`,
      `next_action=${nextAction || "none"}`,
    ].join("; "),
    next_action: nextAction,
    updated_at: safeDate(work.updated_at),
    latest_capsule_digest: safeDigest(state.latest_capsule?.capsule_digest),
    active_participant_count: Array.isArray(state.participants)
      ? state.participants.filter((participant) => participant?.active === true).length
      : 0,
    active_lease_count: Array.isArray(state.leases)
      ? state.leases.filter((lease) => lease?.status === "active").length
      : 0,
  };
}

function compactEvent(state, event) {
  const payload = event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload
    : {};
  const references = {};
  for (const field of EVENT_REFERENCE_FIELDS) {
    if (payload[field] === undefined || payload[field] === null) continue;
    if (field === "version") {
      references[field] = nonNegativeInteger(payload[field]);
      continue;
    }
    references[field] = redactedText(payload[field], 200);
  }
  return {
    work_id: redactedText(state.work?.work_id, 160),
    event_id: redactedText(event?.event_id, 160),
    sequence_number: nonNegativeInteger(event?.sequence_number),
    event_type: redactedText(event?.event_type, 80),
    created_at: safeDate(event?.created_at),
    event_hash: safeDigest(event?.event_hash),
    references,
  };
}

function compactHandoff(state, event) {
  const payload = event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload
    : {};
  return {
    kind: "continuity_handoff_event",
    work_id: redactedText(state.work?.work_id, 160),
    event_id: redactedText(event?.event_id, 160),
    sequence_number: nonNegativeInteger(event?.sequence_number),
    event_type: "handoff_created",
    capsule_id: redactedText(payload.capsule_id, 160),
    capsule_digest: safeDigest(payload.capsule_digest),
    to_agent_id: redactedText(payload.handoff_to, 160),
    created_at: safeDate(event?.created_at),
  };
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function deterministicRevision(states) {
  if (!states.length) return 0;
  const material = states.map((state) => ({
    work_id: String(state.work?.work_id || ""),
    current_version: nonNegativeInteger(state.work?.current_version),
    updated_at: safeDate(state.work?.updated_at),
    capsule_digest: safeDigest(state.latest_capsule?.capsule_digest),
    latest_event_hash: safeDigest(state.events?.at(-1)?.event_hash),
    latest_event_sequence: nonNegativeInteger(state.events?.at(-1)?.sequence_number),
  })).sort((left, right) => left.work_id.localeCompare(right.work_id));
  return Number.parseInt(
    crypto.createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 12),
    16,
  );
}

function continuityWorkNotFound(error) {
  return error?.code === "continuity_work_not_found"
    || error?.message === "continuity_work_not_found";
}

async function loadStates(runtime, identity, input, { maxWorks, activityLimit }) {
  const explicitWorkId = String(input.work_id || "").trim();
  if (explicitWorkId) {
    try {
      const state = assertProjectResult(assertTenantResult(await runtime.read(identity, {
        work_id: explicitWorkId,
        event_limit: activityLimit,
      }), String(identity.tenantId)), input.project_id);
      return [state];
    } catch (error) {
      if (continuityWorkNotFound(error)) return [];
      throw error;
    }
  }

  const gallery = assertTenantResult(await runtime.gallery(identity, {
    project_id: input.project_id,
    status: "active",
    limit: maxWorks,
  }), String(identity.tenantId));
  const works = Array.isArray(gallery.works) ? gallery.works.slice(0, maxWorks) : [];
  for (const work of works) {
    if (work?.tenant_id && String(work.tenant_id) !== String(identity.tenantId)) {
      throw new Error("tenant_memory_context_tenant_mismatch");
    }
  }
  const states = await Promise.all(works.map(async (work) => {
    try {
      return assertProjectResult(assertTenantResult(await runtime.read(identity, {
        work_id: work.work_id,
        event_limit: activityLimit,
      }), String(identity.tenantId)), input.project_id);
    } catch (error) {
      if (continuityWorkNotFound(error)) return null;
      throw error;
    }
  }));
  return states.filter(Boolean);
}

export function createGalleryMemoryContextProvider(workContinuityRuntime, options = {}) {
  if (
    !workContinuityRuntime
    || typeof workContinuityRuntime.gallery !== "function"
    || typeof workContinuityRuntime.read !== "function"
  ) {
    throw new Error("tenant_work_gallery_memory_runtime_required");
  }
  const configuredMaxWorks = boundedInteger(options.maxWorks, DEFAULT_MAX_WORKS, MAX_WORKS_LIMIT);
  const configuredActivityLimit = boundedInteger(
    options.activityLimit,
    DEFAULT_ACTIVITY_LIMIT,
    MAX_ACTIVITY_LIMIT,
  );

  return async function galleryMemoryContext(input = {}, identity = {}) {
    const tenantId = String(identity.tenantId || "").trim();
    if (!tenantId) throw new Error("tenant_memory_context_identity_required");
    requireTenantWorkCapability(identity, "read");
    const maxWorks = boundedInteger(input.limit, configuredMaxWorks, configuredMaxWorks);
    const activityLimit = boundedInteger(
      input.activity_limit,
      configuredActivityLimit,
      configuredActivityLimit,
    );
    const states = await loadStates(workContinuityRuntime, identity, input, {
      maxWorks,
      activityLimit,
    });
    if (!states.length) return emptyContext(identity, input);

    const checkpoints = states.map(compactCheckpoint).filter(Boolean)
      .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at));
    const allEvents = states.flatMap((state) => (Array.isArray(state.events) ? state.events : [])
      .map((event) => ({ state, event })));
    const pendingHandoffs = allEvents
      .filter(({ event }) => event?.event_type === "handoff_created")
      .map(({ state, event }) => compactHandoff(state, event))
      .filter((handoff) => {
        const agentId = String(input.agent_id || "").trim();
        return !agentId || !handoff.to_agent_id || handoff.to_agent_id === "all"
          || handoff.to_agent_id === agentId;
      })
      .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at))
      .slice(0, activityLimit);
    const recentActivity = allEvents
      .map(({ state, event }) => compactEvent(state, event))
      .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at)
        || right.sequence_number - left.sequence_number)
      .slice(0, activityLimit);
    const relevantMemories = states.map(compactWorkMemory)
      .sort((left, right) => timestamp(right.updated_at) - timestamp(left.updated_at))
      .slice(0, maxWorks);

    return {
      ...emptyContext(identity, input),
      revision: deterministicRevision(states),
      project_id: redactedText(states[0]?.work?.project_id || input.project_id, 160),
      latest_checkpoint: checkpoints[0] || null,
      pending_handoffs: pendingHandoffs,
      relevant_memories: relevantMemories,
      recent_activity: recentActivity,
    };
  };
}

export function selectTenantMemoryContextProvider({ memoryFabric, workContinuityRuntime } = {}) {
  if (memoryFabric && typeof memoryFabric.context === "function") {
    return (input, identity) => memoryFabric.context(input, identity);
  }
  if (workContinuityRuntime) {
    return createGalleryMemoryContextProvider(workContinuityRuntime);
  }
  return null;
}
