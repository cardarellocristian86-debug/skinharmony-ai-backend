import crypto from "node:crypto";

const DEFAULT_TTL_SECONDS = 3_600;
const RENEW_BEFORE_MS = 5 * 60 * 1_000;
const IDEMPOTENCY_BUCKET_MS = 5 * 60 * 1_000;
const READ_LEASE_PURPOSE = "Nyra governed read-only Work context";

function boundedKey(label, values, nowMs) {
  const bucket = Math.floor(nowMs / IDEMPOTENCY_BUCKET_MS);
  const suffix = crypto.createHash("sha256")
    .update(`${label}\u0000${values.join("\u0000")}\u0000${bucket}`)
    .digest("hex")
    .slice(0, 48);
  return `nyra_${label}_${suffix}`;
}

function bindingSummary(binding, state) {
  return Object.freeze({
    schema_version: "nyra_read_binding_v1",
    state,
    work_id: binding.work_id,
    lease_id: binding.lease_id,
    expires_at: binding.expires_at,
    participant_expires_at: binding.participant_expires_at,
    execution_authorized: false,
    external_action_authorized: false,
  });
}

function presenceReady(identity) {
  const presence = identity?.agentPresence;
  return presence?.transport_bound === true
    && Boolean(presence.session_id)
    && Boolean(presence.agent_id)
    && Boolean(presence.client_type)
    && Boolean(presence.session_fingerprint)
    && Boolean(presence.host_transport_session_fingerprint)
    && Boolean(presence.signature);
}

function readSurface(identity, continuity, presence) {
  return {
    kind: "component",
    value: `nyra/read/${crypto.createHash("sha256")
      .update(`${identity.tenantId}\u0000${continuity.work_id}\u0000${presence.session_fingerprint}`)
      .digest("hex")}`,
  };
}

/**
 * Establish the read-only participant/lease binding used by Nyra's governed
 * diagnostic surfaces after an exact Work has already been ACL-authorized.
 * This never creates a Work, opens a branch or grants execution authority.
 */
export async function ensureNyraReadBinding({
  runtime,
  authorizeRead,
  identity,
  continuity,
  now = () => Date.now(),
} = {}) {
  if (!continuity?.work_id) {
    return Object.freeze({
      schema_version: "nyra_read_binding_v1",
      state: "work_selection_required",
      execution_authorized: false,
      external_action_authorized: false,
    });
  }
  if (!runtime || typeof runtime.resolveDttWorkLeaseBinding !== "function"
      || typeof runtime.rotateNyraReadParticipant !== "function"
      || typeof runtime.join !== "function" || typeof runtime.acquireLease !== "function") {
    throw new Error("nyra_read_binding_runtime_unavailable");
  }
  if (!presenceReady(identity)) {
    return Object.freeze({
      schema_version: "nyra_read_binding_v1",
      state: "signed_presence_required",
      work_id: continuity.work_id,
      execution_authorized: false,
      external_action_authorized: false,
    });
  }

  if (typeof authorizeRead === "function") {
    await authorizeRead(identity, continuity.work_id);
  }

  const presence = identity.agentPresence;
  const nowMs = Number(now());
  const common = {
    work_id: continuity.work_id,
    session_id: presence.session_id,
    agent_id: presence.agent_id,
    client_type: presence.client_type,
    ttl_seconds: DEFAULT_TTL_SECONDS,
  };
  const surface = readSurface(identity, continuity, presence);
  const resolveInput = {
    work_id: continuity.work_id,
    required_lease_purpose: READ_LEASE_PURPOSE,
    required_lease_surface: surface,
  };

  let binding = null;
  try {
    binding = await runtime.resolveDttWorkLeaseBinding(identity, resolveInput);
  } catch (error) {
    if (String(error?.code || error?.message || "") !== "dtt_work_active_lease_required") {
      throw error;
    }
  }

  if (binding) {
    const expiresAt = Date.parse(String(binding.expires_at || ""));
    const participantExpiresAt = Date.parse(String(binding.participant_expires_at || ""));
    if (Number.isFinite(expiresAt) && Number.isFinite(participantExpiresAt)
        && Math.min(expiresAt, participantExpiresAt) > nowMs + RENEW_BEFORE_MS) {
      return bindingSummary(binding, "active");
    }
    if (typeof runtime.heartbeat !== "function" || typeof runtime.renewLease !== "function") {
      throw new Error("nyra_read_binding_renewal_unavailable");
    }
    await runtime.heartbeat(identity, {
      ...common,
      idempotency_key: boundedKey("read_heartbeat", [identity.tenantId, continuity.work_id,
        presence.session_fingerprint], nowMs),
    });
    await runtime.renewLease(identity, {
      ...common,
      lease_id: binding.lease_id,
      idempotency_key: boundedKey("read_renew", [identity.tenantId, continuity.work_id,
        presence.session_fingerprint, binding.lease_id], nowMs),
    });
    const renewed = await runtime.resolveDttWorkLeaseBinding(identity, resolveInput);
    return bindingSummary(renewed, "renewed");
  }

  const participant = await runtime.rotateNyraReadParticipant(identity, {
    ...common,
    idempotency_key: boundedKey("read_transport", [identity.tenantId, continuity.work_id,
      presence.session_fingerprint, presence.host_transport_session_fingerprint], nowMs),
  });
  if (participant?.state === "missing_or_expired") {
    await runtime.join(identity, {
      ...common,
      metadata: {
        source: "work_preflight",
        mode: "read_only",
        logical_session_fingerprint: presence.session_fingerprint,
        execution_authorized: false,
      },
      idempotency_key: boundedKey("read_join", [identity.tenantId, continuity.work_id,
        presence.session_fingerprint], nowMs),
    });
  }
  const acquired = await runtime.acquireLease(identity, {
    ...common,
    purpose: READ_LEASE_PURPOSE,
    surfaces: [surface],
    idempotency_key: boundedKey("read_lease", [identity.tenantId, continuity.work_id,
      presence.session_fingerprint], nowMs),
  });
  if (acquired?.acquired !== true && !acquired?.lease?.lease_id) {
    throw new Error("nyra_read_binding_lease_not_acquired");
  }
  const created = await runtime.resolveDttWorkLeaseBinding(identity, resolveInput);
  return bindingSummary(created, "created");
}
