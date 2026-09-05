import crypto from "node:crypto";

const MODES = new Set(["OFF", "SHADOW", "ENFORCE"]);
const RFC3339 = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTEXT_STATES = new Set(["READY", "INCOMPLETE", "CONFLICTED", "AMBIGUOUS"]);
const DEFAULT_MAX_SNAPSHOT_AGE_MS = 15 * 60_000;
const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60_000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function text(value, code, maximum = 240) {
  const result = String(value || "").trim();
  if (!result || result.length > maximum) fail(code);
  return result;
}

function timestamp(value, code) {
  const result = String(value || "");
  if (!RFC3339.test(result) || !Number.isFinite(Date.parse(result))) fail(code);
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digestValue(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function runtimeIdentity(tenantId, workId, { enforced = false } = {}) {
  const fingerprint = crypto.createHash("sha256")
    .update(`semantic-scope-context-resolver-v1\0${tenantId}\0${workId}`, "utf8")
    .digest("hex");
  return Object.freeze({
    tenant_id: tenantId,
    work_id: workId,
    legacy_work_id: workId,
    actor_id: "universal_core:semantic_scope_context_resolver",
    actor_role: "universal_core_context_resolver",
    authority_scope: Object.freeze(enforced
      ? ["entity360:core-enforcement-context"] : []),
    provenance: Object.freeze({
      actor_provenance: "universal_core_server_internal",
      session_fingerprint: fingerprint,
    }),
  });
}

function publicError() {
  return "semantic_scope_context_resolver_unavailable";
}

function resolvedContext(snapshot, verification, tenantId, workId, {
  now = Date.now(), maxSnapshotAgeMs = DEFAULT_MAX_SNAPSHOT_AGE_MS, receipt = null,
  action = null, phase = null,
} = {}) {
  const digest = String(snapshot?.deterministic_immutable_digest || "").toLowerCase();
  const snapshotVersion = Number(snapshot?.snapshot_version);
  const entityId = text(snapshot?.entity_id, "semantic_scope_entity360_snapshot_invalid", 160);
  const contextStatus = String(snapshot?.context_status || "").toUpperCase();
  const bindings = [snapshot?.project_work_linkage?.work_id,
    snapshot?.project_work_linkage?.legacy_work_id]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).trim().toLowerCase());
  if (snapshot?.tenant_scope !== tenantId || !bindings.includes(workId.toLowerCase())
    || !Number.isSafeInteger(snapshotVersion) || snapshotVersion < 1
    || !SHA256.test(digest) || verification?.valid !== true
    || verification?.snapshot_digest !== digest || !CONTEXT_STATES.has(contextStatus)
    || snapshot?.execution_authorized !== false) {
    fail("semantic_scope_entity360_snapshot_invalid");
  }
  const asOfValidTime = timestamp(snapshot?.bitemporal?.as_of_valid_time || snapshot?.as_of,
    "semantic_scope_entity360_valid_time_invalid");
  const asOfKnowledgeTime = timestamp(
    snapshot?.bitemporal?.as_of_knowledge_time || snapshot?.created_at,
    "semantic_scope_entity360_knowledge_time_invalid",
  );
  const validMilliseconds = Date.parse(asOfValidTime);
  const knowledgeMilliseconds = Date.parse(asOfKnowledgeTime);
  if (validMilliseconds > now || knowledgeMilliseconds > now) {
    fail("semantic_scope_entity360_snapshot_future");
  }
  const policyRevision = text(snapshot?.policy_version,
    "semantic_scope_entity360_policy_revision_invalid", 160);
  const ambiguous = contextStatus !== "READY";
  const stale = ambiguous || now - knowledgeMilliseconds > maxSnapshotAgeMs
    || (Array.isArray(snapshot?.stale_sources) && snapshot.stale_sources.length > 0);
  if (receipt) {
    const { receipt_digest: receiptDigest, ...unsignedReceipt } = receipt;
    const normalizedPhase = String(phase || "").toUpperCase();
    const expectedActionDigest = action && typeof action === "object" && !Array.isArray(action)
      ? digestValue(action) : null;
    if (receipt.schema_version !== "entity_360_core_context_receipt_v2"
      || receipt.tenant_id !== tenantId || receipt.work_id !== workId
      || receipt.entity_id !== entityId || receipt.snapshot_version !== snapshotVersion
      || receipt.snapshot_digest !== digest || !SHA256.test(String(receiptDigest || ""))
      || digestValue(unsignedReceipt) !== receiptDigest
      || receipt.policy_version !== snapshot.policy_version
      || receipt.policy_digest !== snapshot.policy_digest
      || !SHA256.test(String(receipt.policy_digest || ""))
      || receipt.adapter_registry_version !== snapshot.adapter_registry_version
      || receipt.as_of_valid_time !== asOfValidTime
      || receipt.as_of_knowledge_time !== asOfKnowledgeTime
      || !Number.isSafeInteger(receipt.tenant_feature_revision)
      || receipt.tenant_feature_revision < 0
      || !SHA256.test(String(receipt.enforcement_policy_digest || ""))
      || !SHA256.test(String(receipt.enforcement_authority_digest || ""))
      || expectedActionDigest === null || receipt.action_digest !== expectedActionDigest
      || !["ISSUE", "RESERVATION"].includes(normalizedPhase)
      || receipt.phase !== normalizedPhase
      || receipt.authority_owner !== "UNIVERSAL_CORE"
      || receipt.decision_authority !== "UNIVERSAL_CORE"
      || receipt.decision_receipt_schema_version !== "host_native_action_ticket_v1"
      || receipt.entity360_self_approval !== false
      || receipt.provider_mutation !== false || receipt.execution_authorized !== false) {
      fail("semantic_scope_entity360_receipt_invalid");
    }
  }
  const evidenceRefs = [`entity360_snapshot:${digest}`,
    ...(receipt ? [`entity360_context_receipt:${receipt.receipt_digest}`] : [])];
  return Object.freeze({
    schema_version: "semantic_scope_entity360_context_v1",
    tenant_id: tenantId,
    work_id: workId,
    entity_id: entityId,
    entity360_snapshot_ref: `entity360_snapshot:${digest}`,
    as_of_valid_time: asOfValidTime,
    as_of_knowledge_time: asOfKnowledgeTime,
    policy_revision: policyRevision,
    evidence_refs: Object.freeze(evidenceRefs),
    context_status: contextStatus,
    stale,
    ambiguous,
    authority_scope: receipt
      ? "CORE_ENFORCED_DATA_ONLY_NON_EXECUTABLE" : "DATA_ONLY_NON_EXECUTABLE",
    enforcement_authority_digest: receipt?.enforcement_authority_digest || null,
    context_receipt_digest: receipt?.receipt_digest || null,
    execution_authorized: false,
  });
}

/**
 * Server-owned bridge from host-native Semantic Scope checks to the existing
 * Entity360 Work read plane. Entity360 remains SHADOW/data-only: this resolver
 * verifies a persisted snapshot and never assembles context or writes state.
 */
export function createEntity360SemanticScopeContextResolver({
  mode = "SHADOW",
  getEntity360Runtime = () => null,
  contextResolver = null,
  maxSnapshotAgeMs = DEFAULT_MAX_SNAPSHOT_AGE_MS,
  now = () => Date.now(),
} = {}) {
  const configuredMode = String(mode || "SHADOW").trim().toUpperCase();
  if (!MODES.has(configuredMode)) fail("semantic_scope_mode_invalid");
  if (typeof getEntity360Runtime !== "function") {
    fail("semantic_scope_entity360_runtime_provider_invalid");
  }
  if (contextResolver !== null && typeof contextResolver !== "function") {
    fail("semantic_scope_context_resolver_invalid");
  }
  const configuredMaxSnapshotAgeMs = Number(maxSnapshotAgeMs);
  if (!Number.isSafeInteger(configuredMaxSnapshotAgeMs)
    || configuredMaxSnapshotAgeMs < 1_000
    || configuredMaxSnapshotAgeMs > MAX_SNAPSHOT_AGE_MS) {
    fail("semantic_scope_snapshot_max_age_invalid");
  }
  let state = configuredMode === "OFF" ? "disabled" : "created";
  let lastError = null;
  let initializationAttempts = 0;
  let resolveAttempts = 0;
  let resolveFailures = 0;
  let flight = null;

  function health() {
    const ready = configuredMode === "OFF" || state === "ready";
    return Object.freeze({
      schema_version: "semantic_scope_context_resolver_health_v1",
      mode: configuredMode,
      state,
      configured: configuredMode !== "OFF",
      ready,
      readiness_required: configuredMode === "ENFORCE",
      readiness_ready: configuredMode !== "ENFORCE" || ready,
      source: contextResolver ? "injected_resolver" : "entity360_verified_work_snapshot",
      entity360_authority_mode: configuredMode === "ENFORCE"
        ? "CORE_ENFORCED_DATA_ONLY" : "SHADOW_DATA_ONLY",
      max_snapshot_age_ms: configuredMaxSnapshotAgeMs,
      initialization_attempts: initializationAttempts,
      resolve_attempts: resolveAttempts,
      resolve_failures: resolveFailures,
      error: lastError,
      execution_authorized: false,
    });
  }

  async function checkDependency() {
    if (configuredMode === "OFF") return health();
    if (contextResolver) {
      if (typeof contextResolver.health === "function") {
        const result = await contextResolver.health();
        if (result?.ready !== true) fail("semantic_scope_context_resolver_not_ready");
      }
      return true;
    }
    const runtime = getEntity360Runtime();
    if (!runtime || typeof runtime.health !== "function" || typeof runtime.invoke !== "function") {
      fail("semantic_scope_context_resolver_not_ready");
    }
    const result = await runtime.health();
    const authorityReady = configuredMode !== "ENFORCE" || (
      result?.mode === "ENFORCE" && result?.enforcement_ready === true
      && result?.authority_owner === "UNIVERSAL_CORE"
      && result?.core_decision_only === true && result?.provider_mutation === false
      && result?.entity360_self_approval === false
      && typeof runtime.resolveEnforcementContext === "function"
    );
    if (result?.ready !== true || result?.state !== "ready"
      || !["SHADOW", "ENFORCE"].includes(result?.mode) || !authorityReady) {
      fail("semantic_scope_context_resolver_not_ready");
    }
    return true;
  }

  async function initialize() {
    if (configuredMode === "OFF") return health();
    if (flight) return flight;
    const attempt = (async () => {
      initializationAttempts += 1;
      state = "initializing";
      try {
        if (typeof contextResolver?.initialize === "function") {
          const initialized = await contextResolver.initialize();
          if (initialized?.ready !== true) fail("semantic_scope_context_resolver_not_ready");
        }
        await checkDependency();
        state = "ready";
        lastError = null;
        return health();
      } catch {
        state = "unavailable";
        lastError = publicError();
        fail("semantic_scope_context_resolver_not_ready");
      }
    })();
    flight = attempt;
    try {
      return await attempt;
    } finally {
      if (flight === attempt) flight = null;
    }
  }

  async function refresh() {
    if (configuredMode === "OFF") return health();
    if (state !== "ready") return initialize();
    try {
      await checkDependency();
      lastError = null;
    } catch {
      state = "unavailable";
      lastError = publicError();
    }
    return health();
  }

  async function resolve(input = {}) {
    const tenantId = text(input.tenant_id, "semantic_scope_tenant_required", 120);
    const workId = text(input.work_id, "semantic_scope_work_required", 240);
    if (configuredMode === "OFF") fail("semantic_scope_context_resolver_disabled");
    if (state !== "ready") {
      try { await initialize(); } catch { fail("semantic_scope_context_resolver_not_ready"); }
    }
    resolveAttempts += 1;
    try {
      await checkDependency();
      if (contextResolver) {
        const result = await contextResolver({ ...input, tenant_id: tenantId, work_id: workId });
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          fail("semantic_scope_context_unavailable");
        }
        return result;
      }
      const runtime = getEntity360Runtime();
      const identity = runtimeIdentity(tenantId, workId, {
        enforced: configuredMode === "ENFORCE",
      });
      if (configuredMode === "ENFORCE") {
        const enforced = await runtime.resolveEnforcementContext(identity, {
          tenant_id: tenantId,
          work_id: workId,
          action: input.action,
          phase: input.phase,
        });
        return resolvedContext(enforced?.snapshot, enforced?.verification, tenantId, workId, {
          now: Number(now()), maxSnapshotAgeMs: configuredMaxSnapshotAgeMs,
          receipt: enforced?.receipt,
          action: input.action,
          phase: input.phase,
        });
      }
      const resolution = await runtime.invoke("entity_360_resolve", identity, {
        work_id: workId,
        entity_type: "work",
        identity: { work_id: workId },
        project_work_linkage: { work_id: workId },
      });
      if (resolution?.status !== "RESOLVED") fail("semantic_scope_context_unavailable");
      const entityId = text(resolution?.entity_id,
        "semantic_scope_entity360_resolution_invalid", 160);
      const snapshot = await runtime.invoke("entity_360_snapshot_latest", identity, {
        work_id: workId,
        entity_id: entityId,
      });
      const verification = await runtime.invoke("entity_360_snapshot_verify", identity, {
        work_id: workId,
        entity_id: entityId,
        snapshot_version: snapshot?.snapshot_version,
        snapshot_digest: snapshot?.deterministic_immutable_digest,
      });
      return resolvedContext(snapshot, verification, tenantId, workId, {
        now: Number(now()), maxSnapshotAgeMs: configuredMaxSnapshotAgeMs,
      });
    } catch {
      resolveFailures += 1;
      fail("semantic_scope_context_unavailable");
    }
  }

  return Object.freeze({
    schema_version: "semantic_scope_context_resolver_v1",
    mode: configuredMode,
    initialize,
    refresh,
    resolve,
    health,
  });
}
