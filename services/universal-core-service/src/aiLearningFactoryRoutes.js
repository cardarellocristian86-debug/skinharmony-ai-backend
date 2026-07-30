import crypto from "node:crypto";
import { buildAiLearningOutcomeReviewBinding } from "./aiLearningEvidenceVerifier.js";
const ROUTES = Object.freeze([
  { method: "GET", path: "/v1/ai-learning/eval/scorecards", capability_id: "ai_eval_scorecard_read" },
  { method: "GET", path: "/v1/ai-learning/eval/datasets", capability_id: "ai_eval_dataset_read" },
  { method: "GET", path: "/v1/ai-learning/eval/traces", capability_id: "ai_eval_trace_read" },
  { method: "GET", path: "/v1/ai-learning/performance/scorecards", capability_id: "ai_performance_scorecard_read" },
  { method: "GET", path: "/v1/ai-learning/experiments", capability_id: "ai_experiment_read" },
  { method: "GET", path: "/v1/ai-learning/candidates", capability_id: "ai_learning_candidate_read" },
  { method: "POST", path: "/v1/ai-learning/review-bindings/preview", capability_id: "ai_learning_review_binding_preview" },
  { method: "POST", path: "/v1/ai-learning/candidates/review", capability_id: "ai_learning_candidate_review" },
  { method: "POST", path: "/v1/ai-learning/outcomes", capability_id: "ai_learning_outcome_record" },
]);

export const AI_LEARNING_FACTORY_ROUTE_CONTRACTS = Object.freeze({
  ai_eval_scorecard_read: {
    method: "GET",
    path: "/v1/ai-learning/eval/scorecards",
    output_schema: "ai_evaluation_scorecard_v0_16",
    query: ["scorecard_id", "release_version", "limit", "cursor"],
  },
  ai_eval_dataset_read: {
    method: "GET",
    path: "/v1/ai-learning/eval/datasets",
    output_schema: "ai_learning_dataset_metadata_v0_16",
    query: ["dataset_id", "version", "limit", "cursor"],
  },
  ai_eval_trace_read: {
    method: "GET",
    path: "/v1/ai-learning/eval/traces",
    output_schema: "ai_runtime_telemetry_v0_16",
    query: ["trace_id", "run_id", "limit", "cursor"],
  },
  ai_performance_scorecard_read: {
    method: "GET",
    path: "/v1/ai-learning/performance/scorecards",
    output_schema: "ai_performance_scorecard_v0_16",
    query: ["scorecard_id", "release_version", "limit", "cursor"],
  },
  ai_experiment_read: {
    method: "GET",
    path: "/v1/ai-learning/experiments",
    output_schema: "ai_causal_experiment_v0_16",
    query: ["experiment_id", "state", "limit", "cursor"],
    state: ["proposed", "shadow", "canary", "ab", "stopped", "completed"],
  },
  ai_learning_candidate_read: {
    method: "GET",
    path: "/v1/ai-learning/candidates",
    output_schema: "ai_learning_candidate_v0_16",
    query: ["candidate_id", "state", "limit", "cursor"],
    state: ["proposed", "under_review", "deferred", "rejected", "approved_for_shadow"],
  },
  ai_learning_candidate_review: {
    method: "POST",
    path: "/v1/ai-learning/candidates/review",
    output_schema: "ai_learning_candidate_v0_16",
    body: [
      "candidate_id",
      "decision",
      "review_note",
      "review_attestation",
      "review_binding_receipt",
      "expected_revision",
      "idempotency_key",
    ],
    review_attestation: ["tree_id", "node_id"],
    review_binding_receipt_required_for: ["approved_for_shadow"],
    decision: ["approved_for_shadow", "deferred", "rejected"],
  },
  ai_learning_review_binding_preview: {
    method: "POST",
    path: "/v1/ai-learning/review-bindings/preview",
    output_schema: "ai_learning_review_binding_preview_v0_16",
    body: ["candidate_id", "decision", "expected_revision", "outcome"],
    request_one_of: [
      {
        kind: "learning_candidate",
        required: ["candidate_id", "decision", "expected_revision"],
      },
      {
        kind: "learning_outcome",
        required: ["outcome"],
      },
    ],
    decision: ["approved_for_shadow"],
    outcome: [
      "outcome_id",
      "run_id",
      "candidate_id",
      "candidate_version",
      "candidate_revision",
      "outcome_status",
      "outcome_verified",
      "human_review_status",
      "evidence_digest",
      "policy_snapshot",
      "observed_at",
      "learning_value",
    ],
    output_variants: {
      learning_candidate: [
        "binding_kind",
        "binding_schema",
        "binding_content",
        "binding_digest",
        "candidate_id",
        "candidate_version",
        "source_revision",
        "resulting_revision",
        "evidence_snapshot_digest",
        "expires_at",
        "receipt",
        "execution_authorized",
      ],
      learning_outcome: [
        "binding_kind",
        "binding_schema",
        "binding_content",
        "binding_digest",
        "outcome_id",
        "run_id",
        "telemetry_digest",
        "execution_authorized",
      ],
    },
  },
  ai_learning_outcome_record: {
    method: "POST",
    path: "/v1/ai-learning/outcomes",
    output_schema: "ai_learning_outcome_v0_16",
    body: ["outcome", "review_attestation", "expected_revision", "idempotency_key"],
    review_attestation: ["tree_id", "node_id"],
    outcome: [
      "outcome_id",
      "run_id",
      "candidate_id",
      "candidate_version",
      "candidate_revision",
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
  return Object.freeze({
    tenant_id: tenantId(req),
    client_type: clientType,
    audience,
    entitlements: Object.freeze(
      Array.isArray(context.entitlements)
        ? [...new Set(context.entitlements.map((value) => String(value || "").trim()).filter(Boolean))]
        : [],
    ),
    role: String(context.role || ""),
  });
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

async function listOrRead({
  req,
  store,
  idQuery,
  readMethod,
  listMethod,
  filters = [],
  allowedQuery = [],
  visibilityContext,
}) {
  assertAllowedQuery(req, [idQuery, "limit", "cursor", ...allowedQuery]);
  const scopedTenantId = tenantId(req);
  const requestedId = optionalQueryIdentifier(req, idQuery);
  const requestedFilters = {};
  for (const filter of filters) {
    const requestedValue = optionalQueryIdentifier(req, filter.query);
    if (!requestedValue) continue;
    if (filter.allowed && !filter.allowed.includes(requestedValue)) {
      throw new Error(`${filter.query}_invalid`);
    }
    requestedFilters[filter.field] = requestedValue;
  }
  if (requestedId) {
    const record = await store[readMethod]({
      tenant_id: scopedTenantId,
      record_id: requestedId,
      visibility_context: visibilityContext,
    });
    const records = (record ? [record] : []).filter((candidate) =>
      Object.entries(requestedFilters).every(([field, value]) =>
        candidate[field] === value));
    return pageRecords(records, req);
  }
  const listed = await store[listMethod]({
    tenant_id: scopedTenantId,
    limit: limit(req),
    offset: cursorOffset(req),
    filters: requestedFilters,
    page: true,
    visibility_context: visibilityContext,
  });
  if (Array.isArray(listed)) {
    const records = listed.filter((record) =>
      Object.entries(requestedFilters).every(([field, value]) =>
        record[field] === value));
    return pageRecords(records, req);
  }
  if (!listed || !Array.isArray(listed.records)) {
    throw new Error("learning_factory_store_page_invalid");
  }
  return {
    records: listed.records,
    next_cursor: listed.next_offset === null
      ? null
      : `offset:${listed.next_offset}`,
  };
}

/**
 * Mounts the nine dynamic AI Learning Factory capability routes.
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
  issueReviewBinding = () => {
    throw new Error("ai_learning_review_binding_signing_unavailable");
  },
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
  const issueCandidateReviewBinding = requireFunction(
    issueReviewBinding,
    "ai_learning_review_binding_issuer",
  );
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

  async function candidateEvidence(tenant, candidate, visibilityContext = null) {
    const [dataset, scorecard, experiment] = await Promise.all([
      learningStore.readDatasetMetadata({
        tenant_id: tenant,
        record_id: candidate.dataset_id,
        visibility_context: visibilityContext,
      }),
      learningStore.readEvaluationScorecard({
        tenant_id: tenant,
        record_id: candidate.scorecard_id,
        visibility_context: visibilityContext,
      }),
      learningStore.readCausalExperiment({
        tenant_id: tenant,
        record_id: candidate.experiment_id,
        visibility_context: visibilityContext,
      }),
    ]);
    if (!dataset || !scorecard || !experiment) {
      throw new Error("learning_candidate_evidence_incomplete");
    }
    return { dataset, scorecard, experiment };
  }

  app.get("/v1/ai-learning/eval/scorecards", readMiddleware, asyncRoute(async (req, res) => {
    const visibilityContext = authorizeCapability(req, requestContextFor);
    requirePersistenceReady(false);
    const page = await listOrRead({
      req,
      store: learningStore,
      idQuery: "scorecard_id",
      readMethod: "readEvaluationScorecard",
      listMethod: "listEvaluationScorecards",
      allowedQuery: ["release_version"],
      filters: [{ query: "release_version", field: "release_version" }],
      visibilityContext,
    });
    return res.json({ ok: true, tenant_id: tenantId(req), scorecards: page.records, next_cursor: page.next_cursor });
  }));

  app.get("/v1/ai-learning/eval/datasets", readMiddleware, asyncRoute(async (req, res) => {
    const visibilityContext = authorizeCapability(req, requestContextFor);
    requirePersistenceReady(false);
    const page = await listOrRead({
      req,
      store: learningStore,
      idQuery: "dataset_id",
      readMethod: "readDatasetMetadata",
      listMethod: "listDatasetMetadata",
      allowedQuery: ["version"],
      filters: [{ query: "version", field: "dataset_version" }],
      visibilityContext,
    });
    return res.json({ ok: true, tenant_id: tenantId(req), datasets: page.records, next_cursor: page.next_cursor });
  }));

  app.get("/v1/ai-learning/eval/traces", readMiddleware, asyncRoute(async (req, res) => {
    const visibilityContext = authorizeCapability(req, requestContextFor);
    requirePersistenceReady(false);
    assertAllowedQuery(req, ["tenant_id", "trace_id", "run_id", "limit", "cursor"]);
    const scopedTenantId = tenantId(req);
    const requestedRunId = optionalQueryIdentifier(req, "run_id");
    const requestedTraceId = optionalQueryIdentifier(req, "trace_id");
    if (requestedRunId) {
      const record = await telemetryStore.read({
        tenant_id: scopedTenantId,
        run_id: requestedRunId,
        visibility_context: visibilityContext,
      });
      const records = (record ? [record] : []).filter((candidate) =>
        !requestedTraceId || candidate.trace_id === requestedTraceId);
      const page = pageRecords(records, req);
      return res.json({
        ok: true,
        tenant_id: scopedTenantId,
        traces: page.records,
        next_cursor: page.next_cursor,
      });
    }
    const listed = await telemetryStore.list({
      tenant_id: scopedTenantId,
      limit: limit(req),
      offset: cursorOffset(req),
      filters: requestedTraceId ? { trace_id: requestedTraceId } : {},
      page: true,
      visibility_context: visibilityContext,
    });
    if (Array.isArray(listed)) {
      const records = requestedTraceId
        ? listed.filter((record) => record.trace_id === requestedTraceId)
        : listed;
      const page = pageRecords(records, req);
      return res.json({
        ok: true,
        tenant_id: scopedTenantId,
        traces: page.records,
        next_cursor: page.next_cursor,
      });
    }
    if (!listed || !Array.isArray(listed.records)) {
      throw new Error("telemetry_store_page_invalid");
    }
    return res.json({
      ok: true,
      tenant_id: scopedTenantId,
      traces: listed.records,
      next_cursor: listed.next_offset === null
        ? null
        : `offset:${listed.next_offset}`,
    });
  }));

  app.get("/v1/ai-learning/performance/scorecards", readMiddleware, asyncRoute(async (req, res) => {
    const visibilityContext = authorizeCapability(req, requestContextFor);
    requirePersistenceReady(false);
    const page = await listOrRead({
      req,
      store: learningStore,
      idQuery: "scorecard_id",
      readMethod: "readPerformanceScorecard",
      listMethod: "listPerformanceScorecards",
      allowedQuery: ["release_version"],
      filters: [{ query: "release_version", field: "release_version" }],
      visibilityContext,
    });
    return res.json({ ok: true, tenant_id: tenantId(req), scorecards: page.records, next_cursor: page.next_cursor });
  }));

  app.get("/v1/ai-learning/experiments", readMiddleware, asyncRoute(async (req, res) => {
    const visibilityContext = authorizeCapability(req, requestContextFor);
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
      visibilityContext,
    });
    return res.json({ ok: true, tenant_id: tenantId(req), experiments: page.records, next_cursor: page.next_cursor });
  }));

  app.get("/v1/ai-learning/candidates", readMiddleware, asyncRoute(async (req, res) => {
    const visibilityContext = authorizeCapability(req, requestContextFor);
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
      visibilityContext,
    });
    return res.json({ ok: true, tenant_id: tenantId(req), candidates: page.records, next_cursor: page.next_cursor });
  }));

  app.post("/v1/ai-learning/review-bindings/preview", readMiddleware, asyncRoute(async (req, res) => {
    const visibilityContext = authorizeCapability(req, requestContextFor);
    requirePersistenceReady(false);
    const scopedTenantId = tenantId(req);
    if (req.body?.outcome) {
      const outcome = requireObject(req.body.outcome, "learning_outcome");
      const runId = recordId(outcome.run_id, "run_id");
      const telemetry = await telemetryStore.read({
        tenant_id: scopedTenantId,
        run_id: runId,
        visibility_context: visibilityContext,
      });
      if (
        !telemetry
        || telemetry.tenant_id !== scopedTenantId
        || telemetry.run_id !== runId
        || !/^art_[a-f0-9]{64}$/.test(String(telemetry.telemetry_digest || ""))
        || telemetry.evidence_digest !== outcome.evidence_digest
        || telemetry.policy_snapshot !== outcome.policy_snapshot
        || telemetry.outcome_status !== outcome.outcome_status
      ) throw new Error("learning_outcome_telemetry_binding_invalid");
      const binding = buildAiLearningOutcomeReviewBinding({
        tenant_id: scopedTenantId,
        outcome,
        telemetry_digest: telemetry.telemetry_digest,
      });
      audit.append("ai_learning_review_binding_previewed", {
        tenant_id: scopedTenantId,
        binding_kind: "learning_outcome",
        outcome_id: recordId(outcome.outcome_id, "outcome_id"),
        run_id: runId,
        binding_digest: binding.binding_digest,
        execution_authorized: false,
      });
      return res.json({
        ok: true,
        tenant_id: scopedTenantId,
        review_binding: {
          binding_kind: "learning_outcome",
          binding_schema: binding.payload.schema_version,
          binding_content: binding.binding_content,
          binding_digest: binding.binding_digest,
          outcome_id: outcome.outcome_id,
          run_id: runId,
          telemetry_digest: telemetry.telemetry_digest,
          execution_authorized: false,
        },
      });
    }
    const candidateId = recordId(req.body?.candidate_id, "candidate_id");
    const expectedRevision = Number(req.body?.expected_revision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error("expected_revision_invalid");
    }
    if (req.body?.decision !== "approved_for_shadow") {
      throw new Error("review_binding_decision_invalid");
    }
    const candidate = await learningStore.readLearningCandidate({
      tenant_id: scopedTenantId,
      record_id: candidateId,
      visibility_context: visibilityContext,
    });
    if (!candidate) throw new Error("learning_candidate_not_found");
    const evidence = await candidateEvidence(
      scopedTenantId,
      candidate,
      visibilityContext,
    );
    const issued = await issueCandidateReviewBinding({
      tenant_id: scopedTenantId,
      candidate,
      expected_revision: expectedRevision,
      decision: req.body.decision,
      ...evidence,
    });
    if (issued?.binding?.binding_digest !== issued?.binding_digest) {
      throw new Error("ai_learning_review_binding_issuance_failed");
    }
    audit.append("ai_learning_review_binding_previewed", {
      tenant_id: scopedTenantId,
      candidate_id: candidateId,
      candidate_revision: expectedRevision,
      binding_digest: issued.binding_digest,
      evidence_snapshot_digest: issued.evidence_snapshot_digest,
      expires_at: issued.expires_at,
      execution_authorized: false,
    });
    const { binding, ...receipt } = issued;
    return res.json({
      ok: true,
      tenant_id: scopedTenantId,
      review_binding: {
        binding_kind: "learning_candidate",
        binding_schema: binding.payload.schema_version,
        binding_content: binding.binding_content,
        binding_digest: binding.binding_digest,
        candidate_id: candidate.candidate_id,
        candidate_version: candidate.candidate_version,
        source_revision: binding.payload.source_revision,
        resulting_revision: binding.payload.resulting_revision,
        evidence_snapshot_digest: issued.evidence_snapshot_digest,
        expires_at: issued.expires_at,
        receipt,
        execution_authorized: false,
      },
    });
  }));

  app.post("/v1/ai-learning/candidates/review", governMiddleware, asyncRoute(async (req, res) => {
    const visibilityContext = authorizeCapability(req, requestContextFor);
    requirePersistenceReady(true);
    const scopedTenantId = tenantId(req);
    const idempotency = idempotencyKey(req);
    const revision = expectedRevision(req);
    const replay = await learningStore.replayLearningCandidateReview?.({
      tenant_id: scopedTenantId,
      candidate_id: req.body?.candidate_id,
      decision: req.body?.decision,
      review_note: req.body?.review_note,
      idempotency_key: idempotency,
      expected_revision: revision,
      review_attestation: req.body?.review_attestation || null,
      review_binding_receipt: req.body?.review_binding_receipt || null,
      visibility_context: visibilityContext,
    });
    if (replay) {
      audit.append("ai_learning_candidate_review_replayed", {
        tenant_id: scopedTenantId,
        candidate_id: replay.candidate_id,
        revision: replay.revision,
        idempotency_digest: idempotencyDigest(idempotency),
      });
      return res.status(200).json({
        ok: true,
        tenant_id: scopedTenantId,
        candidate: replay,
        idempotent_replay: true,
      });
    }
    const proof = await proofForRequest(req);
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
      review_attestation: req.body?.review_attestation || null,
      review_binding_receipt: req.body?.review_binding_receipt || null,
      owner_actor_ids: proof.review_owner_actor_ids || [],
      visibility_context: visibilityContext,
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
    const visibilityContext = authorizeCapability(req, requestContextFor);
    requirePersistenceReady(true);
    const scopedTenantId = tenantId(req);
    const idempotency = idempotencyKey(req);
    const revision = expectedRevision(req);
    const requestedOutcome = requireObject(req.body?.outcome, "learning_outcome");
    const telemetry = await telemetryStore.read({
      tenant_id: scopedTenantId,
      run_id: recordId(requestedOutcome.run_id, "run_id"),
      visibility_context: visibilityContext,
    });
    if (!telemetry) throw new Error("branch_not_available_for_client");
    const visibilityBranchIds = [
      ...(telemetry.resource_visibility?.branch_ids || []),
    ];
    if (requestedOutcome.candidate_id) {
      const candidate = await learningStore.readLearningCandidate({
        tenant_id: scopedTenantId,
        record_id: recordId(requestedOutcome.candidate_id, "candidate_id"),
        visibility_context: visibilityContext,
      });
      if (!candidate) throw new Error("branch_not_available_for_client");
      visibilityBranchIds.push(...(candidate.resource_visibility?.branch_ids || []));
    }
    if (!visibilityBranchIds.length) throw new Error("resource_visibility_missing");
    const replay = await learningStore.replayLearningOutcome?.({
      tenant_id: scopedTenantId,
      record: requestedOutcome,
      idempotency_key: idempotency,
      expected_revision: revision,
      review_attestation: req.body?.review_attestation || null,
      visibility_context: visibilityContext,
      visibility_branch_ids: [...new Set(visibilityBranchIds)],
    });
    if (replay) {
      audit.append("ai_learning_outcome_record_replayed", {
        tenant_id: scopedTenantId,
        outcome_id: replay.outcome_id,
        run_id: replay.run_id,
        revision: replay.revision,
        idempotency_digest: idempotencyDigest(idempotency),
      });
      return res.status(201).json({
        ok: true,
        tenant_id: scopedTenantId,
        outcome: replay,
        idempotent_replay: true,
      });
    }
    const proof = await proofForRequest(req);
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
      review_attestation: req.body?.review_attestation || null,
      owner_actor_ids: proof.review_owner_actor_ids || [],
      visibility_context: visibilityContext,
      visibility_branch_ids: [...new Set(visibilityBranchIds)],
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
