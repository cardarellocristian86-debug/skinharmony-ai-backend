import crypto from "node:crypto";

const ROUTES = Object.freeze([
  { method: "GET", path: "/v1/ai-learning/eval/scorecards", capability_id: "ai_eval_scorecard_read" },
  { method: "GET", path: "/v1/ai-learning/eval/datasets", capability_id: "ai_eval_dataset_read" },
  { method: "GET", path: "/v1/ai-learning/eval/traces", capability_id: "ai_eval_trace_read" },
  { method: "GET", path: "/v1/ai-learning/performance/scorecards", capability_id: "ai_performance_scorecard_read" },
  { method: "GET", path: "/v1/ai-learning/experiments", capability_id: "ai_experiment_read" },
  { method: "GET", path: "/v1/ai-learning/candidates", capability_id: "ai_learning_candidate_read" },
  { method: "POST", path: "/v1/ai-learning/candidates/review", capability_id: "ai_learning_candidate_review" },
  { method: "POST", path: "/v1/ai-learning/outcomes", capability_id: "ai_learning_outcome_record" },
]);

export const AI_LEARNING_FACTORY_ROUTE_CONTRACTS = Object.freeze({
  ai_eval_scorecard_read: {
    method: "GET",
    path: "/v1/ai-learning/eval/scorecards",
    query: ["scorecard_id", "release_version", "limit", "cursor"],
  },
  ai_eval_dataset_read: {
    method: "GET",
    path: "/v1/ai-learning/eval/datasets",
    query: ["dataset_id", "version", "limit", "cursor"],
  },
  ai_eval_trace_read: {
    method: "GET",
    path: "/v1/ai-learning/eval/traces",
    query: ["trace_id", "run_id", "limit", "cursor"],
  },
  ai_performance_scorecard_read: {
    method: "GET",
    path: "/v1/ai-learning/performance/scorecards",
    query: ["scorecard_id", "release_version", "limit", "cursor"],
  },
  ai_experiment_read: {
    method: "GET",
    path: "/v1/ai-learning/experiments",
    query: ["experiment_id", "state", "limit", "cursor"],
    state: ["proposed", "shadow", "canary", "ab", "stopped", "completed"],
  },
  ai_learning_candidate_read: {
    method: "GET",
    path: "/v1/ai-learning/candidates",
    query: ["candidate_id", "state", "limit", "cursor"],
    state: ["proposed", "under_review", "deferred", "rejected", "approved_for_shadow"],
  },
  ai_learning_candidate_review: {
    method: "POST",
    path: "/v1/ai-learning/candidates/review",
    body: ["candidate_id", "decision", "review_note", "expected_revision", "idempotency_key"],
    decision: ["approved_for_shadow", "deferred", "rejected"],
  },
  ai_learning_outcome_record: {
    method: "POST",
    path: "/v1/ai-learning/outcomes",
    body: ["outcome", "expected_revision", "idempotency_key"],
    outcome: [
      "outcome_id",
      "run_id",
      "candidate_id",
      "outcome_status",
      "outcome_verified",
      "human_review_status",
      "evidence_digest",
      "policy_snapshot",
      "observed_at",
      "learning_value",
    ],
    outcome_status: ["succeeded", "failed", "partial", "abstained"],
    human_review_status: ["not_required", "pending", "approved", "rejected"],
  },
  pagination: {
    limit: { minimum: 1, maximum: 100, default: 100 },
    cursor: "offset:<non-negative-integer>",
  },
  mutation_security: {
    core_proof: "server_derived",
    optimistic_concurrency: "expected_revision_required",
    idempotency: "idempotency-key_header_or_body_required",
  },
});

function requireFunction(value, field) {
  if (typeof value !== "function") throw new Error(`${field}_required`);
  return value;
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field}_invalid`);
  return value;
}

const CANONICAL_CLIENT_AUDIENCE = Object.freeze({
  chatgpt: "chatgpt_connector",
  codex: "codex_internal",
  api_agent: "api_agent",
  admin: "admin_control_room",
});

function authorizeCapability(req, resolveRequestContext) {
  const context = requireObject(resolveRequestContext(req), "ai_learning_factory_request_context");
  const clientType = String(context.client_type || context.clientType || "");
  const audience = String(context.audience || "");
  if (
    !Object.hasOwn(CANONICAL_CLIENT_AUDIENCE, clientType) ||
    CANONICAL_CLIENT_AUDIENCE[clientType] !== audience
  ) {
    throw new Error("branch_not_available_for_client");
  }
  return Object.freeze({ client_type: clientType, audience });
}

function tenantId(req) {
  const value = String(req.tenantId || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,119}$/i.test(value)) throw new Error("tenant_scope_denied");
  const claimed = String(req.query?.tenant_id || req.body?.tenant_id || "").trim();
  if (claimed && claimed !== value) throw new Error("tenant_scope_denied");
  return value;
}

function recordId(value, field) {
  const normalized = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._:@/-]*$/i.test(normalized) || normalized.length > 200) throw new Error(`${field}_invalid`);
  return normalized;
}

function limit(req) {
  if (req.query?.limit === undefined || req.query?.limit === "") return 100;
  const value = Number(req.query.limit);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error("limit_invalid");
  return value;
}

function cursorOffset(req) {
  const raw = String(req.query?.cursor || "").trim();
  if (!raw) return 0;
  const match = /^offset:(\d+)$/.exec(raw);
  const value = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) throw new Error("cursor_invalid");
  return value;
}

function assertAllowedQuery(req, allowed) {
  const accepted = new Set(["tenant_id", ...allowed]);
  for (const key of Object.keys(req.query || {})) {
    if (!accepted.has(key)) throw new Error("ai_learning_query_parameter_not_allowed");
  }
}

function optionalQueryIdentifier(req, key) {
  const value = String(req.query?.[key] || "").trim();
  return value ? recordId(value, key) : null;
}

function pageRecords(records, req) {
  const offset = cursorOffset(req);
  const boundedLimit = limit(req);
  const page = records.slice(offset, offset + boundedLimit);
  return {
    records: page,
    next_cursor: offset + page.length < records.length ? `offset:${offset + page.length}` : null,
  };
}

function expectedRevision(req) {
  const value = Number(req.body?.expected_revision);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("expected_revision_required");
  return value;
}

function idempotencyKey(req) {
  return recordId(
    req.get?.("idempotency-key")
      || req.get?.("x-idempotency-key")
      || req.body?.idempotency_key,
    "idempotency_key",
  );
}

function idempotencyDigest(value) {
  return `idem_${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function statusForError(error) {
  const code = String(error?.message || "ai_learning_factory_request_failed");
  if (code === "ai_learning_persistence_required") return 503;
  if (
    code === "tenant_scope_denied" ||
    code === "branch_not_available_for_client" ||
    code.includes("govern") ||
    code.includes("owner_confirmation")
  ) return 403;
  if (code.includes("conflict")) return 409;
  if (code.endsWith("_not_found")) return 404;
  return 400;
}

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      return res.status(statusForError(error)).json({
        ok: false,
        error: String(error?.message || "ai_learning_factory_request_failed"),
      });
    }
  };
}

async function listOrRead({ req, store, idQuery, readMethod, listMethod, filters = [], allowedQuery = [] }) {
  assertAllowedQuery(req, [idQuery, "limit", "cursor", ...allowedQuery]);
  const scopedTenantId = tenantId(req);
  const requestedId = optionalQueryIdentifier(req, idQuery);
  let records;
  if (requestedId) {
    const record = await store[readMethod]({ tenant_id: scopedTenantId, record_id: requestedId });
    records = record ? [record] : [];
  } else {
    records = await store[listMethod]({ tenant_id: scopedTenantId, limit: 500 });
  }
  for (const filter of filters) {
    const requestedValue = optionalQueryIdentifier(req, filter.query);
    if (requestedValue) {
      if (filter.allowed && !filter.allowed.includes(requestedValue)) throw new Error(`${filter.query}_invalid`);
      records = records.filter((record) => record[filter.field] === requestedValue);
    }
  }
  return pageRecords(records, req);
}

/**
 * Mounts the eight dynamic AI Learning Factory capability routes.
 * Authentication and Core governance proof are injected by app.js so no
 * caller-controlled payload can widen tenant scope or self-authorize a write.
 */
export function mountAiLearningFactoryRoutes({
  app,
  readAuth,
  governAuth,
  telemetryStore,
  learningStore,
  audit,
  resolveGovernanceProof,
  resolveRequestContext,
  persistenceRequired = false,
  resolvePersistenceReadiness = () => ({
    persistence_read_ready: false,
    persistence_write_ready: false,
    runtime_role_attested: false,
  }),
} = {}) {
  if (!app || typeof app.get !== "function" || typeof app.post !== "function") throw new Error("ai_learning_factory_app_required");
  const readMiddleware = requireFunction(readAuth, "ai_learning_factory_read_auth");
  const governMiddleware = requireFunction(governAuth, "ai_learning_factory_govern_auth");
  const proofForRequest = requireFunction(resolveGovernanceProof, "ai_learning_factory_governance_resolver");
  const requestContextFor = requireFunction(resolveRequestContext, "ai_learning_factory_request_context_resolver");
  requireObject(telemetryStore, "telemetry_store");
  requireObject(learningStore, "learning_store");
  requireObject(audit, "audit");
  requireFunction(audit.append, "audit_append");
  if (typeof resolvePersistenceReadiness !== "function") {
    throw new Error("ai_learning_factory_persistence_readiness_resolver_required");
  }

  function requirePersistenceReady(write = false) {
    if (persistenceRequired !== true) return;
    const readiness = resolvePersistenceReadiness();
    const ready = readiness
      && readiness.persistence_read_ready === true
      && (!write || (
        readiness.persistence_write_ready === true
        && readiness.runtime_role_attested === true
      ));
    if (!ready) throw new Error("ai_learning_persistence_required");
  }

  app.get("/v1/ai-learning/eval/scorecards", readMiddleware, asyncRoute(async (req, res) => {
    authorizeCapability(req, requestContextFor);
    requirePersistenceReady(false);
    const page = await listOrRead({
      req,
      store: learningStore,
      idQuery: "scorecard_id",
      readMethod: "readEvaluationScorecard",
      listMethod: "listEvaluationScorecards",
      allowedQuery: ["release_version"],
      filters: [{ query: "release_version", field: "release_version" }],
    });
    return res.json({ ok: true, tenant_id: tenantId(req), scorecards: page.records, next_cursor: page.next_cursor });
  }));

  app.get("/v1/ai-learning/eval/datasets", readMiddleware, asyncRoute(async (req, res) => {
    authorizeCapability(req, requestContextFor);
    requirePersistenceReady(false);
    const page = await listOrRead({
      req,
      store: learningStore,
      idQuery: "dataset_id",
      readMethod: "readDatasetMetadata",
      listMethod: "listDatasetMetadata",
      allowedQuery: ["version"],
      filters: [{ query: "version", field: "dataset_version" }],
    });
    return res.json({ ok: true, tenant_id: tenantId(req), datasets: page.records, next_cursor: page.next_cursor });
  }));

  app.get("/v1/ai-learning/eval/traces", readMiddleware, asyncRoute(async (req, res) => {
    authorizeCapability(req, requestContextFor);
    requirePersistenceReady(false);
    assertAllowedQuery(req, ["tenant_id", "trace_id", "run_id", "limit", "cursor"]);
    const scopedTenantId = tenantId(req);
    const requestedRunId = optionalQueryIdentifier(req, "run_id");
    const requestedTraceId = optionalQueryIdentifier(req, "trace_id");
    let records = requestedRunId
      ? await telemetryStore.read({ tenant_id: scopedTenantId, run_id: requestedRunId })
      : await telemetryStore.list({ tenant_id: scopedTenantId, limit: 500 });
    records = Array.isArray(records) ? records : records ? [records] : [];
    if (requestedTraceId) records = records.filter((record) => record.trace_id === requestedTraceId);
    const page = pageRecords(records, req);
    return res.json({ ok: true, tenant_id: scopedTenantId, traces: page.records, next_cursor: page.next_cursor });
  }));

  app.get("/v1/ai-learning/performance/scorecards", readMiddleware, asyncRoute(async (req, res) => {
    authorizeCapability(req, requestContextFor);
    requirePersistenceReady(false);
    const page = await listOrRead({
      req,
      store: learningStore,
      idQuery: "scorecard_id",
      readMethod: "readPerformanceScorecard",
      listMethod: "listPerformanceScorecards",
      allowedQuery: ["release_version"],
      filters: [{ query: "release_version", field: "release_version" }],
    });
    return res.json({ ok: true, tenant_id: tenantId(req), scorecards: page.records, next_cursor: page.next_cursor });
  }));

  app.get("/v1/ai-learning/experiments", readMiddleware, asyncRoute(async (req, res) => {
    authorizeCapability(req, requestContextFor);
    requirePersistenceReady(false);
    const page = await listOrRead({
      req,
      store: learningStore,
      idQuery: "experiment_id",
      readMethod: "readCausalExperiment",
      listMethod: "listCausalExperiments",
      allowedQuery: ["state"],
      filters: [{
        query: "state",
        field: "status",
        allowed: AI_LEARNING_FACTORY_ROUTE_CONTRACTS.ai_experiment_read.state,
      }],
    });
    return res.json({ ok: true, tenant_id: tenantId(req), experiments: page.records, next_cursor: page.next_cursor });
  }));

  app.get("/v1/ai-learning/candidates", readMiddleware, asyncRoute(async (req, res) => {
    authorizeCapability(req, requestContextFor);
    requirePersistenceReady(false);
    const page = await listOrRead({
      req,
      store: learningStore,
      idQuery: "candidate_id",
      readMethod: "readLearningCandidate",
      listMethod: "listLearningCandidates",
      allowedQuery: ["state"],
      filters: [{
        query: "state",
        field: "status",
        allowed: AI_LEARNING_FACTORY_ROUTE_CONTRACTS.ai_learning_candidate_read.state,
      }],
    });
    return res.json({ ok: true, tenant_id: tenantId(req), candidates: page.records, next_cursor: page.next_cursor });
  }));

  app.post("/v1/ai-learning/candidates/review", governMiddleware, asyncRoute(async (req, res) => {
    authorizeCapability(req, requestContextFor);
    requirePersistenceReady(true);
    const scopedTenantId = tenantId(req);
    const proof = await proofForRequest(req);
    const idempotency = idempotencyKey(req);
    const revision = expectedRevision(req);
    audit.append("ai_learning_candidate_review_authorized", {
      tenant_id: scopedTenantId,
      candidate_id: recordId(req.body?.candidate_id, "candidate_id"),
      expected_revision: revision,
      idempotency_digest: idempotencyDigest(idempotency),
      audit_reference: proof.audit_reference,
    });
    const candidate = await learningStore.reviewLearningCandidate({
      tenant_id: scopedTenantId,
      candidate_id: req.body?.candidate_id,
      decision: req.body?.decision,
      review_note: req.body?.review_note,
      authorization: proof,
      idempotency_key: idempotency,
      expected_revision: revision,
    });
    audit.append("ai_learning_candidate_reviewed", {
      tenant_id: scopedTenantId,
      candidate_id: candidate.candidate_id,
      revision: candidate.revision,
      decision: candidate.status,
      audit_reference: proof.audit_reference,
    });
    return res.status(200).json({ ok: true, tenant_id: scopedTenantId, candidate });
  }));

  app.post("/v1/ai-learning/outcomes", governMiddleware, asyncRoute(async (req, res) => {
    authorizeCapability(req, requestContextFor);
    requirePersistenceReady(true);
    const scopedTenantId = tenantId(req);
    const proof = await proofForRequest(req);
    const idempotency = idempotencyKey(req);
    const revision = expectedRevision(req);
    const requestedOutcome = requireObject(req.body?.outcome, "learning_outcome");
    audit.append("ai_learning_outcome_record_authorized", {
      tenant_id: scopedTenantId,
      outcome_id: recordId(requestedOutcome.outcome_id, "outcome_id"),
      run_id: recordId(requestedOutcome.run_id, "run_id"),
      expected_revision: revision,
      idempotency_digest: idempotencyDigest(idempotency),
      audit_reference: proof.audit_reference,
    });
    const outcome = await learningStore.recordLearningOutcome({
      tenant_id: scopedTenantId,
      record: requestedOutcome,
      authorization: proof,
      idempotency_key: idempotency,
      expected_revision: revision,
    });
    audit.append("ai_learning_outcome_recorded", {
      tenant_id: scopedTenantId,
      outcome_id: outcome.outcome_id,
      run_id: outcome.run_id,
      revision: outcome.revision,
      audit_reference: proof.audit_reference,
      raw_content_persisted: false,
    });
    return res.status(201).json({ ok: true, tenant_id: scopedTenantId, outcome });
  }));

  return {
    schema_version: "ai_learning_factory_dynamic_routes_v0_16",
    routes: ROUTES.map((route) => ({ ...route })),
    contracts: AI_LEARNING_FACTORY_ROUTE_CONTRACTS,
    top_level_mcp_tools_added: 0,
    tenant_scope: "server_derived",
    mutation_authorization: "server_derived_core_governance_proof",
  };
}
