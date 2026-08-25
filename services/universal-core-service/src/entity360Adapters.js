import { compileEntity360Policy, entity360Digest, resolveEntity360Identity } from "./entity360.js";
import { causalDigest } from "./causalContinuityCanonical.js";
import { buildCausalEventHash } from "./causalContinuityStore.js";
import {
  ICF_EVENT_CANONICALIZATION_V2,
  ICF_EVENT_DIGEST_ALGORITHM,
  ICF_EVENT_DIGEST_CONTRACT_V2,
  icfEventDigestV2,
  icfEventPayloadDigestV2,
} from "./icfEventDigest.js";
import { projectScopeObservationDigest } from "./projectScopeRenderOriginResolver.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RETRIEVAL_BUDGETS = new WeakMap();
export const ENTITY_360_SECURITY_OBSERVATION_ADMISSION_V1 = Object.freeze({
  schema_version: "entity_360_security_observation_admission_v1",
  baseline_schema_versions: Object.freeze(["software_security_assessment_v1"]),
  independence_classes: Object.freeze(["INDEPENDENT_SYSTEM", "INDEPENDENT_HUMAN", "FORMAL"]),
  provenance_root_keys: Object.freeze(["observer", "source"]),
  required_observer_bindings: Object.freeze(["actor_id", "actor_role"]),
  require_source_provenance: true,
});

function fail(code, status = 422) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function requiredText(value, code, max = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
}

function requiredUuid(value, code) {
  const normalized = requiredText(value, code, 36).toLowerCase();
  if (!UUID.test(normalized)) fail(code);
  return normalized;
}

function iso(value, fallback) {
  const milliseconds = Date.parse(String(value || fallback || ""));
  if (!Number.isFinite(milliseconds)) fail("entity360_adapter_timestamp_invalid");
  return new Date(milliseconds).toISOString();
}

function selectedRow(row, fields) {
  return Object.fromEntries(fields.map((field) => [field, row?.[field] ?? null]));
}

function sourceRetrievalLimits(policy, sourceId) {
  const source = policy.source_registry[sourceId];
  if (!source) fail("entity360_retrieval_source_not_registered", 503);
  const sourceBudget = policy.budgets.per_source[sourceId]
    || policy.budgets.per_source.default;
  const classBudget = policy.budgets.per_source_class[source.source_class]
    || policy.budgets.per_source_class.default;
  const trustBudget = policy.budgets.per_trust_class[source.trust_class]
    || policy.budgets.per_trust_class.default;
  const limits = [policy.budgets.max_retrieval_bytes, sourceBudget?.max_bytes,
    classBudget?.max_bytes, trustBudget?.max_bytes];
  if (limits.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    fail("entity360_retrieval_budget_invalid", 503);
  }
  return Object.freeze({ source_class: source.source_class, trust_class: source.trust_class,
    global: limits[0], source: limits[1], source_class_limit: limits[2], trust_class_limit: limits[3] });
}

function sourceRetrievalMaximum(policy, sourceId) {
  const limits = sourceRetrievalLimits(policy, sourceId);
  return Math.min(limits.global, limits.source, limits.source_class_limit,
    limits.trust_class_limit);
}

function sourceOwnerReadLimits(policy, sourceId) {
  const source = policy.source_registry[sourceId];
  const sourceBudget = policy.budgets.per_source[sourceId] || policy.budgets.per_source.default;
  const classBudget = policy.budgets.per_source_class[source.source_class]
    || policy.budgets.per_source_class.default;
  const trustBudget = policy.budgets.per_trust_class[source.trust_class]
    || policy.budgets.per_trust_class.default;
  const recordLimits = [policy.budgets.max_evidence, sourceBudget.max_evidence,
    classBudget.max_evidence, trustBudget.max_evidence];
  if (recordLimits.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    fail("entity360_retrieval_budget_invalid", 503);
  }
  const evidenceLimit = Math.min(...recordLimits);
  return Object.freeze({ max_bytes: sourceRetrievalMaximum(policy, sourceId),
    // One set digest plus decision+binding digest per emitted head must fit the
    // same evidence occupancy contract. Each head requires at least one row.
    max_records: Math.min(evidenceLimit, Math.floor((evidenceLimit - 1) / 2)) });
}

function createRetrievalBudget(policy) {
  const globalMaximum = policy.budgets.max_retrieval_bytes;
  const consumedBySource = new Map();
  const consumedBySourceClass = new Map();
  const consumedByTrustClass = new Map();
  let globalConsumed = 0;
  return Object.freeze({
    available(sourceId) {
      const limits = sourceRetrievalLimits(policy, sourceId);
      return Math.max(0, Math.min(
        globalMaximum - globalConsumed,
        limits.source - (consumedBySource.get(sourceId) || 0),
        limits.source_class_limit - (consumedBySourceClass.get(limits.source_class) || 0),
        limits.trust_class_limit - (consumedByTrustClass.get(limits.trust_class) || 0),
      ));
    },
    consume(sourceId, bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.available(sourceId)) {
        fail("entity360_source_retrieval_budget_exceeded", 503);
      }
      const limits = sourceRetrievalLimits(policy, sourceId);
      globalConsumed += bytes;
      consumedBySource.set(sourceId, (consumedBySource.get(sourceId) || 0) + bytes);
      consumedBySourceClass.set(limits.source_class,
        (consumedBySourceClass.get(limits.source_class) || 0) + bytes);
      consumedByTrustClass.set(limits.trust_class,
        (consumedByTrustClass.get(limits.trust_class) || 0) + bytes);
    },
    sourceMaximum(sourceId) { return sourceRetrievalMaximum(policy, sourceId); },
    sourceConsumed(sourceId) { return consumedBySource.get(sourceId) || 0; },
    decorate(report) {
      for (const [sourceId, retrievedBytes] of consumedBySource.entries()) {
        const item = report.find((entry) => entry.source_id === sourceId
          && ["accepted", "stale", "conflicting"].includes(entry.state))
          || report.find((entry) => entry.source_id === sourceId);
        if (item && item.retrieved_bytes === undefined) {
          item.retrieved_bytes = retrievedBytes;
          item.retrieval_budget_bytes = sourceRetrievalMaximum(policy, sourceId);
        }
      }
    },
  });
}

function reportRetrievalBudgetExceeded(report, sourceId, budget, attemptedBytes = null) {
  if (report.some((item) => item.source_id === sourceId
    && item.reason_code === "SOURCE_RETRIEVAL_BUDGET_EXCEEDED")) return;
  report.push({ source_id: sourceId, state: "rejected",
    reason_code: "SOURCE_RETRIEVAL_BUDGET_EXCEEDED",
    retrieved_bytes: budget.sourceConsumed(sourceId),
    retrieval_budget_bytes: budget.sourceMaximum(sourceId),
    ...(Number.isSafeInteger(attemptedBytes) && attemptedBytes >= 0
      ? { attempted_retrieval_bytes: attemptedBytes } : {}) });
}

function assertTenantRows(result, tenantId) {
  for (const row of result.rows || []) {
    if (String(row?.tenant_id || "") !== tenantId) {
      fail("entity360_adapter_cross_tenant_row", 403);
    }
  }
  return result;
}

function projectSlugs(values) {
  const slugs = values.filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => requiredText(value, "entity360_adapter_project_slug_invalid", 128));
  if (slugs.some((value) => UUID.test(value))) fail("entity360_project_namespace_conflation", 409);
  return [...new Set(slugs)].sort();
}

function optionalProjectUuid(value) {
  if (value === null || value === undefined || value === "") return null;
  return requiredUuid(value, "entity360_adapter_project_uuid_invalid");
}

function optionalDigest(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) fail("entity360_adapter_digest_invalid");
  return normalized;
}

function verifyIcfEventDigestV2({ event, tenantId, workId }) {
  if (!event) return { verified: false, reason_code: "ICF_BINDING_MISSING" };
  if (event.digest_contract === null || event.digest_contract === undefined
    || event.digest_contract === "") {
    const legacyMetadataAbsent = [event.canonicalization_version, event.digest_algorithm,
      event.payload_digest, event.previous_digest_contract].every((value) =>
      value === null || value === undefined || value === "");
    return { verified: false, reason_code: legacyMetadataAbsent
      ? "ICF_EVENT_DIGEST_CONTRACT_LEGACY_REANCHOR_REQUIRED"
      : "ICF_EVENT_DIGEST_CONTRACT_UNSUPPORTED" };
  }
  if (event.digest_contract !== ICF_EVENT_DIGEST_CONTRACT_V2
    || event.canonicalization_version !== ICF_EVENT_CANONICALIZATION_V2
    || event.digest_algorithm !== ICF_EVENT_DIGEST_ALGORITHM) {
    return { verified: false, reason_code: "ICF_EVENT_DIGEST_CONTRACT_UNSUPPORTED" };
  }
  try {
    const storedDigest = optionalDigest(event.digest);
    const storedPayloadDigest = optionalDigest(event.payload_digest);
    if (!storedDigest || !storedPayloadDigest
      || storedPayloadDigest !== icfEventPayloadDigestV2(event.payload)) {
      return { verified: false, reason_code: "ICF_EVENT_DIGEST_MISMATCH" };
    }
    const expected = icfEventDigestV2({ tenantId, workId, seq: Number(event.seq),
      eventType: event.event_type, payload: event.payload, previous: event.previous_digest || null,
      previousDigestContract: event.previous_digest_contract || null });
    return expected === storedDigest
      ? { verified: true, digest: storedDigest }
      : { verified: false, reason_code: "ICF_EVENT_DIGEST_MISMATCH" };
  } catch {
    return { verified: false, reason_code: "ICF_EVENT_DIGEST_MISMATCH" };
  }
}

function exactObjectKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function securityObservationAdmitted(observation) {
  try {
    const contract = ENTITY_360_SECURITY_OBSERVATION_ADMISSION_V1;
    const independence = requiredText(observation.independence,
      "entity360_security_independence_invalid", 80).toUpperCase();
    if (!contract.independence_classes.includes(independence)) return false;
    const source = requiredText(observation.source, "entity360_security_source_invalid", 240);
    const observerIdentity = requiredText(observation.observer_identity,
      "entity360_security_observer_identity_invalid", 240);
    const observerRole = requiredText(observation.observer_role,
      "entity360_security_observer_role_invalid", 240);
    if (!source || !exactObjectKeys(observation.provenance, contract.provenance_root_keys)) return false;
    const observer = observation.provenance.observer;
    const sourceProvenance = observation.provenance.source;
    if (!observer || typeof observer !== "object" || Array.isArray(observer)
      || !sourceProvenance || typeof sourceProvenance !== "object" || Array.isArray(sourceProvenance)
      || contract.require_source_provenance && Object.keys(sourceProvenance).length === 0) return false;
    if (contract.required_observer_bindings.some((key) => !Object.hasOwn(observer, key))
      || observer.actor_id !== observerIdentity || observer.actor_role !== observerRole
      || observer.tenant_id !== undefined && observer.tenant_id !== observation.tenant_id
      || observer.observer_independence !== undefined
        && String(observer.observer_independence).toUpperCase() !== independence) return false;
    const baselineVersion = observation.baseline?.schema_version
      || observation.baseline?.subject_kind;
    return contract.baseline_schema_versions.includes(baselineVersion);
  } catch {
    return false;
  }
}

function bindingProjectionFromRow(row) {
  return {
    tenant_id: requiredText(row.tenant_id, "entity360_causal_binding_tenant_invalid", 120),
    work_id: requiredUuid(row.work_id, "entity360_causal_binding_work_invalid"),
    project_id: requiredUuid(row.project_uuid, "entity360_causal_binding_project_invalid"),
    genesis_intent_id: requiredUuid(row.genesis_intent_id,
      "entity360_causal_binding_genesis_invalid"),
    intent_revision_id: requiredUuid(row.intent_revision_id,
      "entity360_causal_binding_intent_invalid"),
    base_state_digest: optionalDigest(row.base_state_digest),
    legacy_binding_state: requiredText(row.legacy_binding_state,
      "entity360_causal_binding_legacy_state_invalid", 40),
    provenance: row.binding_provenance,
    created_at: iso(row.binding_created_at),
  };
}

function bindingProjectionFromEvent(result) {
  return {
    tenant_id: requiredText(result.tenant_id, "entity360_causal_event_tenant_invalid", 120),
    work_id: requiredUuid(result.work_id, "entity360_causal_event_work_invalid"),
    project_id: requiredUuid(result.project_id, "entity360_causal_event_project_invalid"),
    genesis_intent_id: requiredUuid(result.genesis_intent_id,
      "entity360_causal_event_genesis_invalid"),
    intent_revision_id: requiredUuid(result.intent_revision_id,
      "entity360_causal_event_intent_invalid"),
    base_state_digest: optionalDigest(result.base_state_digest),
    legacy_binding_state: requiredText(result.legacy_binding_state,
      "entity360_causal_event_legacy_state_invalid", 40),
    provenance: result.provenance,
    created_at: iso(result.created_at),
  };
}

function verifyCausalBindingEvent(row, event) {
  try {
    if (!event || event.event_type !== "WORK_OPENED" || event.operation !== "work_bind_intent") {
      return { verified: false };
    }
    const eventId = requiredUuid(event.event_id, "entity360_causal_event_id_invalid");
    const projectUuid = requiredUuid(event.event_project_uuid,
      "entity360_causal_event_project_invalid");
    const sequence = Number(event.sequence_number);
    if (!Number.isSafeInteger(sequence) || sequence < 1) return { verified: false };
    const requestDigest = optionalDigest(event.request_digest);
    const payloadDigest = optionalDigest(event.payload_digest);
    const actorProvenanceDigest = optionalDigest(event.actor_provenance_digest);
    const eventHash = optionalDigest(event.event_hash);
    if (!requestDigest || !payloadDigest || !actorProvenanceDigest || !eventHash) {
      return { verified: false };
    }
    const previousEventHash = optionalDigest(event.previous_event_hash);
    const predecessorEventHash = optionalDigest(event.predecessor_event_hash);
    const previousLinkVerified = sequence === 1
      ? previousEventHash === null && predecessorEventHash === null
      : previousEventHash !== null && previousEventHash === predecessorEventHash;
    const payload = event.payload;
    const result = payload?.result;
    const actorProvenance = event.actor_provenance;
    if (!previousLinkVerified || !exactObjectKeys(payload, ["schema_version", "result"])
      || payload.schema_version !== "causal_event_payload_v1"
      || !exactObjectKeys(result, ["tenant_id", "work_id", "project_id", "genesis_intent_id",
        "intent_revision_id", "base_state_digest", "legacy_binding_state", "provenance",
        "created_at", "legacy_binding"])
      || causalDigest(payload) !== payloadDigest
      || causalDigest(actorProvenance) !== actorProvenanceDigest) {
      return { verified: false };
    }
    const currentBinding = bindingProjectionFromRow(row);
    const eventBinding = bindingProjectionFromEvent(result);
    const legacyBinding = result.legacy_binding;
    const legacyBindingKeys = legacyBinding?.present
      ? ["present", "state", "project_uuid"] : ["present", "state"];
    const legacyBindingVerified = exactObjectKeys(legacyBinding, legacyBindingKeys)
      && typeof legacyBinding.present === "boolean"
      && legacyBinding.state === currentBinding.legacy_binding_state
      && (!legacyBinding.present || currentBinding.legacy_binding_state !== "VERIFIED"
        || requiredUuid(legacyBinding.project_uuid,
          "entity360_causal_event_legacy_project_invalid") === currentBinding.project_id);
    if (event.tenant_id !== currentBinding.tenant_id || projectUuid !== currentBinding.project_id
      || causalDigest(currentBinding) !== causalDigest(eventBinding) || !legacyBindingVerified) {
      return { verified: false };
    }
    const expectedEventHash = buildCausalEventHash({
      tenant_id: currentBinding.tenant_id,
      project_id: projectUuid,
      event_id: eventId,
      sequence_number: sequence,
      event_type: event.event_type,
      operation: event.operation,
      idempotency_key: requiredText(event.idempotency_key,
        "entity360_causal_event_idempotency_key_invalid", 240),
      request_digest: requestDigest,
      payload_digest: payloadDigest,
      actor_provenance: actorProvenance,
      previous_event_hash: previousEventHash,
    });
    if (expectedEventHash !== eventHash) return { verified: false };
    return { verified: true, event_hash: eventHash,
      event_ref: `causal_event:${eventId}:${sequence}` };
  } catch {
    return { verified: false };
  }
}

function reportProjectSlugConflict(report, candidates) {
  if (candidates.length < 2 || report.some((item) =>
    item.reason_code === "WORK_PROJECT_LINKAGE_CONFLICT")) return;
  report.push({ source_id: "work_continuity", state: "conflicting",
    reason_code: "WORK_PROJECT_LINKAGE_CONFLICT", project_slug_candidates: candidates });
}

function reportProjectUuidMismatch(report, continuityProjectUuid, causalProjectUuid) {
  if (report.some((item) => item.reason_code === "WORK_PROJECT_UUID_BINDING_MISMATCH")) return;
  report.push({ source_id: "genesis", state: "rejected",
    reason_code: "WORK_PROJECT_UUID_BINDING_MISMATCH",
    continuity_project_uuid: continuityProjectUuid,
    causal_project_uuid: causalProjectUuid });
}

function causalAuthorityState(row, continuityProjectUuid, bindingEvent) {
  if (!row) return { eligible: false, reason_code: "CAUSAL_BINDING_MISSING",
    project_uuid: null };
  const projectUuid = optionalProjectUuid(row.project_uuid);
  const genesisProjectUuid = optionalProjectUuid(row.genesis_project_uuid);
  const intentProjectUuid = optionalProjectUuid(row.intent_project_uuid);
  const intentGenesisId = row.intent_genesis_intent_id
    ? requiredUuid(row.intent_genesis_intent_id, "entity360_causal_intent_genesis_invalid") : null;
  const genesisId = row.genesis_intent_id
    ? requiredUuid(row.genesis_intent_id, "entity360_causal_genesis_invalid") : null;
  const intentRevisionId = row.intent_revision_id
    ? requiredUuid(row.intent_revision_id, "entity360_causal_intent_revision_invalid") : null;
  if (!projectUuid || genesisProjectUuid !== projectUuid || intentProjectUuid !== projectUuid
    || !genesisId || !intentRevisionId || intentGenesisId !== genesisId) {
    return { eligible: false, reason_code: "CAUSAL_AUTHORITY_GRAPH_MISMATCH", project_uuid: projectUuid };
  }
  if (String(row.legacy_binding_state || "") !== "VERIFIED") {
    return { eligible: false, reason_code: "CAUSAL_LEGACY_BINDING_UNVERIFIED", project_uuid: projectUuid };
  }
  if (String(row.intent_state || "") !== "APPROVED") {
    return { eligible: false, reason_code: "CAUSAL_INTENT_REVISION_NOT_APPROVED", project_uuid: projectUuid };
  }
  if (!continuityProjectUuid) {
    return { eligible: false, reason_code: "WORK_PROJECT_UUID_BINDING_MISSING", project_uuid: projectUuid };
  }
  if (projectUuid !== continuityProjectUuid) {
    return { eligible: false, reason_code: "WORK_PROJECT_UUID_BINDING_MISMATCH", project_uuid: projectUuid };
  }
  const genesisDigest = String(row.genesis_digest || "").toLowerCase();
  let genesisDigestVerified = false;
  try {
    genesisDigestVerified = /^[a-f0-9]{64}$/u.test(genesisDigest)
      && genesisDigest === causalDigest({ project_id: projectUuid,
        intent_text: row.genesis_intent_text });
  } catch {
    genesisDigestVerified = false;
  }
  if (!genesisDigestVerified) {
    return { eligible: false, reason_code: "CAUSAL_GENESIS_DIGEST_MISMATCH", project_uuid: projectUuid };
  }
  const intentDigest = String(row.intent_revision_digest || "").toLowerCase();
  let intentDigestVerified = false;
  try {
    intentDigestVerified = /^[a-f0-9]{64}$/u.test(intentDigest)
      && intentDigest === causalDigest({ project_id: projectUuid,
        genesis_intent_id: genesisId,
        parent_revision_id: row.intent_parent_revision_id || null,
        alias: row.intent_alias,
        classification: row.intent_classification,
        revision_payload: row.intent_revision_payload });
  } catch {
    intentDigestVerified = false;
  }
  if (!intentDigestVerified) {
    return { eligible: false, reason_code: "CAUSAL_INTENT_DIGEST_MISMATCH", project_uuid: projectUuid };
  }
  const bindingEventState = verifyCausalBindingEvent(row, bindingEvent);
  if (!bindingEventState.verified) {
    return { eligible: false, reason_code: "CAUSAL_BINDING_EVENT_MISMATCH",
      project_uuid: projectUuid };
  }
  return { eligible: true, reason_code: null, project_uuid: projectUuid,
    binding_event_hash: bindingEventState.event_hash,
    binding_event_ref: bindingEventState.event_ref };
}

function reportCausalAuthorityGap(report, state, continuityProjectUuid) {
  if (state.eligible || !state.reason_code || report.some((item) =>
    item.reason_code === state.reason_code)) return;
  if (state.reason_code === "WORK_PROJECT_UUID_BINDING_MISMATCH") {
    reportProjectUuidMismatch(report, continuityProjectUuid, state.project_uuid);
    return;
  }
  report.push({ source_id: state.reason_code === "CAUSAL_INTENT_DIGEST_MISMATCH" ? "intent" : "genesis",
    state: state.reason_code.endsWith("MISSING") ? "missing" : "rejected",
    reason_code: state.reason_code });
}

async function optionalQuery(client, text, values, sourceId, report) {
  const savepoint = "entity360_optional_query";
  const retrievalBudget = RETRIEVAL_BUDGETS.get(client);
  if (!retrievalBudget) fail("entity360_retrieval_budget_unavailable", 503);
  const availableBytes = retrievalBudget.available(sourceId);
  if (availableBytes < 1) {
    reportRetrievalBudgetExceeded(report, sourceId, retrievalBudget);
    return { rows: [], rowCount: 0 };
  }
  const budgetParameter = values.length + 1;
  const boundedQuery = `
    WITH entity360_raw_rows AS MATERIALIZED (${text}),
    entity360_sized_rows AS MATERIALIZED (
      SELECT entity360_raw_rows AS row_value,
             pg_column_size(entity360_raw_rows)::bigint AS row_storage_bytes
        FROM entity360_raw_rows
    ),
    entity360_storage_total AS (
      SELECT coalesce(sum(row_storage_bytes),0)::bigint AS storage_bytes
        FROM entity360_sized_rows
    ),
    entity360_pre_gated_rows AS MATERIALIZED (
      SELECT CASE WHEN storage_bytes <= $${budgetParameter}::bigint
                  THEN to_jsonb(row_value) ELSE NULL END AS row_data,
             row_storage_bytes,storage_bytes
        FROM entity360_sized_rows CROSS JOIN entity360_storage_total
    ),
    entity360_encoded_rows AS (
      SELECT row_data,
             CASE WHEN row_data IS NULL THEN 0
                  ELSE octet_length(row_data::text)::bigint END AS row_bytes,
             storage_bytes
        FROM entity360_pre_gated_rows
    ),
    entity360_retrieval_total AS (
      SELECT coalesce(sum(row_bytes),0)::bigint AS total_bytes,
             coalesce(max(storage_bytes),0)::bigint AS storage_bytes
        FROM entity360_encoded_rows
    )
    SELECT CASE WHEN storage_bytes <= $${budgetParameter}::bigint
                     AND total_bytes <= $${budgetParameter}::bigint
                THEN row_data ELSE NULL END
             AS entity360_bounded_row,
           row_bytes AS entity360_row_bytes,total_bytes AS entity360_total_bytes,
           storage_bytes AS entity360_storage_bytes
      FROM entity360_encoded_rows CROSS JOIN entity360_retrieval_total`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let result;
  try {
    result = await client.query(boundedQuery, [...values, availableBytes]);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (recoveryError) {
      recoveryError.cause = error;
      throw recoveryError;
    }
    if (["42P01", "42703"].includes(error?.code)) {
      report.push({ source_id: sourceId, state: "unavailable", reason_code: "SOURCE_SCHEMA_UNAVAILABLE" });
      return { rows: [], rowCount: 0 };
    }
    throw error;
  }
  if (result.rows.length === 0) return { ...result, rows: [], rowCount: 0 };
  const wrapped = result.rows.every((row) =>
    Object.hasOwn(row, "entity360_bounded_row")
    && Object.hasOwn(row, "entity360_total_bytes"));
  if (wrapped && result.rows.length) {
    const totalBytes = Number(result.rows[0].entity360_total_bytes);
    const storageBytes = Number(result.rows[0].entity360_storage_bytes);
    if (!Number.isSafeInteger(totalBytes) || totalBytes < 0
      || !Number.isSafeInteger(storageBytes) || storageBytes < 0
      || result.rows.some((row) => Number(row.entity360_total_bytes) !== totalBytes
        || Number(row.entity360_storage_bytes) !== storageBytes)) {
      fail("entity360_retrieval_measurement_invalid", 503);
    }
    const attemptedBytes = Math.max(totalBytes, storageBytes);
    if (attemptedBytes > availableBytes || result.rows.some((row) =>
      row.entity360_bounded_row === null)) {
      reportRetrievalBudgetExceeded(report, sourceId, retrievalBudget, attemptedBytes);
      return { rows: [], rowCount: 0 };
    }
    retrievalBudget.consume(sourceId, totalBytes);
    return { ...result, rows: result.rows.map((row) => row.entity360_bounded_row),
      rowCount: result.rows.length };
  }
  // Unit-test/injected clients may return the pre-wrapper row shape. The
  // production PostgreSQL path above performs the size gate before any raw
  // row crosses the database boundary; this fallback still enforces the same
  // policy contract for injected adapters.
  const fallbackBytes = Buffer.byteLength(JSON.stringify(result.rows));
  if (fallbackBytes > availableBytes) {
    reportRetrievalBudgetExceeded(report, sourceId, retrievalBudget, fallbackBytes);
    return { rows: [], rowCount: 0 };
  }
  retrievalBudget.consume(sourceId, fallbackBytes);
  return result;
}

async function readCausalBindingEvent(client, { tenantId, projectUuid, workId, asOf }, report) {
  if (!projectUuid || !UUID.test(String(projectUuid).toLowerCase())) return null;
  const result = assertTenantRows(await optionalQuery(client, `SELECT e.tenant_id,
      e.project_id::text AS event_project_uuid,e.event_id::text,e.sequence_number,e.event_type,
      e.operation,e.idempotency_key,e.request_digest,e.payload,e.payload_digest,
      e.actor_provenance,e.actor_provenance_digest,e.previous_event_hash,e.event_hash,e.created_at,
      predecessor.event_hash AS predecessor_event_hash
    FROM core_causal_event_ledger e
    LEFT JOIN core_causal_event_ledger predecessor
      ON predecessor.tenant_id=e.tenant_id AND predecessor.project_id=e.project_id
      AND predecessor.sequence_number=e.sequence_number-1
      AND ($4::timestamptz IS NULL OR predecessor.created_at <= $4::timestamptz)
    WHERE e.tenant_id=$1 AND e.project_id=$2::uuid
      AND e.event_type='WORK_OPENED' AND e.operation='work_bind_intent'
      AND e.payload->'result'->>'work_id'=$3
      AND ($4::timestamptz IS NULL OR e.created_at <= $4::timestamptz)
    ORDER BY e.sequence_number DESC LIMIT 2`,
  [tenantId, String(projectUuid).toLowerCase(), workId, asOf], "genesis", report), tenantId);
  return result.rows.length === 1 ? result.rows[0] : null;
}

function contribution({ scope, sourceId, adapterVersion, observedAt, recordedAt = observedAt,
  watermark, evidenceClass, evidenceDigest, evidenceRef,
  evidenceDigests = [evidenceDigest], evidenceRefs = [evidenceRef], facts }) {
  return {
    tenant_id: scope.tenant_id,
    entity_id: scope.entity_id,
    source_id: sourceId,
    adapter_version: adapterVersion,
    source_watermark: requiredText(watermark, "entity360_adapter_watermark_required", 240),
    observed_at: iso(observedAt, scope.as_of),
    recorded_at: iso(recordedAt, observedAt),
    evidence_class: evidenceClass,
    evidence_digests: evidenceDigests,
    evidence_refs: evidenceRefs,
    confidence: 1,
    facts: facts.map((fact) => ({
      observed_at: iso(fact.observed_at || observedAt, scope.as_of),
      recorded_at: iso(fact.recorded_at || recordedAt, observedAt),
      evidence_class: fact.evidence_class || evidenceClass,
      evidence_digests: fact.evidence_digests || evidenceDigests,
      evidence_refs: fact.evidence_refs || evidenceRefs,
      confidence: fact.confidence ?? 1,
      criticality: fact.criticality || "normal",
      state: fact.state || "current",
      ...fact,
    })),
  };
}

function exactAdapterObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...keys].sort()) ? value : null;
}

function readNsctDependencyValue(dependency, key) {
  const value = dependency?.[key];
  return typeof value === "function" ? value() : value;
}

function normalizeVerifiedNsctSet(value, scope, legacyWorkId, limits) {
  const verified = exactAdapterObject(value, ["schema_version", "tenant_scope", "legacy_work_id",
    "as_of", "heads", "status", "head_set_digest", "retrieval_measurement"]);
  const measurement = exactAdapterObject(verified?.retrieval_measurement,
    ["record_count", "storage_bytes", "payload_bytes"]);
  const recordCount = Number(measurement?.record_count);
  const storageBytes = Number(measurement?.storage_bytes);
  const payloadBytes = Number(measurement?.payload_bytes);
  if (!verified || verified.schema_version !== "nyra_precore_verified_as_of_work_v1"
    || verified.tenant_scope !== scope.tenant_id
    || String(verified.legacy_work_id || "").toLowerCase() !== legacyWorkId
    || iso(verified.as_of) !== scope.as_of || !Array.isArray(verified.heads) || !measurement
    || !Number.isSafeInteger(recordCount) || recordCount < 0 || recordCount > limits.max_records
    || !Number.isSafeInteger(storageBytes) || storageBytes < 0 || storageBytes > limits.max_bytes
    || !Number.isSafeInteger(payloadBytes) || payloadBytes < 0 || payloadBytes > limits.max_bytes
    || verified.status !== (verified.heads.length ? "VERIFIED" : "EMPTY")) {
    fail("entity360_nsct_verified_set_invalid", 503);
  }
  const heads = verified.heads.map((raw) => {
    const head = exactAdapterObject(raw, ["plan_ref", "decision_ref", "decision_digest",
      "disposition", "next_step", "freshness", "binding_digest"]);
    const freshness = exactAdapterObject(head?.freshness,
      ["evaluated_at", "recorded_at", "fresh_until", "state"]);
    const evaluatedAt = freshness ? iso(freshness.evaluated_at) : null;
    const recordedAt = freshness ? iso(freshness.recorded_at) : null;
    const freshUntil = freshness ? iso(freshness.fresh_until) : null;
    const expectedState = freshness && Date.parse(freshUntil) > Date.parse(scope.as_of)
      ? "fresh" : "stale";
    if (!head || !freshness
      || !/^nyra_precore_plan:[0-9a-f-]{36}$/u.test(String(head.plan_ref || ""))
      || !/^nyra_precore_decision:[0-9a-f-]{36}$/u.test(String(head.decision_ref || ""))
      || !/^[a-f0-9]{64}$/u.test(String(head.decision_digest || ""))
      || !/^[a-f0-9]{64}$/u.test(String(head.binding_digest || ""))
      || !["PROPOSE", "CHALLENGE", "ABSTAIN", "RECOMMEND_BLOCK"].includes(head.disposition)
      || !["PROPOSE_TO_CORE_REVIEW", "REMEDIATE", "COLLECT_EVIDENCE", "STOP_AND_REVIEW"]
        .includes(head.next_step)
      || Date.parse(evaluatedAt) > Date.parse(scope.as_of)
      || Date.parse(evaluatedAt) > Date.parse(recordedAt)
      || Date.parse(recordedAt) > Date.parse(scope.as_of)
      || Date.parse(freshUntil) <= Date.parse(evaluatedAt)
      || freshness.state !== expectedState) {
      fail("entity360_nsct_verified_set_invalid", 503);
    }
    return { plan_ref: head.plan_ref, decision_ref: head.decision_ref,
      decision_digest: head.decision_digest, disposition: head.disposition,
      next_step: head.next_step, freshness: { evaluated_at: evaluatedAt,
        recorded_at: recordedAt, fresh_until: freshUntil, state: freshness.state },
      binding_digest: head.binding_digest };
  });
  const sortedHeads = [...heads].sort((left, right) => left.plan_ref.localeCompare(right.plan_ref)
    || left.decision_ref.localeCompare(right.decision_ref));
  if (JSON.stringify(heads) !== JSON.stringify(sortedHeads)
    || new Set(heads.map((head) => head.plan_ref)).size !== heads.length
    || recordCount < heads.length) {
    fail("entity360_nsct_verified_set_invalid", 503);
  }
  const body = { schema_version: verified.schema_version, tenant_scope: verified.tenant_scope,
    legacy_work_id: legacyWorkId, as_of: scope.as_of, heads };
  if (!/^[a-f0-9]{64}$/u.test(String(verified.head_set_digest || ""))
    || entity360Digest(body) !== verified.head_set_digest) {
    fail("entity360_nsct_verified_set_invalid", 503);
  }
  return { heads, head_set_digest: verified.head_set_digest,
    retrieval_measurement: { record_count: recordCount, storage_bytes: storageBytes,
      payload_bytes: payloadBytes } };
}

async function discoverNsct(client, scope, legacyWorkId, report, dependency, ownerReadLimits) {
  let store;
  try {
    store = readNsctDependencyValue(dependency, "store");
    if (!store || typeof store.readVerifiedAsOfForWork !== "function") {
      report.push({ source_id: "nsct", state: "unavailable",
        reason_code: "NSCT_STORE_UNAVAILABLE" });
      return [];
    }
    if (readNsctDependencyValue(dependency, "mode") !== "ADVISORY") {
      report.push({ source_id: "nsct", state: "unavailable",
        reason_code: "NSCT_MODE_NOT_ADVISORY" });
      return [];
    }
    if (readNsctDependencyValue(dependency, "ready") !== true) {
      report.push({ source_id: "nsct", state: "unavailable",
        reason_code: "NSCT_STORE_NOT_READY" });
      return [];
    }
    const verifierReady = readNsctDependencyValue(dependency, "verifier_ready");
    if (verifierReady !== true || store.verification_ready !== true || store.mode !== "ADVISORY") {
      report.push({ source_id: "nsct", state: "unavailable",
        reason_code: "NSCT_VERIFIER_UNAVAILABLE" });
      return [];
    }
  } catch {
    report.push({ source_id: "nsct", state: "unavailable",
      reason_code: "NSCT_STORE_UNAVAILABLE" });
    return [];
  }
  const retrievalBudget = RETRIEVAL_BUDGETS.get(client);
  if (!retrievalBudget) fail("entity360_retrieval_budget_unavailable", 503);
  const availableBytes = retrievalBudget.available("nsct");
  if (availableBytes < 1) {
    reportRetrievalBudgetExceeded(report, "nsct", retrievalBudget);
    return [];
  }
  const boundedOwnerReadLimits = { ...ownerReadLimits,
    max_bytes: Math.min(ownerReadLimits.max_bytes, availableBytes) };
  let verified;
  try {
    verified = normalizeVerifiedNsctSet(await store.readVerifiedAsOfForWork({
      tenant_id: scope.tenant_id, work_id: legacyWorkId, as_of: scope.as_of,
    }, { transaction: client, limits: boundedOwnerReadLimits }), scope, legacyWorkId,
    boundedOwnerReadLimits);
  } catch (error) {
    if (error?.code === "nyra_precore_as_of_budget_exceeded") {
      reportRetrievalBudgetExceeded(report, "nsct", RETRIEVAL_BUDGETS.get(client),
        Number.isSafeInteger(error.attempted_bytes) ? error.attempted_bytes : null);
      return [];
    }
    const code = String(error?.code || "");
    const verificationFailure = code.startsWith("nyra_precore_as_of_")
      || code.startsWith("entity360_nsct_verified")
      || code === "entity360_adapter_timestamp_invalid";
    report.push({ source_id: "nsct", state: verificationFailure ? "rejected" : "unavailable",
      reason_code: verificationFailure ? "NSCT_VERIFICATION_FAILED" : "NSCT_STORE_UNAVAILABLE" });
    return [];
  }
  const retrievedBytes = Math.max(verified.retrieval_measurement.storage_bytes,
    verified.retrieval_measurement.payload_bytes);
  if (!retrievalBudget || retrievedBytes > retrievalBudget.available("nsct")) {
    reportRetrievalBudgetExceeded(report, "nsct", retrievalBudget, retrievedBytes);
    return [];
  }
  retrievalBudget.consume("nsct", retrievedBytes);
  if (!verified.heads.length) {
    report.push({ source_id: "nsct", state: "missing", reason_code: "NSCT_DECISION_MISSING" });
    return [];
  }
  const setRef = `nsct_head_set:${legacyWorkId}:${verified.head_set_digest}`;
  const evidenceDigests = [...new Set([verified.head_set_digest,
    ...verified.heads.flatMap((head) => [head.decision_digest, head.binding_digest])])].sort();
  const evidenceRefs = [...new Set([setRef,
    ...verified.heads.flatMap((head) => [head.plan_ref, head.decision_ref])])].sort();
  const multipleHeads = verified.heads.length > 1;
  const stale = !multipleHeads && verified.heads[0].freshness.state === "stale";
  const observedAt = verified.heads.map((head) => head.freshness.evaluated_at)
    .sort().at(-1) || scope.as_of;
  const recordedAt = verified.heads.map((head) => head.freshness.recorded_at)
    .sort().at(-1) || observedAt;
  const factState = multipleHeads ? "conflicting" : stale ? "stale" : "current";
  const item = contribution({ scope, sourceId: "nsct",
    adapterVersion: "nsct_entity360_adapter_v1", observedAt,
    recordedAt,
    watermark: `nsct:${verified.head_set_digest}`, evidenceClass: "analysis",
    evidenceDigest: verified.head_set_digest, evidenceRef: setRef,
    evidenceDigests, evidenceRefs,
    facts: [{ fact_id: "nsct.plan_heads", value: { set_ref: setRef,
      head_set_digest: verified.head_set_digest, heads: verified.heads },
    criticality: "normal", state: factState }] });
  if (multipleHeads) {
    report.push({ source_id: "nsct", state: "conflicting",
      reason_code: "NSCT_MULTIPLE_PLAN_HEADS_AS_OF", evidence_digest: verified.head_set_digest,
      evidence_ref: setRef });
  } else if (stale) {
    report.push({ source_id: "nsct", state: "stale", reason_code: "NSCT_EVIDENCE_STALE",
      evidence_digest: verified.head_set_digest, evidence_ref: setRef,
      valid_to: verified.heads[0].freshness.fresh_until });
  } else {
    report.push({ source_id: "nsct", state: "accepted",
      evidence_digest: verified.head_set_digest, evidence_ref: setRef });
  }
  return [item];
}

function completeSourceDiscovery(entityType, contributions, report) {
  const applicable = entityType === "work"
    ? ["genesis", "intent", "icf", "work_continuity", "architecture_map", "impact_map",
      "event_ledger", "security_intelligence", "nsct"]
    : entityType === "software_component" ? ["architecture_map"] : [];
  const occupied = new Set(contributions.map((item) => item.source_id));
  const reported = new Set(report.map((item) => item.source_id));
  for (const sourceId of applicable) {
    if (!occupied.has(sourceId) && !reported.has(sourceId)) {
      report.push({ source_id: sourceId, state: "missing",
        reason_code: "NO_ELIGIBLE_EVIDENCE_AS_OF" });
    }
  }
  const unwired = [
    ["shared_memory", "ADAPTER_NOT_WIRED_V1"],
    ["runtime_state", "ADAPTER_NOT_WIRED_V1"],
    ["universal_core", "AUTHORITY_SELF_CORROBORATION_EXCLUDED_V1"],
  ];
  for (const [sourceId, reasonCode] of unwired) {
    if (!reported.has(sourceId)) report.push({ source_id: sourceId,
      state: reasonCode.includes("EXCLUDED") ? "excluded" : "unavailable",
      reason_code: reasonCode });
  }
}

function finalizeSourceDiscovery(contributions, report) {
  // A source adapter is one trust boundary even when it needs several SQL
  // reads.  If any read in that boundary is unavailable, quarantine the whole
  // source batch; a partial authoritative contribution must not coexist with a
  // negative discovery state or masquerade as a complete cut.
  const unavailableSources = new Set(report.filter((item) => item.state === "unavailable"
    || item.reason_code === "SOURCE_RETRIEVAL_BUDGET_EXCEEDED")
    .map((item) => item.source_id));
  const filteredContributions = contributions.filter((item) =>
    !unavailableSources.has(item.source_id));
  const filteredReport = report.filter((item) => !unavailableSources.has(item.source_id)
    || !["accepted", "stale", "conflicting"].includes(item.state));
  const unique = [];
  const seen = new Set();
  for (const item of filteredReport) {
    const digest = entity360Digest(item);
    if (seen.has(digest)) continue;
    seen.add(digest);
    unique.push(item);
  }
  report.splice(0, report.length, ...unique);
  return filteredContributions;
}

async function resolveWorkCandidates(client, tenantId, identity, report, asOf = null) {
  const requestedWorkId = requiredUuid(identity.work_id || identity.legacy_work_id,
    "entity360_work_identity_required");
  const gallery = assertTenantRows(await optionalQuery(client, `SELECT tenant_id, work_id::text, legacy_work_id::text, work_code,
      work_name, work_type, project_id, status, intent_digest, updated_at
    FROM tenant_work
    WHERE tenant_id = $1 AND (work_id = $2::uuid OR legacy_work_id = $2::uuid)
      AND ($3::timestamptz IS NULL OR created_at <= $3::timestamptz)
    ORDER BY work_id
    LIMIT 2`, [tenantId, requestedWorkId, asOf], "work_continuity", report), tenantId);
  if (gallery.rows.length > 1) return {
    candidates: gallery.rows.map((row) => ({
      tenant_id: tenantId,
      entity_type: "work",
      identity: { work_id: row.work_id, legacy_work_id: row.legacy_work_id || row.work_id },
    })),
    project_work_linkage: {},
  };
  const galleryRow = gallery.rows[0] || null;
  const continuityWorkId = galleryRow?.legacy_work_id || requestedWorkId;
  const continuity = assertTenantRows(await optionalQuery(client, `SELECT tenant_id, work_id::text, project_id,
      project_uuid::text
    FROM core_continuity_works WHERE tenant_id = $1 AND work_id = $2::uuid
      AND ($3::timestamptz IS NULL OR created_at <= $3::timestamptz) LIMIT 2`,
  [tenantId, continuityWorkId, asOf], "work_continuity", report), tenantId);
  if (continuity.rows.length > 1) fail("entity360_continuity_identity_ambiguous", 409);
  const continuityRow = continuity.rows[0] || null;
  const causal = assertTenantRows(await optionalQuery(client, `SELECT b.tenant_id,b.work_id::text,
      b.project_id::text AS project_uuid,b.genesis_intent_id::text,b.intent_revision_id::text,
      b.base_state_digest,b.legacy_binding_state,b.provenance AS binding_provenance,
      b.created_at AS binding_created_at,
      g.project_id::text AS genesis_project_uuid,g.intent_text AS genesis_intent_text,
      g.canonical_digest AS genesis_digest,
      i.project_id::text AS intent_project_uuid,i.genesis_intent_id::text AS intent_genesis_intent_id,
      i.parent_revision_id::text AS intent_parent_revision_id,i.alias AS intent_alias,
      i.classification AS intent_classification,i.revision_payload AS intent_revision_payload,
      i.canonical_digest AS intent_revision_digest,i.state AS intent_state
    FROM core_work_causal_bindings b
    JOIN core_genesis_intents g ON g.tenant_id=b.tenant_id
      AND g.genesis_intent_id=b.genesis_intent_id AND g.project_id=b.project_id
    JOIN core_intent_revisions i ON i.tenant_id=b.tenant_id
      AND i.intent_revision_id=b.intent_revision_id AND i.project_id=b.project_id
      AND i.genesis_intent_id=b.genesis_intent_id
    WHERE b.tenant_id = $1 AND b.work_id = $2::uuid
      AND ($3::timestamptz IS NULL OR (b.created_at <= $3::timestamptz
        AND g.created_at <= $3::timestamptz AND i.created_at <= $3::timestamptz
        AND (i.decided_at IS NULL OR i.decided_at <= $3::timestamptz))) LIMIT 2`,
  [tenantId, continuityWorkId, asOf], "genesis", report), tenantId);
  if (causal.rows.length > 1) fail("entity360_causal_binding_ambiguous", 409);
  const causalRow = causal.rows[0] || null;
  const logicalProjects = projectSlugs([galleryRow?.project_id, continuityRow?.project_id]);
  reportProjectSlugConflict(report, logicalProjects);
  const continuityProjectUuid = optionalProjectUuid(continuityRow?.project_uuid);
  const bindingEvent = causalRow ? await readCausalBindingEvent(client, {
    tenantId, projectUuid: causalRow.project_uuid, workId: continuityWorkId, asOf,
  }, report) : null;
  const causalState = causalAuthorityState(causalRow, continuityProjectUuid, bindingEvent);
  reportCausalAuthorityGap(report, causalState, continuityProjectUuid);
  const candidates = galleryRow ? [{ tenant_id: tenantId, entity_type: "work", identity: {
    work_id: galleryRow.work_id,
    legacy_work_id: galleryRow.legacy_work_id || galleryRow.work_id,
  } }] : [];
  if (!galleryRow && continuityRow) report.push({ source_id: "work_continuity", state: "rejected",
    reason_code: "CANONICAL_GALLERY_IDENTITY_REQUIRED" });
  const canonicalWorkId = galleryRow?.work_id || null;
  const legacyWorkId = galleryRow?.legacy_work_id || null;
  return {
    candidates,
    project_work_linkage: canonicalWorkId ? {
      work_id: canonicalWorkId,
      legacy_work_id: legacyWorkId,
      project_id: logicalProjects.length === 1 ? logicalProjects[0] : null,
      project_uuid: causalState.eligible ? causalState.project_uuid : null,
    } : {},
  };
}

async function resolveSoftwareCandidates(client, tenantId, identity, report, asOf = null) {
  const workId = requiredUuid(identity.work_id, "entity360_component_work_identity_required");
  const nodeId = requiredText(identity.node_id, "entity360_component_node_identity_required", 160);
  const result = assertTenantRows(await optionalQuery(client, `SELECT tenant_id, node_id, work_id::text, project_id, revision
    FROM core_continuity_atlas_nodes
    WHERE tenant_id = $1 AND work_id = $2::uuid AND node_id = $3 AND active = true
      AND ($4::timestamptz IS NULL OR updated_at <= $4::timestamptz)
    ORDER BY revision DESC LIMIT 2`, [tenantId, workId, nodeId, asOf], "architecture_map", report), tenantId);
  return {
    candidates: result.rows.map((row) => ({ tenant_id: tenantId, entity_type: "software_component",
      identity: { work_id: row.work_id, node_id: row.node_id } })),
    project_work_linkage: result.rows.length === 1 ? {
      work_id: result.rows[0].work_id,
      component_id: result.rows[0].node_id,
      project_id: result.rows[0].project_id || null,
    } : {},
  };
}

async function discoverWork(client, scope, report, nsctDependency, nsctOwnerReadLimits) {
  const workId = requiredUuid(scope.identity.work_id, "entity360_work_identity_required");
  const legacyWorkId = scope.identity.legacy_work_id && UUID.test(scope.identity.legacy_work_id)
    ? scope.identity.legacy_work_id : workId;
  const resolutionProjectConflict = report.some((item) =>
    item.reason_code === "WORK_PROJECT_LINKAGE_CONFLICT");
  const contributions = [];
  const galleryResult = assertTenantRows(await optionalQuery(client, `SELECT tenant_id, work_id::text, legacy_work_id::text, work_code,
      work_name, work_type, project_id, status, progress_bp, progress_version, progress_source, priority,
      intent_digest, objective, next_action, acceptance_criteria, updated_at, created_at
    FROM tenant_work WHERE tenant_id = $1 AND work_id = $2::uuid
      AND updated_at <= $3::timestamptz LIMIT 2`,
  [scope.tenant_id, workId, scope.as_of], "work_continuity", report), scope.tenant_id);
  if (galleryResult.rows.length > 1) fail("entity360_gallery_identity_ambiguous", 409);
  const gallery = galleryResult.rows[0] || null;
  const continuityResult = assertTenantRows(await optionalQuery(client, `SELECT tenant_id, project_id,project_uuid::text,
      work_id::text, session_id,
      parent_work_id::text, idea, objective, status, current_version, repository_hash, policy_hash,
      live_state_hash, next_action, created_at, updated_at
    FROM core_continuity_works WHERE tenant_id = $1 AND work_id = $2::uuid
      AND updated_at <= $3::timestamptz LIMIT 2`,
  [scope.tenant_id, gallery?.legacy_work_id || legacyWorkId, scope.as_of], "work_continuity", report), scope.tenant_id);
  if (continuityResult.rows.length > 1) fail("entity360_continuity_identity_ambiguous", 409);
  const continuity = continuityResult.rows[0] || null;
  if (!gallery) {
    report.push({ source_id: "work_continuity", state: "rejected",
      reason_code: continuity ? "CANONICAL_GALLERY_IDENTITY_REQUIRED" : "WORK_NOT_FOUND" });
    return contributions;
  }
  const observedAt = gallery?.updated_at || continuity?.updated_at || scope.as_of;
  const workRecord = {
    gallery: gallery ? selectedRow(gallery, ["work_id", "legacy_work_id", "work_code", "work_name", "work_type",
      "project_id", "status", "progress_bp", "progress_version", "progress_source", "priority", "intent_digest",
      "objective", "next_action", "acceptance_criteria", "updated_at", "created_at"]) : null,
    continuity: continuity ? selectedRow(continuity, ["project_id", "project_uuid", "work_id", "session_id", "parent_work_id", "idea",
      "objective", "status", "current_version", "repository_hash", "policy_hash", "live_state_hash", "next_action",
      "created_at", "updated_at"]) : null,
  };
  const workDigest = entity360Digest(workRecord);
  const workEvidenceRef = `work_continuity:${gallery?.work_id || continuity?.work_id}:${continuity?.current_version || 1}`;
  const identityBase = {
    work_id: gallery.work_id,
    legacy_work_id: gallery.legacy_work_id || legacyWorkId,
    work_code: gallery.work_code || null,
    work_name: gallery.work_name || continuity?.idea || null,
  };
  const workProjects = projectSlugs([gallery.project_id, continuity?.project_id]);
  const identityFacts = [
    ...(gallery.project_id ? [{ project_id: gallery.project_id, observed_at: gallery.updated_at }] : []),
    ...(continuity?.project_id
      ? [{ project_id: continuity.project_id, observed_at: continuity.updated_at }] : []),
  ];
  if (!identityFacts.length) identityFacts.push({ project_id: null, observed_at: observedAt });
  const workContribution = contribution({ scope, sourceId: "work_continuity",
    adapterVersion: "work_continuity_entity360_adapter_v1", observedAt,
    watermark: `work:${gallery?.work_id || continuity?.work_id}:${continuity?.current_version || gallery?.progress_version || 1}`,
    evidenceClass: "authoritative_record", evidenceDigest: workDigest,
    evidenceRef: workEvidenceRef,
    facts: [
      ...identityFacts.map((fact) => ({ fact_id: "work.identity", value: {
        ...identityBase, project_id: fact.project_id,
      }, criticality: "high_impact", observed_at: fact.observed_at, recorded_at: fact.observed_at,
      state: resolutionProjectConflict || workProjects.length > 1 ? "conflicting" : "current" })),
      ...(gallery?.status ? [{ fact_id: "work.current_state", value: {
        status: String(gallery.status).trim().toUpperCase(),
      }, criticality: "high_impact", evidence_class: "verified_observation",
      observed_at: gallery.updated_at, recorded_at: gallery.updated_at }] : []),
      ...(continuity?.status ? [{ fact_id: "work.current_state", value: {
        status: String(continuity.status).trim().toUpperCase(),
      }, criticality: "high_impact", evidence_class: "verified_observation",
      observed_at: continuity.updated_at, recorded_at: continuity.updated_at }] : []),
      ...(gallery ? [{ fact_id: "work.gallery_state_details", value: {
        progress_bp: gallery.progress_bp ?? null,
        progress_version: gallery.progress_version ?? null,
        next_action: gallery.next_action || null,
      }, criticality: "normal", evidence_class: "verified_observation" }] : []),
      ...(continuity ? [{ fact_id: "work.continuity_state_details", value: {
        current_version: continuity.current_version ?? null,
        next_action: continuity.next_action || null,
      }, criticality: "normal", evidence_class: "verified_observation" }] : []),
      { fact_id: "work.acceptance_criteria", value: {
        criteria_digest: entity360Digest(gallery?.acceptance_criteria || []),
        item_count: Array.isArray(gallery?.acceptance_criteria)
          ? gallery.acceptance_criteria.length : 0,
      }, criticality: "critical" },
    ] });
  contributions.push(workContribution);
  report.push({ source_id: "work_continuity", state: "accepted", evidence_digest: workDigest,
    evidence_ref: workEvidenceRef });

  const intentResult = assertTenantRows(await optionalQuery(client, `SELECT tenant_id,project_id,intent_digest,anchor,created_at
    FROM core_continuity_intent_anchors
    WHERE tenant_id = $1 AND work_id = $2::uuid AND created_at <= $3::timestamptz LIMIT 2`,
  [scope.tenant_id, gallery?.legacy_work_id || legacyWorkId, scope.as_of], "intent", report), scope.tenant_id);
  if (intentResult.rows.length > 1) fail("entity360_intent_binding_ambiguous", 409);
  const anchor = intentResult.rows[0] || null;
  const anchoredIntentDigest = String(anchor?.intent_digest || "").toLowerCase();
  const intentAnchor = anchor?.anchor;
  let intentAnchorPayloadVerified = false;
  try {
    intentAnchorPayloadVerified = Boolean(intentAnchor && typeof intentAnchor === "object"
      && !Array.isArray(intentAnchor) && intentAnchor.schema_version === "intent_anchor_v1"
      && intentAnchor.immutable === true
      && entity360Digest(intentAnchor) === anchoredIntentDigest);
  } catch {
    intentAnchorPayloadVerified = false;
  }

  const causalWorkId = gallery?.legacy_work_id || continuity?.work_id || legacyWorkId;
  const causalBindingResult = assertTenantRows(await optionalQuery(client, `SELECT b.tenant_id,b.work_id::text,
      b.project_id::text AS project_uuid,b.genesis_intent_id::text,b.intent_revision_id::text,
      b.base_state_digest,b.legacy_binding_state,b.provenance AS binding_provenance,
      b.created_at AS binding_created_at,
      g.project_id::text AS genesis_project_uuid,g.canonical_digest AS genesis_digest,
      g.intent_text AS genesis_intent_text,g.created_at AS genesis_created_at,
      i.project_id::text AS intent_project_uuid,
      i.genesis_intent_id::text AS intent_genesis_intent_id,
      i.parent_revision_id::text AS intent_parent_revision_id,i.alias AS intent_alias,
      i.classification AS intent_classification,i.revision_payload AS intent_revision_payload,
      i.canonical_digest AS intent_revision_digest,i.state AS intent_state,
      i.created_at AS intent_created_at,i.decided_at AS intent_decided_at
    FROM core_work_causal_bindings b
    JOIN core_genesis_intents g ON g.tenant_id=b.tenant_id
      AND g.genesis_intent_id=b.genesis_intent_id AND g.project_id=b.project_id
    JOIN core_intent_revisions i ON i.tenant_id=b.tenant_id
      AND i.intent_revision_id=b.intent_revision_id AND i.project_id=b.project_id
      AND i.genesis_intent_id=b.genesis_intent_id
    WHERE b.tenant_id=$1 AND b.work_id=$2::uuid AND b.created_at <= $3::timestamptz
      AND g.created_at <= $3::timestamptz AND i.created_at <= $3::timestamptz
      AND (i.decided_at IS NULL OR i.decided_at <= $3::timestamptz) LIMIT 2`,
  [scope.tenant_id, causalWorkId, scope.as_of], "genesis", report), scope.tenant_id);
  if (causalBindingResult.rows.length > 1) fail("entity360_causal_binding_ambiguous", 409);
  const causalBinding = causalBindingResult.rows[0] || null;
  const continuityProjectUuid = optionalProjectUuid(continuity?.project_uuid);
  const bindingEvent = causalBinding ? await readCausalBindingEvent(client, {
    tenantId: scope.tenant_id, projectUuid: causalBinding.project_uuid,
    workId: causalWorkId, asOf: scope.as_of,
  }, report) : null;
  const causalState = causalAuthorityState(causalBinding, continuityProjectUuid, bindingEvent);
  reportCausalAuthorityGap(report, causalState, continuityProjectUuid);
  const projectLinkageConflict = resolutionProjectConflict || workProjects.length > 1;
  if (projectLinkageConflict) {
    for (const fact of workContribution.facts.filter((item) => item.fact_id === "work.identity")) {
      fact.state = "conflicting";
    }
  }
  reportProjectSlugConflict(report, workProjects);
  const logicalProjectSlug = workProjects.length === 1 ? workProjects[0] : null;
  const anchorProjectSlug = anchor?.project_id
    ? requiredText(anchor.project_id, "entity360_intent_anchor_project_slug_invalid", 128) : null;
  const causalIntentDigest = String(causalBinding?.intent_revision_digest || "").toLowerCase();
  const galleryIntentDigest = String(gallery.intent_digest || "").toLowerCase();
  const anchorProjectValid = Boolean(anchor && logicalProjectSlug
    && anchorProjectSlug === logicalProjectSlug);
  const anchorDigestValid = /^[a-f0-9]{64}$/u.test(anchoredIntentDigest)
    && intentAnchorPayloadVerified
    && (!galleryIntentDigest || galleryIntentDigest === anchoredIntentDigest);
  const causalIntentDigestValid = /^[a-f0-9]{64}$/u.test(causalIntentDigest);
  if (anchor && !anchorProjectValid && !report.some((item) =>
    item.reason_code === "INTENT_ANCHOR_PROJECT_SLUG_MISMATCH")) {
    report.push({ source_id: "intent", state: "rejected",
      reason_code: "INTENT_ANCHOR_PROJECT_SLUG_MISMATCH",
      ...(logicalProjectSlug ? { expected_project_slug: logicalProjectSlug } : {}),
      ...(anchorProjectSlug ? { observed_project_slug: anchorProjectSlug } : {}) });
  } else if (anchor && !anchorDigestValid && !report.some((item) =>
    item.reason_code === "INTENT_ANCHOR_DIGEST_MISMATCH")) {
    report.push({ source_id: "intent", state: "rejected",
      reason_code: "INTENT_ANCHOR_DIGEST_MISMATCH" });
  }
  const governanceBindingVerified = causalState.eligible && anchorProjectValid && anchorDigestValid
    && causalIntentDigestValid
    && /^[a-f0-9]{64}$/u.test(String(causalBinding?.genesis_digest || ""));
  if (governanceBindingVerified) {
    const intentBinding = {
      intent_anchor_digest: anchoredIntentDigest,
      intent_revision_id: causalBinding.intent_revision_id,
      intent_revision_digest: causalIntentDigest,
      genesis_intent_id: causalBinding.genesis_intent_id,
    };
    const intentAnchorEvidenceRef = `intent_anchor:${anchoredIntentDigest}`;
    contributions.push(contribution({ scope, sourceId: "intent",
      adapterVersion: "intent_entity360_adapter_v1", observedAt: scope.as_of,
      recordedAt: causalBinding.intent_decided_at || causalBinding.intent_created_at,
      watermark: `intent_binding:${causalBinding.intent_revision_id}:${causalState.binding_event_hash}`,
      evidenceClass: "authoritative_record",
      evidenceDigests: [anchoredIntentDigest, causalIntentDigest, causalState.binding_event_hash],
      evidenceRefs: [intentAnchorEvidenceRef,
        `intent_revision:${causalBinding.intent_revision_id}`,
        `work_causal_binding:${causalWorkId}:${causalBinding.intent_revision_id}`,
        causalState.binding_event_ref],
      facts: [{ fact_id: "governance.intent.binding",
        value: intentBinding, criticality: "high_impact",
        valid_from: iso(causalBinding.intent_decided_at || causalBinding.intent_created_at) }] }));
    report.push({ source_id: "intent", state: "accepted",
      evidence_digest: causalState.binding_event_hash,
      evidence_ref: causalState.binding_event_ref });
    const genesisEvidenceRef = `genesis:${causalBinding.genesis_intent_id}`;
    contributions.push(contribution({ scope, sourceId: "genesis",
      adapterVersion: "genesis_entity360_adapter_v1", observedAt: scope.as_of,
      recordedAt: causalBinding.genesis_created_at,
      watermark: `genesis:${causalBinding.genesis_intent_id}:${causalState.binding_event_hash}`,
      evidenceClass: "authoritative_record",
      evidenceDigests: [causalBinding.genesis_digest, causalState.binding_event_hash],
      evidenceRefs: [genesisEvidenceRef, causalState.binding_event_ref],
      facts: [{ fact_id: "governance.genesis.binding", value: {
        project_uuid: causalState.project_uuid,
        genesis_intent_id: causalBinding.genesis_intent_id,
        genesis_digest: causalBinding.genesis_digest,
      }, criticality: "high_impact", valid_from: iso(causalBinding.genesis_created_at) }] }));
    report.push({ source_id: "genesis", state: "accepted",
      evidence_digest: causalState.binding_event_hash,
      evidence_ref: causalState.binding_event_ref });
  } else {
    if (!report.some((item) => item.source_id === "intent" && item.state === "missing")) {
      report.push({ source_id: "intent", state: "missing",
        reason_code: anchor ? "AUTHORITATIVE_INTENT_BINDING_UNAVAILABLE"
          : "AUTHORITATIVE_INTENT_ANCHOR_MISSING" });
    }
    if (!report.some((item) => item.source_id === "genesis" && item.state === "missing")) {
      report.push({ source_id: "genesis", state: "missing", reason_code: "GENESIS_BINDING_MISSING" });
    }
  }

  const icfResult = assertTenantRows(await optionalQuery(client, `SELECT tenant_id,version,ledger_head_digest,
      ledger_head_digest_contract,updated_at
    FROM core_icf_work WHERE tenant_id=$1 AND work_id=$2 AND updated_at <= $3::timestamptz LIMIT 2`,
  [scope.tenant_id, causalWorkId, scope.as_of], "icf", report), scope.tenant_id);
  if (icfResult.rows.length > 1) fail("entity360_icf_binding_ambiguous", 409);
  const icf = icfResult.rows[0] || null;
  const icfEventResult = assertTenantRows(await optionalQuery(client, `SELECT tenant_id,work_id,seq,event_type,payload,
      previous_digest,digest,digest_contract,canonicalization_version,digest_algorithm,payload_digest,
      previous_digest_contract,created_at
    FROM core_icf_event WHERE tenant_id=$1 AND work_id=$2 AND created_at <= $3::timestamptz
    ORDER BY seq DESC LIMIT 1`,
  [scope.tenant_id, causalWorkId, scope.as_of], "icf", report), scope.tenant_id);
  const icfEvent = icfEventResult.rows[0] || null;
  const icfDigest = String(icf?.ledger_head_digest || "").toLowerCase();
  const icfEventStoredDigest = String(icfEvent?.digest || "").toLowerCase();
  const icfVersion = Number(icf?.version);
  const icfEventSequence = Number(icfEvent?.seq);
  const icfEventVerification = verifyIcfEventDigestV2({ event: icfEvent,
    tenantId: scope.tenant_id, workId: causalWorkId });
  const icfBindingVerified = Boolean(icf && icfEvent
    && String(icfEvent.work_id || "").toLowerCase() === causalWorkId
    && /^[a-f0-9]{64}$/u.test(icfDigest)
    && icfEventVerification.verified
    && Number.isSafeInteger(icfVersion) && icfVersion > 0
    && Number.isSafeInteger(icfEventSequence) && icfEventSequence === icfVersion
    && icfEventStoredDigest === icfDigest
    && icf?.ledger_head_digest_contract === ICF_EVENT_DIGEST_CONTRACT_V2);
  if (icfBindingVerified) {
    const icfEvidenceRef = `icf_event:${causalWorkId}:${icfEventSequence}`;
    // Freshness belongs to the verified event head, never to the assembly cut.
    // core_icf_work.state is a mutable projection and is intentionally absent:
    // the append-only event digest does not evidence-bind that projection.
    contributions.push(contribution({ scope, sourceId: "icf", adapterVersion: "icf_entity360_adapter_v2",
      observedAt: icfEvent.created_at, recordedAt: icfEvent.created_at,
      watermark: `icf:${icfEventSequence}:${icfEventStoredDigest}`,
      evidenceClass: "authoritative_record", evidenceDigest: icfDigest,
      evidenceRef: icfEvidenceRef,
      facts: [{ fact_id: "governance.icf.binding", value: { version: icfEventSequence,
        ledger_head_digest: icfDigest },
      criticality: "high_impact", valid_from: iso(icfEvent.created_at) }] }));
    report.push({ source_id: "icf", state: "accepted", evidence_digest: icfDigest,
      evidence_ref: icfEvidenceRef });
  } else {
    const icfUnavailable = report.some((item) => item.source_id === "icf"
      && item.state === "unavailable");
    if (!icfUnavailable) {
      const digestAndHeadPresent = Boolean(icf && icfEvent && /^[a-f0-9]{64}$/u.test(icfDigest));
      const reasonCode = !digestAndHeadPresent ? "ICF_BINDING_MISSING"
        : !icfEventVerification.verified ? icfEventVerification.reason_code
          : icf?.ledger_head_digest_contract !== ICF_EVENT_DIGEST_CONTRACT_V2
            ? "ICF_EVENT_DIGEST_CONTRACT_UNSUPPORTED" : "ICF_BINDING_MISSING";
      report.push({ source_id: "icf", state: icf ? "rejected" : "missing",
        reason_code: reasonCode });
    }
  }

  const securityResult = assertTenantRows(await optionalQuery(client, `SELECT tenant_id,observation_id::text,
      project_id::text,intent_revision_id::text,work_id::text,change_id::text,obligation_id::text,
      source,observer_identity,observer_role,provenance,independence,baseline,freshness_seconds,
      observed_at,evidence_digest,causal_relation,confidence,contradiction_status,observation_digest
    FROM core_reality_observations
    WHERE tenant_id=$1 AND work_id=$2::uuid
      AND observed_at <= $3::timestamptz
      AND (baseline->>'schema_version'='software_security_assessment_v1'
        OR baseline->>'subject_kind'='software_security_assessment_v1')
    ORDER BY observed_at DESC,observation_id LIMIT 16`,
  [scope.tenant_id, causalWorkId, scope.as_of], "security_intelligence", report), scope.tenant_id);
  const securityContributions = [];
  const securityAdmittedReports = [];
  const securityRejectedReports = [];
  for (const security of securityResult.rows) {
    const evidenceRef = `security_observation:${security.observation_id}`;
    const evidenceDigest = String(security.evidence_digest || "").toLowerCase();
    const observationDigest = String(security.observation_digest || "").toLowerCase();
    let observationDigestVerified = false;
    try {
      observationDigestVerified = /^[a-f0-9]{64}$/u.test(observationDigest)
        && observationDigest === projectScopeObservationDigest(security);
    } catch {
      observationDigestVerified = false;
    }
    if (!observationDigestVerified || !/^[a-f0-9]{64}$/u.test(evidenceDigest)) {
      securityRejectedReports.push({ source_id: "security_intelligence", state: "rejected",
        reason_code: "SECURITY_OBSERVATION_DIGEST_MISMATCH", evidence_ref: evidenceRef,
        ...(/^[a-f0-9]{64}$/u.test(evidenceDigest) ? { evidence_digest: evidenceDigest } : {}) });
      continue;
    }
    if (!securityObservationAdmitted(security)) {
      securityRejectedReports.push({ source_id: "security_intelligence", state: "rejected",
        reason_code: "SECURITY_OBSERVATION_ADMISSION_REJECTED",
        evidence_digest: observationDigest, evidence_ref: evidenceRef });
      continue;
    }
    const freshnessSeconds = Number(security.freshness_seconds);
    const observedMilliseconds = Date.parse(String(security.observed_at || ""));
    if (!Number.isFinite(freshnessSeconds) || freshnessSeconds <= 0
      || !Number.isFinite(observedMilliseconds)) {
      securityRejectedReports.push({ source_id: "security_intelligence", state: "rejected",
        reason_code: "SECURITY_OBSERVATION_FRESHNESS_INVALID", evidence_digest: evidenceDigest,
        evidence_ref: evidenceRef });
      continue;
    }
    const validTo = new Date(observedMilliseconds + freshnessSeconds * 1000).toISOString();
    const expired = Date.parse(validTo) <= Date.parse(scope.as_of);
    if (expired) securityAdmittedReports.push({ source_id: "security_intelligence", state: "stale",
      reason_code: "SECURITY_OBSERVATION_EXPIRED", evidence_digest: evidenceDigest,
      evidence_ref: evidenceRef, valid_to: validTo });
    securityContributions.push(contribution({ scope, sourceId: "security_intelligence",
      adapterVersion: "security_intelligence_entity360_adapter_v1", observedAt: security.observed_at,
      watermark: `security:${security.observation_id}:${observationDigest}`,
      evidenceClass: "verified_observation",
      evidenceDigests: [evidenceDigest, observationDigest], evidenceRefs: [evidenceRef],
      facts: [{ fact_id: `security.signal.${security.observation_id}`, value: {
        source: security.source,
        observer_role: security.observer_role,
        independence: security.independence,
        baseline_digest: entity360Digest(security.baseline || {}),
        contradiction_status: security.contradiction_status,
        freshness_seconds: freshnessSeconds,
      }, criticality: security.contradiction_status === "CONFIRMED" ? "high_impact" : "critical",
      confidence: Number(security.confidence),
      // Expired evidence remains explicitly stale; the expiry boundary is carried
      // in source_discovery because a past fact valid_to would classify it as historical.
      valid_to: expired ? null : validTo,
      state: expired ? "stale"
        : security.contradiction_status === "CONFIRMED" ? "conflicting" : "current" }] }));
    if (!expired) securityAdmittedReports.push({ source_id: "security_intelligence", state: "accepted",
      evidence_digest: observationDigest, evidence_ref: evidenceRef });
  }
  // The discovery contract is source-bound. Any structurally invalid Security
  // record quarantines this bounded source batch so a poisoned row cannot hide
  // behind a second valid contribution from the same trust class.
  if (securityRejectedReports.length) report.push(...securityRejectedReports);
  else {
    contributions.push(...securityContributions);
    report.push(...securityAdmittedReports);
  }
  if (!securityResult.rows.length) {
    report.push({ source_id: "security_intelligence", state: "missing",
      reason_code: "SECURITY_OBSERVATION_MISSING" });
  }

  const architectureResult = assertTenantRows(await optionalQuery(client, `SELECT tenant_id,version, architecture_digest, architecture,
      impact_map, created_at FROM core_continuity_architecture_versions
    WHERE tenant_id = $1 AND work_id = $2::uuid AND created_at <= $3::timestamptz
    ORDER BY version DESC LIMIT 1`,
  [scope.tenant_id, gallery?.legacy_work_id || legacyWorkId, scope.as_of], "architecture_map", report), scope.tenant_id);
  const architecture = architectureResult.rows[0] || null;
  const architectureDigest = String(architecture?.architecture_digest || "").toLowerCase();
  let architectureDigestVerified = false;
  try {
    architectureDigestVerified = Boolean(architecture && /^[a-f0-9]{64}$/u.test(architectureDigest)
      && entity360Digest(architecture.architecture) === architectureDigest);
  } catch {
    architectureDigestVerified = false;
  }
  if (architectureDigestVerified) {
    const architectureEvidenceRef = `architecture_map:${gallery?.work_id || workId}:${architecture.version}`;
    contributions.push(contribution({ scope, sourceId: "architecture_map",
      adapterVersion: "architecture_map_entity360_adapter_v1", observedAt: architecture.created_at,
      watermark: `architecture:${architecture.version}`, evidenceClass: "verified_observation",
      evidenceDigest: architectureDigest,
      evidenceRef: architectureEvidenceRef,
      facts: [{ fact_id: "work.architecture", value: { version: Number(architecture.version),
        architecture_digest: architectureDigest }, criticality: "critical" }] }));
    report.push({ source_id: "architecture_map", state: "accepted",
      evidence_digest: architectureDigest, evidence_ref: architectureEvidenceRef });
    const impactDigest = entity360Digest({ version: Number(architecture.version), impact_map: architecture.impact_map });
    const impactEvidenceRef = `impact_map:${gallery?.work_id || workId}:${architecture.version}`;
    contributions.push(contribution({ scope, sourceId: "impact_map",
      adapterVersion: "impact_map_entity360_adapter_v1", observedAt: architecture.created_at,
      watermark: `impact:${architecture.version}`, evidenceClass: "analysis", evidenceDigest: impactDigest,
      evidenceRef: impactEvidenceRef,
      facts: [{ fact_id: "work.impact_map", value: { version: Number(architecture.version),
        digest: impactDigest }, criticality: "normal", confidence: 0.7 }] }));
    report.push({ source_id: "impact_map", state: "accepted", evidence_digest: impactDigest,
      evidence_ref: impactEvidenceRef });
  } else if (architecture) {
    report.push({ source_id: "architecture_map", state: "rejected",
      reason_code: "ARCHITECTURE_DIGEST_MISMATCH" });
  }

  const eventResult = assertTenantRows(await optionalQuery(client, `SELECT tenant_id,work_id::text,sequence_number,
      event_hash,event_type,payload,previous_event_hash,created_at
    FROM core_continuity_events WHERE tenant_id = $1 AND work_id = $2::uuid
      AND created_at <= $3::timestamptz
    ORDER BY sequence_number DESC LIMIT 1`,
  [scope.tenant_id, gallery?.legacy_work_id || legacyWorkId, scope.as_of], "event_ledger", report), scope.tenant_id);
  const event = eventResult.rows[0] || null;
  const eventDigest = String(event?.event_hash || "").toLowerCase();
  let eventDigestVerified = false;
  try {
    eventDigestVerified = Boolean(event && /^[a-f0-9]{64}$/u.test(eventDigest)
      && String(event.work_id || "").toLowerCase() === (gallery?.legacy_work_id || legacyWorkId)
      && entity360Digest({ tenant_id: scope.tenant_id,
        work_id: gallery?.legacy_work_id || legacyWorkId,
        sequence_number: Number(event.sequence_number), event_type: event.event_type,
        payload: event.payload, previous_event_hash: event.previous_event_hash || null }) === eventDigest);
  } catch {
    eventDigestVerified = false;
  }
  if (eventDigestVerified) {
    const eventEvidenceRef = `event_ledger:${gallery?.work_id || workId}:${event.sequence_number}`;
    contributions.push(contribution({ scope, sourceId: "event_ledger",
      adapterVersion: "event_ledger_entity360_adapter_v1", observedAt: event.created_at,
      watermark: `event:${event.sequence_number}:${eventDigest}`, evidenceClass: "event",
      evidenceDigest: eventDigest,
      evidenceRef: eventEvidenceRef,
      facts: [{ fact_id: "work.event_ledger_head", value: { sequence: Number(event.sequence_number),
        event_hash: eventDigest, event_type: event.event_type }, criticality: "normal" }] }));
    report.push({ source_id: "event_ledger", state: "accepted", evidence_digest: eventDigest,
      evidence_ref: eventEvidenceRef });
  } else if (event) {
    report.push({ source_id: "event_ledger", state: "rejected",
      reason_code: "EVENT_LEDGER_DIGEST_MISMATCH" });
  }
  contributions.push(...await discoverNsct(client, scope,
    gallery?.legacy_work_id || legacyWorkId, report, nsctDependency, nsctOwnerReadLimits));
  return contributions;
}

async function discoverSoftwareComponent(client, scope, report) {
  const workId = requiredUuid(scope.identity.work_id, "entity360_component_work_identity_required");
  const nodeId = requiredText(scope.identity.node_id, "entity360_component_node_identity_required", 160);
  const result = assertTenantRows(await optionalQuery(client, `SELECT n.tenant_id,n.work_id::text, n.project_id, n.node_id, n.node_kind, n.path,
      n.symbol,n.summary,n.metadata,n.node_digest,n.context_bytes,n.revision,n.source_kind,n.source_ref,
      n.source_digest,n.provenance,n.verification_state,n.confidence,n.updated_at,
      h.source_digest AS atlas_source_digest, h.node_count, h.created_at AS revision_created_at
    FROM core_continuity_atlas_nodes n
    LEFT JOIN core_continuity_atlas_revision_history h
      ON h.tenant_id = n.tenant_id AND h.work_id = n.work_id AND h.revision = n.revision
      AND h.created_at <= $4::timestamptz
    WHERE n.tenant_id = $1 AND n.work_id = $2::uuid AND n.node_id = $3 AND n.active = true
      AND n.updated_at <= $4::timestamptz
    LIMIT 2`, [scope.tenant_id, workId, nodeId, scope.as_of], "architecture_map", report), scope.tenant_id);
  if (result.rows.length > 1) fail("entity360_component_identity_ambiguous", 409);
  const node = result.rows[0];
  if (!node) {
    report.push({ source_id: "architecture_map", state: "missing", reason_code: "COMPONENT_NOT_FOUND" });
    return [];
  }
  if (!/^[a-f0-9]{64}$/u.test(String(node.atlas_source_digest || ""))) {
    report.push({ source_id: "architecture_map", state: "missing",
      reason_code: "COMPONENT_REVISION_HISTORY_MISSING_AS_OF" });
    return [];
  }
  const nodeCount = Number(node.node_count);
  if (!Number.isSafeInteger(nodeCount) || nodeCount < 0) {
    report.push({ source_id: "architecture_map", state: "rejected",
      reason_code: "COMPONENT_REVISION_HISTORY_INVALID" });
    return [];
  }
  if (String(node.verification_state || "").toLowerCase() !== "verified") {
    report.push({ source_id: "architecture_map", state: "rejected",
      reason_code: "COMPONENT_ATLAS_VERIFICATION_REQUIRED" });
    return [];
  }
  const normalizedNode = {
    node_id: node.node_id,
    node_kind: node.node_kind,
    path: node.path,
    symbol: node.symbol,
    summary: node.summary,
    metadata: node.metadata,
    source_kind: node.source_kind,
    source_ref: node.source_ref,
    provenance: node.provenance,
    verification_state: node.verification_state,
    confidence: Number(node.confidence),
  };
  const nodeDigest = String(node.node_digest || "").toLowerCase();
  const contextBytes = Number(node.context_bytes);
  let nodeDigestVerified = false;
  try {
    nodeDigestVerified = /^[a-f0-9]{64}$/u.test(nodeDigest)
      && entity360Digest(normalizedNode) === nodeDigest
      && Number.isSafeInteger(contextBytes) && contextBytes >= 0
      && Buffer.byteLength(JSON.stringify(normalizedNode)) === contextBytes;
  } catch {
    nodeDigestVerified = false;
  }
  if (!nodeDigestVerified) {
    report.push({ source_id: "architecture_map", state: "rejected",
      reason_code: "ARCHITECTURE_DIGEST_MISMATCH" });
    return [];
  }
  const evidenceDigest = nodeDigest;
  const evidenceRef = `software_atlas:${workId}:${nodeId}:${node.revision}`;
  report.push({ source_id: "architecture_map", state: "accepted", evidence_digest: evidenceDigest,
    evidence_ref: evidenceRef });
  return [contribution({ scope, sourceId: "architecture_map",
    adapterVersion: "architecture_map_entity360_adapter_v1",
    observedAt: node.revision_created_at || node.updated_at,
    watermark: `atlas:${node.revision}:${node.atlas_source_digest}`,
    evidenceClass: "verified_observation", evidenceDigest,
    evidenceRef,
    facts: [
      { fact_id: "component.identity", value: { work_id: workId, project_id: node.project_id || null,
        node_id: nodeId, node_kind: node.node_kind, path: node.path, symbol: node.symbol },
      criticality: "high_impact" },
      { fact_id: "component.revision", value: { revision: Number(node.revision), node_digest: evidenceDigest,
        source_digest: node.source_digest || null,
        atlas_source_digest: node.atlas_source_digest }, criticality: "high_impact" },
      { fact_id: "component.architecture_state", value: { verification_state: node.verification_state,
        confidence: Number(node.confidence), node_count: nodeCount }, criticality: "critical",
      confidence: Math.min(1, Math.max(0, Number(node.confidence))) },
    ] })];
}

export function createPostgresEntity360AdapterRegistry({ pool, policy, nsct = null } = {}) {
  if (!pool || typeof pool.connect !== "function") fail("entity360_adapter_pool_required", 503);
  const compiledPolicy = compileEntity360Policy(policy);
  const nsctOwnerReadLimits = sourceOwnerReadLimits(compiledPolicy, "nsct");

  async function transaction(callback) {
    const client = await pool.connect();
    const retrievalBudget = createRetrievalBudget(compiledPolicy);
    RETRIEVAL_BUDGETS.set(client, retrievalBudget);
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await callback(client, retrievalBudget);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      RETRIEVAL_BUDGETS.delete(client);
      client.release();
    }
  }

  async function discoverInCut(client, scope, sourceDiscovery, retrievalBudget) {
    let sourceContributions = scope.entity_type === "work"
      ? await discoverWork(client, scope, sourceDiscovery, nsct, nsctOwnerReadLimits)
      : scope.entity_type === "software_component"
        ? await discoverSoftwareComponent(client, scope, sourceDiscovery)
        : [];
    sourceContributions = finalizeSourceDiscovery(sourceContributions, sourceDiscovery);
    completeSourceDiscovery(scope.entity_type, sourceContributions, sourceDiscovery);
    sourceContributions = finalizeSourceDiscovery(sourceContributions, sourceDiscovery);
    const identityFact = sourceContributions.flatMap((item) => item.facts || []).find((fact) =>
      fact.fact_id === (scope.entity_type === "work" ? "work.identity" : "component.identity"));
    const identityValue = identityFact?.value || {};
    const workLinkageProjects = scope.entity_type === "work" ? projectSlugs(sourceContributions
      .flatMap((item) => item.facts || [])
      .filter((fact) => fact.fact_id === "work.identity")
      .map((fact) => fact.value?.project_id)) : [];
    const workLinkageProjectUuids = scope.entity_type === "work"
      ? [...new Set(sourceContributions.flatMap((item) => item.facts || [])
        .filter((fact) => fact.fact_id === "governance.genesis.binding")
        .map((fact) => fact.value?.project_uuid).filter(Boolean).map((value) =>
          optionalProjectUuid(value)))].sort() : [];
    const workProjectConflict = scope.entity_type === "work" && sourceDiscovery.some((item) =>
      item.reason_code === "WORK_PROJECT_LINKAGE_CONFLICT");
    const workProjectUuidConflict = scope.entity_type === "work" && sourceDiscovery.some((item) =>
      item.reason_code === "WORK_PROJECT_UUID_BINDING_MISMATCH");
    const projectWorkLinkage = scope.entity_type === "work" && !identityFact ? {}
      : scope.entity_type === "work"
        ? { work_id: identityValue.work_id || scope.identity.work_id,
        legacy_work_id: identityValue.legacy_work_id || scope.identity.legacy_work_id || null,
        project_id: !workProjectConflict && workLinkageProjects.length === 1
          ? workLinkageProjects[0] : null,
        project_uuid: !workProjectUuidConflict && workLinkageProjectUuids.length === 1
          ? workLinkageProjectUuids[0] : null }
        : { work_id: identityValue.work_id || scope.identity.work_id,
        component_id: identityValue.node_id || scope.identity.node_id,
        project_id: identityValue.project_id || null };
    retrievalBudget.decorate(sourceDiscovery);
    return { source_contributions: sourceContributions, source_discovery: sourceDiscovery,
      project_work_linkage: projectWorkLinkage,
      consistent_cut: "postgres_repeatable_read", execution_authorized: false };
  }

  return Object.freeze({
    schema_version: "entity_360_adapter_registry_v1",
    adapter_versions: Object.freeze([
      "architecture_map_entity360_adapter_v1",
      "event_ledger_entity360_adapter_v1",
      "genesis_entity360_adapter_v1",
      "icf_entity360_adapter_v2",
      "impact_map_entity360_adapter_v1",
      "intent_entity360_adapter_v1",
      "nsct_entity360_adapter_v1",
      "security_intelligence_entity360_adapter_v1",
      "work_continuity_entity360_adapter_v1",
    ]),
    async resolveCandidates({ tenant_id, entity_type, identity } = {}) {
      const tenantId = requiredText(tenant_id, "entity360_adapter_tenant_required", 120);
      const report = [];
      const resolved = await transaction(async (client, retrievalBudget) => {
        const value = entity_type === "work"
          ? await resolveWorkCandidates(client, tenantId, identity || {}, report, null)
          : entity_type === "software_component"
            ? await resolveSoftwareCandidates(client, tenantId, identity || {}, report, null)
            : { candidates: [], project_work_linkage: {} };
        retrievalBudget.decorate(report);
        return value;
      });
      finalizeSourceDiscovery([], report);
      return { candidates: resolved.candidates, project_work_linkage: resolved.project_work_linkage,
        source_discovery: report };
    },
    async assembleContext({ tenant_id, entity_id, entity_type, identity, as_of } = {}) {
      const tenantId = requiredText(tenant_id, "entity360_adapter_tenant_required", 120);
      const normalizedType = requiredText(entity_type, "entity360_adapter_entity_type_required", 80);
      const asOf = iso(as_of);
      return transaction(async (client, retrievalBudget) => {
        const sourceDiscovery = [];
        const resolved = normalizedType === "work"
          ? await resolveWorkCandidates(client, tenantId, identity || {}, sourceDiscovery, asOf)
          : normalizedType === "software_component"
            ? await resolveSoftwareCandidates(client, tenantId, identity || {}, sourceDiscovery, asOf)
            : { candidates: [], project_work_linkage: {} };
        const candidates = resolved.candidates;
        const resolution = resolveEntity360Identity({ tenant_id: tenantId, entity_type: normalizedType,
          entity_id, identity: identity || {}, candidates, require_existing: true });
        if (resolution.status !== "RESOLVED") {
          retrievalBudget.decorate(sourceDiscovery);
          return { candidates, resolution, source_contributions: [], source_discovery: sourceDiscovery,
            project_work_linkage: resolved.project_work_linkage,
            consistent_cut: "postgres_repeatable_read",
            execution_authorized: false };
        }
        const scope = { tenant_id: tenantId, entity_id: resolution.entity_id,
          entity_type: normalizedType, identity: resolution.identity, as_of: asOf };
        return { candidates, resolution,
          ...await discoverInCut(client, scope, sourceDiscovery, retrievalBudget) };
      });
    },
    async discover({ tenant_id, entity_id, entity_type, identity, as_of } = {}) {
      const scope = {
        tenant_id: requiredText(tenant_id, "entity360_adapter_tenant_required", 120),
        entity_id: requiredText(entity_id, "entity360_adapter_entity_required", 160),
        entity_type: requiredText(entity_type, "entity360_adapter_entity_type_required", 80),
        identity: identity || {},
        as_of: iso(as_of),
      };
      return transaction((client, retrievalBudget) =>
        discoverInCut(client, scope, [], retrievalBudget));
    },
  });
}
