function annotations(readOnly, idempotent = false, openWorld = false, destructive = false) {
  return { readOnlyHint: readOnly, destructiveHint: destructive, openWorldHint: openWorld, idempotentHint: idempotent };
}

const ownerConfirmationProperties = {
  owner_confirmed: { type: "boolean", description: "Server-side confirmation marker; ignored for OAuth identities." },
  confirmation_reference: { type: "string", maxLength: 240, description: "Server-side audit reference; ignored for OAuth identities." },
};

const agentPresenceProperties = {
  agent_id: {
    type: "string",
    pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$",
    description: "Logical id unique to this concurrent ChatGPT, Codex or API-agent session.",
  },
  client_type: {
    type: "string",
    enum: ["chatgpt", "codex", "api_agent", "other"],
  },
  session_id: {
    type: "string",
    pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$",
    description: "Opaque random id unique to the current conversation or agent run; reuse it for every tool call in that run.",
  },
};

function tool(name, title, description, inputSchema, scopes, readOnly = true, idempotent = true, options = {}) {
  const schema = inputSchema?.type === "object" && options.exactInputSchema !== true
    ? {
        ...inputSchema,
        properties: {
          ...inputSchema.properties,
          ...agentPresenceProperties,
          ...(!readOnly ? ownerConfirmationProperties : {}),
        },
        required: inputSchema.required || [],
      }
    : inputSchema;
  return {
    name,
    title,
    description,
    inputSchema: schema,
    ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
    scopes,
    annotations: annotations(readOnly, idempotent, options.openWorld === true, options.destructive === true),
    ...(options.meta ? { _meta: options.meta } : {}),
  };
}

const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const text = (maxLength = 20_000) => ({ type: "string", minLength: 1, maxLength });
const identifier = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" };
const memoryClassification = { type: "string", enum: ["internal", "customer_aggregate", "customer_personal", "restricted"] };
const memoryKind = { type: "string", enum: ["observation", "decision", "action", "outcome", "learning"] };
const memoryTextList = { type: "array", maxItems: 20, items: text(1_000) };
const memoryProperties = {
  title: text(240),
  summary: text(),
  facts: memoryTextList,
  decisions: memoryTextList,
  actions: memoryTextList,
  outcomes: memoryTextList,
  next_steps: memoryTextList,
  tags: { type: "array", maxItems: 30, items: identifier },
  importance: { type: "integer", minimum: 1, maximum: 100 },
  data_classification: memoryClassification,
  consent_reference: { type: "string", maxLength: 240 },
  project_id: identifier,
  session_id: identifier,
  agent_id: identifier,
  retention_days: { type: "integer", minimum: 1, maximum: 3_650 },
  idempotency_key: { type: "string", maxLength: 120 },
};
const memoryScopeProperties = {
  query: { type: "string", maxLength: 500 },
  project_id: identifier,
  session_id: identifier,
  agent_id: identifier,
  limit: { type: "integer", minimum: 1, maximum: 50 },
};
const probability = { type: "number", minimum: 0, maximum: 1 };
const score = { type: "number", minimum: 0, maximum: 100 };
const evidenceItem = {
  type: "object",
  properties: {
    id: identifier,
    label: text(500),
    description: text(1_000),
    direction: { type: "string", enum: ["support", "against"] },
    strength: probability,
    reliability: probability,
    source: { type: "string", maxLength: 500 },
  },
  additionalProperties: false,
};
const intelligenceCandidate = {
  type: "object",
  properties: {
    id: identifier,
    label: text(500),
    description: text(2_000),
    hypothesis: text(2_000),
    event: text(2_000),
    rationale: text(2_000),
    prior_probability: probability,
    base_rate: probability,
    probability,
    value: { type: "number" },
    upside: { type: "number" },
    downside: { type: "number" },
    cost: { type: "number" },
    impact: score,
    severity: score,
    urgency: score,
    risk: score,
    reversibility: score,
    strategic_fit: score,
    horizon: { type: "string", maxLength: 240 },
    evidence: { type: "array", maxItems: 100, items: evidenceItem },
    assumptions: { type: "array", maxItems: 30, items: text(1_000) },
    changed_assumptions: { type: "array", maxItems: 30, items: text(1_000) },
    constraints: { type: "array", maxItems: 30, items: text(1_000) },
    triggers: { type: "array", maxItems: 30, items: text(1_000) },
    leading_indicators: { type: "array", maxItems: 30, items: text(1_000) },
  },
  additionalProperties: false,
};
const intelligenceContext = {
  request: text(),
  question: text(),
  horizon: { type: "string", maxLength: 240 },
  default_prior: probability,
  assumptions: { type: "array", maxItems: 30, items: text(1_000) },
  evidence: { type: "array", maxItems: 100, items: evidenceItem },
  data_quality_score: score,
  project_id: identifier,
  session_id: identifier,
  agent_id: identifier,
};
const sourceType = { type: "string", enum: ["official", "regulator", "academic", "standards", "manufacturer", "news", "industry", "community", "other"] };
const researchSource = object({
  id: identifier,
  url: { type: "string", format: "uri", maxLength: 2_048 },
  title: text(500),
  publisher: { type: "string", maxLength: 240 },
  source_type: sourceType,
  published_at: { type: "string", format: "date-time" },
  fetched_at: { type: "string", format: "date-time" },
  excerpt: { type: "string", maxLength: 1_200 },
  summary: { type: "string", maxLength: 1_200 },
}, ["id", "url", "title", "source_type"]);
const researchClaim = object({
  id: identifier,
  kind: { type: "string", enum: ["fact", "inference", "hypothesis"] },
  text: text(2_000),
  source_ids: { type: "array", maxItems: 20, items: identifier },
  contradicts_claim_ids: { type: "array", maxItems: 20, items: identifier },
  confidence: { type: "number", minimum: 0, maximum: 1 },
}, ["id", "kind", "text", "source_ids"]);
const researchPlanPolicy = object({
  source_policy: object({
    minimum_independent_sources: { type: "integer", minimum: 1, maximum: 10 },
    freshness_days: { type: "integer", minimum: 1, maximum: 3_650 },
    allowed_domains: { type: "array", maxItems: 20, items: { type: "string", maxLength: 253 } },
  }, ["minimum_independent_sources", "freshness_days"]),
}, ["source_policy"]);
const searchOutputSchema = object({
  results: {
    type: "array",
    items: object({
      id: { type: "string" },
      title: { type: "string" },
      url: { type: "string" },
    }, ["id", "title", "url"]),
  },
}, ["results"]);
const fetchOutputSchema = object({
  id: { type: "string" },
  title: { type: "string" },
  text: { type: "string" },
  url: { type: "string" },
  metadata: { type: "object", additionalProperties: { type: "string" } },
}, ["id", "title", "text", "url"]);
const coreRuntimeOutputSchema = object({
  hierarchy_version: { type: "string" },
  mode: { type: "string", enum: ["shadow", "active", "disabled"] },
  route: { anyOf: [{ type: "string", enum: ["V0", "V1", "V2"] }, { type: "null" }] },
  selected_authority: { type: "string", enum: ["V0", "V1", "V2"] },
  parity: object({
    attempted: { type: "boolean" },
    matched: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    fallback: { anyOf: [{ type: "string" }, { type: "null" }] },
    error: { type: "string" },
  }, ["attempted", "matched", "fallback"]),
  execution_allowed: { const: false },
  latency_ms: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
}, ["hierarchy_version", "mode", "route", "selected_authority", "parity", "execution_allowed", "latency_ms"]);
const workPreflightOutputSchema = {
  type: "object",
  properties: { core_runtime: coreRuntimeOutputSchema },
  additionalProperties: true,
};
const suiteResourceId = { type: "string", minLength: 1, maxLength: 120, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$" };
const suiteBranchKey = { type: "string", minLength: 2, maxLength: 64, pattern: "^[a-z][a-z0-9_]{1,63}$" };
const suiteGuardrailsOutput = {
  type: "object",
  properties: {
    tenant_scoped: { type: "boolean" },
    aggregate_only: { type: "boolean" },
    read_only: { type: "boolean" },
    preview_only: { type: "boolean" },
    execution_allowed: { const: false },
  },
  additionalProperties: true,
};
const suiteCockpitOutputSchema = {
  type: "object",
  required: ["ok", "schema_version", "guardrails"],
  properties: {
    ok: { type: "boolean" },
    schema_version: { type: "string" },
    generated_at: { type: "string" },
    revision_hash: { type: "string" },
    scope: { type: "object", additionalProperties: true },
    summary: { type: "object", additionalProperties: true },
    module_coverage: { type: "object", additionalProperties: true },
    branches: { type: "array", items: { type: "object", additionalProperties: true } },
    priorities: { type: "array", items: { type: "object", additionalProperties: true } },
    conflicts: { type: "array", items: { type: "object", additionalProperties: true } },
    guardrails: suiteGuardrailsOutput,
    mcp_contract: { type: "object", additionalProperties: true },
  },
  additionalProperties: true,
};
const suiteStatusOutputSchema = {
  type: "object",
  required: ["ok", "schema_version", "connection", "readiness", "guardrails"],
  properties: {
    ok: { type: "boolean" },
    schema_version: { const: "suite_mcp_status_v1" },
    source_schema_version: { type: "string" },
    revision_hash: { type: "string" },
    generated_at: { type: "string" },
    scope: { type: "object", additionalProperties: true },
    connection: { type: "object", additionalProperties: true },
    readiness: { type: "object", additionalProperties: true },
    module_coverage: { type: "object", additionalProperties: true },
    guardrails: suiteGuardrailsOutput,
  },
  additionalProperties: false,
};
const suiteBranchCatalogOutputSchema = {
  type: "object",
  required: ["ok", "schema_version", "branch_count", "branch_keys", "branches"],
  properties: {
    ok: { type: "boolean" },
    schema_version: { const: "suite_mcp_branch_catalog_v1" },
    architecture_schema: { type: "string" },
    version: { type: "string" },
    branch_count: { type: "integer", minimum: 0, maximum: 100 },
    branch_keys: { type: "array", maxItems: 100, items: { type: "string" } },
    branch_groups: { type: "object", additionalProperties: true },
    pipeline: { type: "object", additionalProperties: true },
    branches: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } },
    guardrails: { type: "object", additionalProperties: true },
    validation: { type: "object", additionalProperties: true },
  },
  additionalProperties: false,
};
const suiteBranchReadOutputSchema = {
  type: "object",
  required: ["ok", "schema_version", "branch_key", "definition", "state", "guardrails"],
  properties: {
    ok: { type: "boolean" },
    schema_version: { const: "suite_mcp_branch_read_v1" },
    branch_key: { type: "string" },
    cockpit_revision_hash: { type: "string" },
    generated_at: { type: "string" },
    definition: { type: "object", additionalProperties: true },
    state: { type: "object", additionalProperties: true },
    conflicts: { type: "array", items: { type: "object", additionalProperties: true } },
    guardrails: suiteGuardrailsOutput,
  },
  additionalProperties: false,
};
const suitePreviewOutputSchema = {
  type: "object",
  required: ["ok", "schema_version", "guardrails"],
  properties: {
    ok: { type: "boolean" },
    schema_version: { type: "string" },
    execution_allowed: { const: false },
    hydration: { type: "object", additionalProperties: true },
    preview: { type: "object", additionalProperties: true },
    nyra: { type: "object", additionalProperties: true },
    guardrails: suiteGuardrailsOutput,
  },
  additionalProperties: true,
};
const suiteRunbookCatalogOutputSchema = {
  type: "object",
  required: ["ok", "schema_version", "runbooks", "guardrails"],
  properties: {
    ok: { type: "boolean" },
    schema_version: { const: "suite_mcp_runbook_catalog_v1" },
    generated_at: { type: "string" },
    mode: { type: "string" },
    execution_allowed: { const: false },
    runbooks: { type: "array", items: { type: "object", additionalProperties: true } },
    summary: { type: "object", additionalProperties: true },
    dispatch_contract: { type: "object", additionalProperties: true },
    guardrails: suiteGuardrailsOutput,
  },
  additionalProperties: true,
};

const skinScore = object({ key: { type: "string", enum: ["skin_tone_brightness", "water_oil_balance", "texture_fine_lines", "redness_sensitivity_signals", "spots_pigmentation_signals", "pores_texture"] }, label: { type: "string", maxLength: 120 }, score }, ["key", "score"]);
const scalpMetrics = object({ density_index: score, shaft_caliber_index: score, miniaturization_index: score, single_unit_percent: score, double_triple_unit_percent: score, empty_ostia_percent: score, broken_hair_percent: score, desquamation_percent: score, sebum_plug_percent: score, redness_percent: score, ostium_diameter_index: score, ostium_diameter_pixels: { type: "number", minimum: 0 }, ostia_count: { type: "integer", minimum: 0 }, confidence: probability });
const scalpAcquisition = object({ device_model: { type: "string", maxLength: 120 }, magnification: { type: "string", maxLength: 40 }, capture_protocol_id: identifier, polarization: { type: "string", enum: ["polarized", "non_polarized", "mixed", "unknown"] }, focus_score: score, illumination_score: score, zone_coverage_score: score });

export const TOOLS = [
  tool("core_health", "Check Core health", "Read Universal Core service health.", object(), ["core:read"]),
  tool("core_runtime_hierarchy_status", "Read Universal Core runtime hierarchy", "Use this when you need the live V7/V0/V1/V2 hierarchy mode and worker status. It is tenant-scoped, read-only and never authorizes execution.", object(), ["core:read"], true, true, { outputSchema: { type: "object", properties: { ok: { type: "boolean" }, tenant_id: { type: "string" }, runtime: { type: "object", additionalProperties: true } }, required: ["ok", "tenant_id"], additionalProperties: true } }),
  tool("core_runtime_hierarchy_evaluate", "Evaluate through Universal Core runtime hierarchy", "Use this when a read-only decision needs the V7 router, V0 final judge, V1 canonical digest and V2 shadow parity result. Tenant identity is authenticated server-side; this tool never authorizes execution.", object({
    request: text(12_000),
    operation_type: { type: "string", maxLength: 120 },
    core_input: { type: "object", properties: {
      signals: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: true } },
      data_quality: { type: "object", additionalProperties: true },
      context: { type: "object", additionalProperties: true },
    }, additionalProperties: false },
  }, ["request"]), ["core:read"], true, true, { outputSchema: object({ ok: { type: "boolean" }, tenant_id: { type: "string" }, core_runtime: coreRuntimeOutputSchema }, ["ok", "tenant_id", "core_runtime"]) }),
  tool("work_preflight", "Bootstrap shared memory and route work", "Use this as the first step for generic Nyra/Core work. It automatically loads the authenticated tenant's canonical STATE, TASKS, LOCKS, ARTIFACTS and HANDOFF documents by source path, then recalls relevant memory, assigns roles, opens Nyra/Core branches, builds the task graph, selects connected tools and returns fail-closed governance gates. It is not an authorization gate for tenant_provider_openai_status, setup, or the dedicated bounded multi-agent start/read/cancel tools, which use their own tenant OAuth owner gate. Never ask the user for a separate shared-memory loading prompt.", object({
    request: text(),
    target_system: { type: "string", maxLength: 100 },
    operation_type: { type: "string", maxLength: 100 },
    tool_name: { type: "string", maxLength: 100 },
    session_id: identifier,
    project_id: identifier,
    agent_id: identifier,
    response_mode: { type: "string", enum: ["compact", "full"] },
    nyra_branches: { type: "array", maxItems: 20, items: identifier },
    available_capabilities: { type: "array", maxItems: 50, items: { type: "string", maxLength: 80 } },
    core_input: { type: "object", properties: { signals: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: true } }, data_quality: { type: "object", additionalProperties: true }, context: { type: "object", additionalProperties: true } }, additionalProperties: false },
  }, ["request"]), ["core:read"], true, true, { outputSchema: workPreflightOutputSchema, meta: { "openai/outputTemplate": "ui://skinharmony/openai-provider-setup.html", "openai/toolInvocation/invoking": "Preparo Nyra…", "openai/toolInvocation/invoked": "Nyra è pronta." } }),
  tool("nyra_runtime_context", "Read Nyra runtime context", "Read Nyra readiness, tenant memory and control context. Product packs are resolved only from authenticated Core key metadata.", object({ include_control_snapshot: { type: "boolean" }, ...memoryScopeProperties }), ["core:read"]),
  tool("nyra_branch_catalog", "Read Nyra neural branches", "Read the tenant-scoped Nyra branch and subbranch catalog governed by Universal Core.", object(), ["core:read"]),
  tool("nyra_interpret_request", "Interpret a Nyra request", "Use this when a request needs Nyra routing, bounded cognition, dialogue validation or owner protection. It returns a compact fast result by default; choose deep for scenarios and hypotheses, or full only for diagnostics. Universal Core remains final authority and execution stays disabled.", object({ message: text(), session_id: identifier, project_id: identifier, agent_id: identifier, response_mode: { type: "string", enum: ["fast", "deep", "full"] }, nyra_branches: { type: "array", maxItems: 20, items: identifier }, available_capabilities: { type: "array", maxItems: 50, items: { type: "string", maxLength: 80 } } }, ["message"]), ["core:read"]),
  tool("nyra_fetch_analysis", "Fetch Nyra analysis details", "Use this after nyra_interpret_request when the compact result indicates that deeper or diagnostic details are relevant. Results are tenant-scoped and expire after five minutes; execution remains disabled.", object({ analysis_id: { type: "string", pattern: "^nyra_[a-f0-9]{24}$" }, response_mode: { type: "string", enum: ["deep", "full"] }, session_id: identifier, agent_id: identifier }, ["analysis_id"]), ["core:read"]),
  tool("core_gate_action", "Evaluate and authorize a scoped action", "Ask Universal Core to evaluate an action and, only for supported fail-closed operation classes, return a scoped authorization. This tool never executes the action.", { type: "object", required: ["action_label", "action_type"], properties: { action_label: text(500), action_type: text(120), operation_class: text(120), target_commit: { type: "string", pattern: "^[a-fA-F0-9]{40}$" }, read_only: { type: "boolean" }, dry_run: { type: "boolean" }, external_side_effect: { type: "boolean" }, contains_customer_data: { type: "boolean" }, contains_secret: { type: "boolean" }, cross_tenant: { type: "boolean" }, destructive: { type: "boolean" }, verified_outcome: { type: "boolean" }, bypass_orchestrator: { type: "boolean" }, rollback_ready: { type: "boolean" }, audit_ready: { type: "boolean" }, configuration_changes: { type: "boolean" } }, additionalProperties: true }, ["core:govern"], false, true),
  tool("suite_status", "Read Suite connection status", "Use this when the authenticated tenant needs WordPress node freshness, Render connectivity, module coverage and branch readiness without loading the full Cockpit.", object({ node_id: suiteResourceId }), ["core:read"], true, true, {
    exactInputSchema: true,
    outputSchema: suiteStatusOutputSchema,
    meta: { "openai/toolInvocation/invoking": "Reading Suite status…", "openai/toolInvocation/invoked": "Suite status ready" },
  }),
  tool("suite_cockpit_360", "Read Suite Cockpit 360", "Use this when the authenticated tenant needs the aggregate Suite Cockpit across all branches, priorities, conflicts, module coverage and freshness. It never returns raw customer records or executes actions.", object({ node_id: suiteResourceId }), ["core:read"], true, true, {
    exactInputSchema: true,
    outputSchema: suiteCockpitOutputSchema,
    meta: { "openai/toolInvocation/invoking": "Loading Suite Cockpit…", "openai/toolInvocation/invoked": "Suite Cockpit ready" },
  }),
  tool("suite_branch_catalog", "Read Suite branch architecture", "Use this when the authenticated tenant needs the versioned architecture of every Suite branch, including evidence, dependencies, decision rules, outputs, runbooks and Core/Nyra bindings.", object(), ["core:read"], true, true, {
    exactInputSchema: true,
    outputSchema: suiteBranchCatalogOutputSchema,
    meta: { "openai/toolInvocation/invoking": "Loading Suite branches…", "openai/toolInvocation/invoked": "Suite branches ready" },
  }),
  tool("suite_branch_read", "Read one Suite branch", "Use this when the authenticated tenant needs one Suite branch contract combined with its current Cockpit state, evidence gaps, dependency resolution and conflicts.", object({ branch_key: suiteBranchKey, node_id: suiteResourceId }, ["branch_key"]), ["core:read"], true, true, {
    exactInputSchema: true,
    outputSchema: suiteBranchReadOutputSchema,
    meta: { "openai/toolInvocation/invoking": "Reading Suite branch…", "openai/toolInvocation/invoked": "Suite branch ready" },
  }),
  tool("suite_decision_preview", "Preview a Suite decision", "Use this when the authenticated tenant asks what to do next in Suite. Render hydrates the latest aggregate Cockpit server-side, then Nyra and Core explain a preview; no caller snapshot is accepted and no action is executed.", object({
    question: text(1_200),
    node_id: suiteResourceId,
    branch_keys: { type: "array", maxItems: 14, uniqueItems: true, items: suiteBranchKey },
  }, ["question"]), ["core:govern"], true, true, {
    exactInputSchema: true,
    outputSchema: suitePreviewOutputSchema,
    meta: { "openai/toolInvocation/invoking": "Building Suite preview…", "openai/toolInvocation/invoked": "Suite preview ready" },
  }),
  tool("suite_runbook_catalog", "Read Suite runbook catalog", "Use this when the authenticated tenant needs the available Suite automations, their risk, Core gate and proposal-only execution boundary.", object(), ["core:read"], true, true, {
    exactInputSchema: true,
    outputSchema: suiteRunbookCatalogOutputSchema,
    meta: { "openai/toolInvocation/invoking": "Loading Suite runbooks…", "openai/toolInvocation/invoked": "Suite runbooks ready" },
  }),
  tool("suite_runbook_preview", "Preview a Suite runbook", "Use this when the authenticated tenant needs readiness, blockers and owner-confirmation requirements for one Suite runbook on one explicit WordPress node. This tool cannot queue, dispatch or execute it.", object({ runbook_id: suiteResourceId, node_id: suiteResourceId }, ["runbook_id", "node_id"]), ["core:govern"], true, true, {
    exactInputSchema: true,
    outputSchema: suitePreviewOutputSchema,
    meta: { "openai/toolInvocation/invoking": "Previewing Suite runbook…", "openai/toolInvocation/invoked": "Runbook preview ready" },
  }),
  tool("intelligence_workflow", "Run full Nyra Core intelligence workflow", "Run a memory-first workflow across scenarios, hypotheses, event probabilities, counterfactuals, decision ranking and optional outcome verification. It analyzes and explains but never executes.", { type: "object", properties: {
    ...intelligenceContext,
    workflow_id: identifier,
    generate_scenarios: { type: "boolean" },
    scenarios: { type: "array", maxItems: 20, items: intelligenceCandidate },
    hypotheses: { type: "array", maxItems: 30, items: intelligenceCandidate },
    events: { type: "array", maxItems: 50, items: intelligenceCandidate },
    baseline: intelligenceCandidate,
    alternatives: { type: "array", maxItems: 30, items: intelligenceCandidate },
    options: { type: "array", maxItems: 30, items: intelligenceCandidate },
    predicted_probability: probability,
    actual_outcome: { anyOf: [{ type: "boolean" }, { type: "string", enum: ["occurred", "not_occurred"] }] },
  }, required: ["request"], additionalProperties: false }, ["core:read"]),
  tool("scenario_analysis", "Generate and compare scenarios", "Build explicit favorable, central and adverse scenarios or compare supplied scenarios using prior, evidence, probability ranges, expected value, risk and assumptions.", object({ ...intelligenceContext, scenarios: { type: "array", maxItems: 20, items: intelligenceCandidate } }, ["question"]), ["core:read"]),
  tool("hypothesis_rank", "Rank competing hypotheses", "Rank hypotheses with transparent probability updates, evidence balance, confidence, expected value and unresolved-tie detection.", object({ ...intelligenceContext, hypotheses: { type: "array", minItems: 2, maxItems: 30, items: intelligenceCandidate } }, ["question", "hypotheses"]), ["core:read"]),
  tool("event_probability", "Evaluate event probabilities", "Estimate and prioritize possible events using base rate, evidence, probability interval, impact, urgency, triggers and leading indicators.", object({ ...intelligenceContext, events: { type: "array", minItems: 1, maxItems: 50, items: intelligenceCandidate } }, ["question", "events"]), ["core:read"]),
  tool("counterfactual_analysis", "Compare counterfactual paths", "Compare the baseline with alternative worlds and show probability, utility, risk, reversibility and delta from baseline.", object({ ...intelligenceContext, baseline: intelligenceCandidate, alternatives: { type: "array", minItems: 1, maxItems: 20, items: intelligenceCandidate } }, ["question", "baseline", "alternatives"]), ["core:read"]),
  tool("decision_select", "Select the strongest option", "Rank at least two options by probability, expected value, risk, reversibility, strategic fit and evidence confidence. Selection never authorizes execution.", object({ ...intelligenceContext, decision: text(), options: { type: "array", minItems: 2, maxItems: 30, items: intelligenceCandidate } }, ["decision", "options"]), ["core:read"]),
  tool("outcome_verify", "Verify a predicted outcome", "Compare a prediction with the observed result and compute Brier score, calibration error, surprise and lessons without storing it.", object({ prediction_id: { type: "string", maxLength: 120 }, outcome_id: { type: "string", maxLength: 120 }, domain: identifier, horizon: { type: "string", maxLength: 240 }, predicted_probability: probability, actual_outcome: { anyOf: [{ type: "boolean" }, { type: "string", enum: ["occurred", "not_occurred"] }] }, lessons: { type: "array", maxItems: 20, items: text(1_000) }, ...memoryScopeProperties }, ["predicted_probability", "actual_outcome"]), ["core:read"]),
  tool("outcome_record", "Record a verified outcome", "Persist a tenant-scoped verified outcome after Core governance so calibration can improve from real results. This never changes live weights automatically.", object({ prediction_id: { type: "string", maxLength: 120 }, outcome_id: { type: "string", maxLength: 120 }, domain: identifier, horizon: { type: "string", maxLength: 240 }, predicted_probability: probability, actual_outcome: { anyOf: [{ type: "boolean" }, { type: "string", enum: ["occurred", "not_occurred"] }] }, notes: { type: "string", maxLength: 2_000 }, lessons: { type: "array", maxItems: 20, items: text(1_000) }, ...memoryScopeProperties }, ["outcome_id", "predicted_probability", "actual_outcome"]), ["core:govern"], false, true),
  tool("calibration_status", "Read tenant intelligence calibration", "Read tenant-scoped prediction quality, recent verified outcomes and calibration recommendation. Live weight mutation remains disabled.", object({ limit: { type: "integer", minimum: 1, maximum: 100 } }), ["core:read"]),
  tool("decision_ledger_report", "Read Core decision ledger report", "Read tenant-scoped counts for AI work, Core corrections, denials, confirmations, failures and verified outcomes. Raw prompts and secrets are never returned.", object({ days: { type: "integer", minimum: 1, maximum: 365 } }), ["core:read"]),
  tool("nyra_research_plan", "Plan governed web research", "Use this when Nyra needs current external evidence. Core returns source, freshness, citation and safety constraints; then use the host ChatGPT or Codex web tool before ingesting evidence.", object({
    question: text(2_000),
    decision_context: { type: "string", maxLength: 1_000 },
    allowed_domains: { type: "array", maxItems: 20, items: { type: "string", maxLength: 253 } },
    domain_pack: identifier,
  }, ["question"]), ["core:read"], true, false),
  tool("nyra_research_ingest", "Ingest governed research evidence", "Use this after web research to submit short excerpts, source metadata and claim-source links. Secrets are rejected, personal data is redacted and content is stored only inside the authenticated tenant as a candidate or quarantine.", object({
    plan_id: identifier,
    question: text(2_000),
    decision_context: { type: "string", maxLength: 1_000 },
    plan: researchPlanPolicy,
    sources: { type: "array", minItems: 1, maxItems: 20, items: researchSource },
    claims: { type: "array", minItems: 1, maxItems: 30, items: researchClaim },
    project_id: identifier,
    session_id: identifier,
    domain_pack: identifier,
    idempotency_key: text(120),
  }, ["plan_id", "question", "plan", "sources", "claims", "idempotency_key"]), ["core:govern"], false, true),
  tool("nyra_research_query", "Query tenant research evidence", "Use this when Nyra needs previously captured evidence for the authenticated tenant. Quarantined content is excluded unless a governor explicitly requests its metadata.", object({
    query: { type: "string", maxLength: 500 },
    state: { type: "string", enum: ["candidate", "quarantined", "validated", "deprecated"] },
    limit: { type: "integer", minimum: 1, maximum: 50 },
  }), ["core:read"]),
  tool("nyra_research_status", "Read research cortex status", "Use this to inspect tenant evidence counts, learning policy and provider availability without exposing provider credentials.", object(), ["core:read"]),
  tool("nyra_research_feedback", "Review research evidence", "Use this when an authorized reviewer confirms, challenges or deprecates a research record. Only eligible confirmed evidence is promoted to tenant memory.", object({
    record_id: { type: "string", pattern: "^research_[a-f0-9-]{36}$" },
    verdict: { type: "string", enum: ["confirm", "challenge", "deprecate"] },
    rationale: text(2_000),
  }, ["record_id", "verdict", "rationale"]), ["core:govern"], false, false),
  tool("nyra_research_execute", "Run optional OpenAI web research", "Use this only when host browsing is unavailable and the optional server-side OpenAI fallback is enabled. It performs billable live web search but does not persist results; review and ingest the returned evidence template separately.", object({
    query: text(2_000),
    allowed_domains: { type: "array", maxItems: 20, items: { type: "string", maxLength: 253 } },
    search_context_size: { type: "string", enum: ["low", "medium", "high"] },
  }, ["query"]), ["core:govern"], false, false, { openWorld: true }),
  tool("skin_analyzer", "Interpret Skin Analyzer scores", "Read-only cosmetic interpretation of structured skin scores through the authenticated tenant Core branch; never diagnoses, prescribes or auto-publishes.", object({
    scores: { type: "array", minItems: 1, maxItems: 12, items: skinScore }, products: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } }, protocols: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } }, report_text: { type: "string", maxLength: 10_000 }, data_quality_score: score,
    acquisition: object({ device_model: { type: "string", maxLength: 120 }, capture_protocol_id: identifier, focus_score: score, illumination_score: score, color_calibrated: { type: "boolean" }, polarization: { type: "string", enum: ["polarized", "non_polarized", "mixed", "unknown"] } }), previous_scores: { type: "array", maxItems: 12, items: skinScore }, previous_acquisition: object({ device_model: { type: "string", maxLength: 120 }, capture_protocol_id: identifier }), learning_context: object({ outcome_verified: { type: "boolean" }, human_reviewed: { type: "boolean" }, comparable_capture_count: { type: "integer", minimum: 0, maximum: 1000000 } }), session_id: identifier,
  }, ["scores"]), ["core:read"], true, true),
  tool("scalp_analyzer", "Interpret Scalp Analyzer metrics", "Read-only Scalp v2 for medical-study documentation support, salon technical trichology and pharmacy dermocosmetic counselling. It never impersonates a physician, diagnoses, prescribes or auto-publishes marketing.", object({
    overall: scalpMetrics, zones: { type: "array", maxItems: 12, items: object({ zone: identifier, metrics: scalpMetrics }, ["zone", "metrics"]) }, acquisition: scalpAcquisition, previous: object({ overall: scalpMetrics, acquisition: scalpAcquisition }), reported_warning_signals: { type: "array", maxItems: 5, uniqueItems: true, items: { type: "string", enum: ["sudden_change", "pain", "bleeding", "open_lesion", "infection_suspected"] } }, professional_profile: { type: "string", enum: ["medical_study", "salon_trichology", "pharmacy_dermocosmetic"] }, learning_context: object({ outcome_verified: { type: "boolean" }, human_reviewed: { type: "boolean" }, comparable_capture_count: { type: "integer", minimum: 0, maximum: 1000000 } }), locale: { type: "string", enum: ["it", "en"] }, session_id: identifier,
  }, ["overall"]), ["core:read"], true, true),
  tool("tenant_provider_openai_status", "Check OpenAI connection", "Use at the start of every connected conversation and before creating agents. This native control-plane check never requires work_preflight or shared-memory bootstrap. It returns only masked provider status. Treat bounded_execution_ready=true as ready even though execution_enabled stays false by design; if onboarding_required=true, open tenant_provider_openai_setup_panel immediately.", object(), ["core:read"], true, true, { outputSchema: object({
    ok: { type: "boolean" },
    tenant_id: { type: "string" },
    provider: { type: "object", additionalProperties: true },
  }, ["ok", "tenant_id", "provider"]) }),
  tool("tenant_provider_openai_setup_panel", "Open secure OpenAI setup", "Use this to open the fixed OpenAI connection panel without running work_preflight. The user presses one button there to generate a one-time secure link; never ask them to paste an API key into chat.", object(), ["core:read"], true, true, { meta: { "openai/outputTemplate": "ui://skinharmony/openai-provider-setup.html", "openai/toolInvocation/invoking": "Apro la configurazione sicura…", "openai/toolInvocation/invoked": "Configurazione sicura pronta." } }),
  tool("tenant_provider_openai_setup_link", "Connect OpenAI securely", "Use immediately when the user asks to connect OpenAI, configure an existing API key, or create agents and no provider is connected. Returns the fixed protected portal for the authenticated tenant administrator; only after fresh OAuth verification does that portal mint a short-lived one-time page for entering the key. Never ask for the key in ChatGPT or Codex. Opening the portal does not enable model execution.", object(), ["core:govern"], false, false, { outputSchema: object({
    ok: { type: "boolean" },
    tenant_id: { type: "string" },
    setup_url: { type: "string", format: "uri" },
    execution_enabled: { const: false },
  }, ["ok", "tenant_id", "setup_url", "execution_enabled"]) }),
  tool("tenant_provider_openai_multi_agent_smoke_run", "Run bounded OpenAI multi-agent test", "Start the bounded OpenAI multi-agent test directly, without work_preflight or shared-memory bootstrap, using the authenticated tenant's already-encrypted OpenAI key: Researcher → Reviewer → Nyra Synthesizer. Its native gate verifies configured provider, execution availability, authenticated tenant OAuth owner and a fresh request-bound confirmation. A completed run makes three sequential real calls; cancellation or a safety failure stops before every remaining call. Use only after the tenant owner explicitly confirms this exact test. The response immediately returns a run id; then read or cancel it. Fixed first-live budget: at most three sequential calls, 200 output tokens per stage, no browser, tools, external actions, writes, learning, or automatic retries. Never pass an API key, tenant id, model, agents, or budget in arguments.", object({
    task: text(300),
  }, ["task"]), ["core:govern"], false, false, { outputSchema: object({
    ok: { type: "boolean" },
    tenant_id: { type: "string" },
    run: { type: "object", additionalProperties: true },
    governance: { type: "object", additionalProperties: true },
  }, ["ok", "tenant_id", "run", "governance"]), meta: { "skinharmony/confirmation_authority": "tenant_provider_owner" } }),
  tool("tenant_provider_openai_multi_agent_run_read", "Read bounded multi-agent test", "Read status and tenant-scoped output of a bounded OpenAI multi-agent test. Requires the authenticated provider owner, never invokes the provider, and spends no API credits.", object({
    run_id: { type: "string", maxLength: 160 },
  }, ["run_id"]), ["core:read"], true, true),
  tool("tenant_provider_openai_multi_agent_run_cancel", "Cancel bounded multi-agent test", "Immediately cancel a tenant-scoped bounded OpenAI multi-agent test. The kill signal aborts the in-flight provider request and all remaining stages; it never starts a replacement call.", object({
    run_id: { type: "string", maxLength: 160 },
  }, ["run_id"]), ["core:govern"], false, true, { meta: { "skinharmony/confirmation_authority": "tenant_provider_owner" } }),
  tool("generic_agent_orchestration_create", "Create generic agent orchestration", "Create a bounded tenant-scoped worker plan for an existing generic agent run. This plans internal work only and never authorizes external execution.", object({
    run_id: { type: "string", maxLength: 160 },
    workers: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", properties: {
      worker_id: identifier,
      agent_id: identifier,
      task: text(4_000),
      dependencies: { type: "array", maxItems: 200, items: identifier },
    }, required: ["worker_id", "agent_id", "task"], additionalProperties: false } },
  }, ["run_id", "workers"]), ["core:govern"], false, false),
  tool("generic_agent_orchestration_claim", "Claim ready generic workers", "Claim only dependency-ready workers within the orchestration concurrency limit.", object({
    plan_id: { type: "string", maxLength: 160 },
  }, ["plan_id"]), ["core:govern"], false, false),
  tool("generic_agent_orchestration_complete", "Complete generic orchestration worker", "Record one worker's bounded internal result and unlock its dependents; no external action is executed.", object({
    plan_id: { type: "string", maxLength: 160 },
    worker_id: identifier,
    result: { type: "object", additionalProperties: true },
  }, ["plan_id", "worker_id"]), ["core:govern"], false, false),
  tool("generic_agent_orchestration_cancel", "Cancel generic orchestration", "Cancel a tenant-scoped generic orchestration plan. Cancellation is terminal and does not execute any external action.", object({
    plan_id: { type: "string", maxLength: 160 },
  }, ["plan_id"]), ["core:govern"], false, false),
  tool("generic_agent_orchestration_join", "Join generic orchestration in Core", "Ask Core to join completed worker results after every planned worker has completed.", object({
    plan_id: { type: "string", maxLength: 160 },
  }, ["plan_id"]), ["core:govern"], false, false),
  tool("generic_agent_start", "Start a generic agent run", "Start a tenant-scoped generic agent runtime with an explicit task and declared tools. This creates an internal run only; it does not authorize external execution.", object({
    agent_id: identifier,
    task: text(4_000),
    tools: { type: "array", maxItems: 64, items: identifier },
    run_id: { type: "string", maxLength: 160 },
    session_id: { type: "string", maxLength: 160 },
    parent_run_id: { type: "string", maxLength: 160 },
    metadata: { type: "object", additionalProperties: true },
  }, ["agent_id", "task"]), ["core:govern"], false, false),
  tool("generic_agent_checkpoint", "Save generic agent checkpoint", "Persist a tenant-scoped generic agent checkpoint with optimistic revision control so governed work can recover safely.", object({
    run_id: { type: "string", maxLength: 160 },
    checkpoint: { type: "object", properties: {
      state: { type: "object", additionalProperties: true },
      cursor: { type: "string", maxLength: 1_000 },
      idempotency_key: { type: "string", maxLength: 160 },
    }, required: ["state"], additionalProperties: false },
    expected_revision: { type: "integer", minimum: 0 },
  }, ["run_id", "checkpoint"]), ["core:govern"], false, false),
  tool("generic_agent_run_read", "Read generic agent run", "Read a tenant-scoped generic agent run and its latest durable checkpoint metadata.", object({
    run_id: { type: "string", maxLength: 160 },
  }, ["run_id"]), ["core:read"]),
  tool("generic_agent_evaluate", "Evaluate generic agent output", "Score explicit expected-versus-actual generic agent cases. This evaluation never mutates live agent behavior.", object({
    cases: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", properties: {
      id: identifier,
      expected: { type: "object", additionalProperties: true },
      actual: { type: "object", additionalProperties: true },
      weight: { type: "number", exclusiveMinimum: 0 },
    }, required: ["id"], additionalProperties: false } },
  }, ["cases"]), ["core:read"]),
  tool("memory_context", "Read tenant AI context", "Read the authenticated tenant's current checkpoint, relevant memories, pending handoffs and recent redacted activity.", object({ ...memoryScopeProperties, activity_limit: { type: "integer", minimum: 1, maximum: 50 } }), ["core:read"]),
  tool("memory_search", "Search tenant AI memory", "Search durable, redacted memory belonging only to the authenticated tenant.", object(memoryScopeProperties), ["core:read"]),
  tool("memory_append", "Append tenant AI memory", "Store an explicit durable memory after Core governance, consent checks and secret redaction.", object({ kind: memoryKind, ...memoryProperties }, ["title", "summary"]), ["core:govern"], false, true),
  tool("memory_checkpoint", "Create tenant AI checkpoint", "Save a durable checkpoint so another AI can resume the authenticated tenant's work.", object(memoryProperties, ["summary"]), ["core:govern"], false, true),
  tool("memory_handoff", "Create tenant AI handoff", "Create a durable handoff for another AI inside the authenticated tenant.", object({ ...memoryProperties, to_agent_id: { anyOf: [identifier, { const: "all" }] } }, ["summary", "to_agent_id"]), ["core:govern"], false, true),
  tool("memory_handoff_acknowledge", "Acknowledge tenant AI handoff", "Acknowledge a handoff addressed to this AI inside the authenticated tenant.", object({ handoff_id: { type: "string", pattern: "^mem_[a-f0-9-]{36}$" }, agent_id: identifier }, ["handoff_id", "agent_id"]), ["core:govern"], false, true),
  tool("search", "Search tenant knowledge", "Use this when ChatGPT, Codex, company knowledge or deep research needs validated tenant documents and research evidence.", object({ query: text(500) }, ["query"]), ["core:read"], true, true, { exactInputSchema: true, outputSchema: searchOutputSchema }),
  tool("fetch", "Fetch tenant knowledge document", "Use this after search to read one tenant-scoped document or validated research source with a canonical citation URL.", object({ id: { type: "string", pattern: "^[a-f0-9]{24}$" } }, ["id"]), ["core:read"], true, true, { exactInputSchema: true, outputSchema: fetchOutputSchema }),
  tool("memory_cloud_status", "Check persistent cloud memory", "Read the authenticated tenant's persistent memory backend, document count and last update.", object(), ["core:read"]),
  tool("memory_document_upsert", "Synchronize a redacted work document", "Create or update one tenant-scoped work document in persistent cloud memory. The server redacts secrets again and verifies the optional SHA-256 checksum.", object({
    source_path: { type: "string", minLength: 1, maxLength: 500, pattern: "^(?!.*\\.\\.)[^\\u0000]+$" },
    title: { type: "string", minLength: 1, maxLength: 240 },
    text: { type: "string", minLength: 1, maxLength: 900000 },
    content_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    metadata: { type: "object", additionalProperties: { type: ["string", "number", "boolean", "null"] } },
  }, ["source_path", "title", "text"]), ["core:govern"], false, true),

  tool("workspace_list", "List shared workspace", "List folders and document metadata inside the authenticated tenant workspace.", object({ prefix: { type: "string", maxLength: 240 } }), ["core:read"]),
  tool("workspace_create_folder", "Create shared folder", "Create a tenant-scoped logical folder after Core governance.", object({ path: text(240) }, ["path"]), ["core:govern"], false, true),
  tool("workspace_read_document", "Read shared document", "Read one tenant-scoped shared document by id or path.", object({ id: { type: "string" }, path: { type: "string", maxLength: 240 } }), ["core:read"]),
  tool("workspace_write_document", "Write shared document", "Create or version a tenant-scoped document with optimistic concurrency and Core governance.", object({ path: text(240), title: { type: "string", maxLength: 200 }, content: text(100_000), expected_version: { type: "integer", minimum: 0 }, idempotency_key: { type: "string", maxLength: 120 } }, ["path", "content"]), ["core:govern"], false, true),

  tool("task_list", "List shared tasks", "List tenant-scoped tasks for agent coordination.", object({ status: { type: "string", enum: ["open", "claimed", "in_progress", "blocked", "completed", "cancelled"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }), ["core:read"]),
  tool("task_create", "Create shared task", "Create a tenant-scoped task after Core governance.", object({ title: text(240), description: { type: "string", maxLength: 20_000 }, priority: { type: "string", enum: ["low", "normal", "high", "urgent"] }, idempotency_key: { type: "string", maxLength: 120 } }, ["title"]), ["core:govern"], false, true),
  tool("task_claim", "Claim shared task", "Atomically claim an open tenant-scoped task for one registered agent.", object({ task_id: text(80), agent_id: identifier, expected_version: { type: "integer", minimum: 1 } }, ["task_id", "agent_id", "expected_version"]), ["core:govern"], false, true),
  tool("task_update", "Update shared task", "Update the status of a claimed tenant-scoped task using optimistic concurrency.", object({ task_id: text(80), agent_id: identifier, status: { type: "string", enum: ["claimed", "in_progress", "blocked", "completed", "cancelled"] }, note: { type: "string", maxLength: 10_000 }, expected_version: { type: "integer", minimum: 1 } }, ["task_id", "agent_id", "status", "expected_version"]), ["core:govern"], false, true),

  tool("agent_heartbeat", "Register unique agent presence", "Register or refresh one uniquely signed ChatGPT, Codex, API-agent or other session. A different session cannot silently reuse the same agent_id.", object({ agent_id: identifier, client_type: { type: "string", enum: ["chatgpt", "codex", "api_agent", "other"] }, session_id: { type: "string", minLength: 1, maxLength: 240 }, display_name: { type: "string", maxLength: 120 }, capabilities: { type: "array", maxItems: 20, items: identifier } }, ["agent_id", "client_type", "session_id"]), ["core:govern"], false, true),
  tool("agent_list", "List tenant agents", "List registered agents and their last heartbeat in the authenticated tenant.", object(), ["core:read"]),
  tool("message_post", "Post agent message", "Post a tenant-scoped message from a registered agent to another agent or all agents.", object({ from_agent_id: identifier, to_agent_id: { anyOf: [identifier, { const: "all" }] }, body: text(20_000), thread_id: { type: "string", maxLength: 80 }, idempotency_key: { type: "string", maxLength: 120 } }, ["from_agent_id", "body"]), ["core:govern"], false, true),
  tool("message_inbox", "Read agent inbox", "Read tenant-scoped messages addressed to one agent or all agents.", object({ agent_id: identifier, unread_only: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["agent_id"]), ["core:read"]),
  tool("message_acknowledge", "Acknowledge agent message", "Mark one tenant-scoped agent message as read.", object({ message_id: text(80), agent_id: identifier }, ["message_id", "agent_id"]), ["core:govern"], false, true)
];
