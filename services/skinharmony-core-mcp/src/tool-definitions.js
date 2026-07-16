function annotations(readOnly, idempotent = false, openWorld = false) {
  return { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: openWorld, idempotentHint: idempotent };
}

const ownerConfirmationProperties = {
  owner_confirmed: {
    type: "boolean",
    description: "Set true only after the owner explicitly confirms this exact write action.",
  },
  confirmation_reference: {
    type: "string",
    maxLength: 240,
    description: "Short audit reference for the explicit owner confirmation; never include secrets.",
  },
};

function tool(name, title, description, inputSchema, scopes, readOnly = true, idempotent = true, options = {}) {
  const schema = !readOnly && inputSchema?.type === "object"
    ? { ...inputSchema, properties: { ...inputSchema.properties, ...ownerConfirmationProperties } }
    : inputSchema;
  return {
    name,
    title,
    description: /^Use this when\b/.test(description)
      ? description
      : `Use this when this capability is needed. ${description}`,
    inputSchema: options.examples ? { ...schema, examples: options.examples } : schema,
    outputSchema: options.outputSchema || { type: "object", additionalProperties: true },
    scopes,
    annotations: annotations(readOnly, idempotent, options.openWorld === true),
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
const softwareAuthorization = object({
  asserted: { const: true },
  basis: { type: "string", enum: ["owned", "written_permission", "open_source"] },
  purpose: { type: "string", enum: ["compatibility", "customization", "debugging", "interoperability", "maintenance", "security_review", "testing"] },
  owner_confirmed: { type: "boolean" },
  artifact_owner: identifier,
}, ["asserted", "basis", "purpose"]);
const softwareArtifact = object({
  name: { type: "string", maxLength: 240 },
  content_base64: { type: "string", maxLength: 8_388_608 },
}, ["name", "content_base64"]);
const softwareEvidenceOutputSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    job: {
      type: "object",
      properties: {
        schema_version: { const: "universal_software_job_v1" },
        job_id: { type: "string" },
        mode: { type: "string", enum: ["lightweight_static", "ghidra_headless", "frida_local_agent"] },
        state: { type: "string", enum: ["queued", "running", "completed", "failed"] },
        evidence: {
          anyOf: [
            { type: "null" },
            { type: "object", properties: { schema_version: { const: "universal_software_evidence_v1" } }, additionalProperties: true },
          ],
        },
        error: { anyOf: [{ type: "null" }, { type: "string" }] },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};
const skinScore = object({
  key: { type: "string", enum: ["skin_tone_brightness", "water_oil_balance", "texture_fine_lines", "redness_sensitivity_signals", "spots_pigmentation_signals", "pores_texture"] },
  label: { type: "string", maxLength: 120 },
  score,
}, ["key", "score"]);
const scalpMetrics = object({
  density_index: score,
  shaft_caliber_index: score,
  miniaturization_index: score,
  single_unit_percent: score,
  double_triple_unit_percent: score,
  empty_ostia_percent: score,
  broken_hair_percent: score,
  desquamation_percent: score,
  sebum_plug_percent: score,
  redness_percent: score,
  ostium_diameter_index: score,
  ostium_diameter_pixels: { type: "number", minimum: 0 },
  ostia_count: { type: "integer", minimum: 0 },
  confidence: probability,
});
const scalpAcquisition = object({
  device_model: { type: "string", maxLength: 120 }, magnification: { type: "string", maxLength: 40 }, capture_protocol_id: identifier,
  polarization: { type: "string", enum: ["polarized", "non_polarized", "mixed", "unknown"] }, focus_score: score, illumination_score: score, zone_coverage_score: score,
});

export const TOOLS = [
  tool("core_health", "Check Core health", "Read Universal Core service health.", object(), ["core:read"]),
  tool("work_preflight", "Route work through Nyra and Core", "Mandatory first step before any connected AI begins work. Recalls tenant memory, assigns roles, opens Nyra/Core branches, builds the task graph, selects connected tools and returns non-executing governance gates.", object({
    request: text(),
    target_system: { type: "string", maxLength: 100 },
    operation_type: { type: "string", maxLength: 100 },
    tool_name: { type: "string", maxLength: 100 },
    session_id: identifier,
    project_id: identifier,
    agent_id: identifier,
    nyra_branches: { type: "array", maxItems: 20, items: identifier },
    available_capabilities: { type: "array", maxItems: 50, items: { type: "string", maxLength: 80 } },
  }, ["request"]), ["core:read"]),
  tool("nyra_runtime_context", "Read Nyra runtime context", "Read Nyra readiness, tenant memory and control context. Product packs are resolved only from authenticated Core key metadata.", object({ include_control_snapshot: { type: "boolean" }, ...memoryScopeProperties }), ["core:read"]),
  tool("nyra_branch_catalog", "Read Nyra neural branches", "Read the tenant-scoped Nyra branch and subbranch catalog governed by Universal Core.", object(), ["core:read"]),
  tool("nyra_interpret_request", "Interpret a Nyra request", "Run the mandatory memory-first Nyra/Core preflight, open the relevant branches and interpret a request without executing it. Product packs are resolved only from authenticated Core key metadata.", object({ message: text(), session_id: identifier, project_id: identifier, agent_id: identifier, nyra_branches: { type: "array", maxItems: 20, items: identifier }, available_capabilities: { type: "array", maxItems: 50, items: { type: "string", maxLength: 80 } } }, ["message"]), ["core:read"]),
  tool("core_gate_action", "Evaluate and authorize a scoped action", "Ask Universal Core to evaluate an action and, only for supported fail-closed operation classes, return a scoped authorization. This tool never executes the action.", { type: "object", required: ["action_label", "action_type"], properties: { action_label: text(500), action_type: text(120), operation_class: text(120), target_commit: { type: "string", pattern: "^[a-fA-F0-9]{40}$" }, read_only: { type: "boolean" }, dry_run: { type: "boolean" }, external_side_effect: { type: "boolean" }, contains_customer_data: { type: "boolean" }, contains_secret: { type: "boolean" }, cross_tenant: { type: "boolean" }, destructive: { type: "boolean" }, verified_outcome: { type: "boolean" }, bypass_orchestrator: { type: "boolean" }, rollback_ready: { type: "boolean" }, audit_ready: { type: "boolean" }, configuration_changes: { type: "boolean" } }, additionalProperties: true }, ["core:govern"], false, true),
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
  tool("outcome_verify", "Verify a predicted outcome", "Compare a prediction with the observed result and compute Brier score, calibration error, surprise and lessons without storing it.", object({ prediction_id: { type: "string", maxLength: 120 }, outcome_id: { type: "string", maxLength: 120 }, domain: identifier, horizon: { type: "string", maxLength: 240 }, predicted_probability: probability, actual_outcome: { anyOf: [{ type: "boolean" }, { type: "string", enum: ["occurred", "not_occurred"] }] }, notes: { type: "string", maxLength: 10_000 }, lessons: { type: "array", maxItems: 20, items: text(1_000) }, ...memoryScopeProperties }, ["predicted_probability", "actual_outcome"]), ["core:read"]),
  tool("outcome_record", "Record a verified outcome", "Persist a tenant-scoped verified outcome after Core governance so calibration can improve from real results. This never changes live weights automatically.", object({ prediction_id: { type: "string", maxLength: 120 }, outcome_id: { type: "string", maxLength: 120 }, domain: identifier, horizon: { type: "string", maxLength: 240 }, predicted_probability: probability, actual_outcome: { anyOf: [{ type: "boolean" }, { type: "string", enum: ["occurred", "not_occurred"] }] }, notes: { type: "string", maxLength: 10_000 }, lessons: { type: "array", maxItems: 20, items: text(1_000) }, ...memoryScopeProperties }, ["outcome_id", "predicted_probability", "actual_outcome"]), ["core:govern"], false, true),
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
  tool("skin_analyzer", "Interpret Skin Analyzer scores", "Use this when a permitted analyzer tenant needs a read-only cosmetic interpretation of structured skin scores. Universal Core selects the authenticated tenant product pack and returns advisory patterns only; this tool does not diagnose, prescribe, publish, or accept a tenant identifier.", object({
    scores: { type: "array", minItems: 1, maxItems: 12, items: skinScore },
    products: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } },
    protocols: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } },
    report_text: { type: "string", maxLength: 10_000 },
    data_quality_score: score,
    acquisition: object({ device_model: { type: "string", maxLength: 120 }, capture_protocol_id: identifier, focus_score: score, illumination_score: score, color_calibrated: { type: "boolean" }, polarization: { type: "string", enum: ["polarized", "non_polarized", "mixed", "unknown"] } }),
    previous_scores: { type: "array", maxItems: 12, items: skinScore },
    previous_acquisition: object({ device_model: { type: "string", maxLength: 120 }, capture_protocol_id: identifier }),
    learning_context: object({ outcome_verified: { type: "boolean" }, human_reviewed: { type: "boolean" }, comparable_capture_count: { type: "integer", minimum: 0, maximum: 1000000 } }),
    session_id: identifier,
  }, ["scores"]), ["core:read"], true, true, { examples: [{ scores: [{ key: "pores_texture", label: "Pori e grana", score: 42 }], data_quality_score: 86 }] }),
  tool("scalp_analyzer", "Interpret Scalp Analyzer metrics", "Use this when an authenticated tenant needs a read-only, non-diagnostic interpretation of structured scalp metrics produced by the local analyzer. It returns quality flags and cosmetic observation priorities, never medical findings, prescriptions, raw images, or cross-tenant data.", object({
    overall: scalpMetrics,
    zones: { type: "array", maxItems: 12, items: object({ zone: identifier, metrics: scalpMetrics }, ["zone", "metrics"]) },
    acquisition: scalpAcquisition,
    previous: object({ overall: scalpMetrics, acquisition: scalpAcquisition }),
    reported_warning_signals: { type: "array", maxItems: 5, uniqueItems: true, items: { type: "string", enum: ["sudden_change", "pain", "bleeding", "open_lesion", "infection_suspected"] } },
    professional_profile: { type: "string", enum: ["medical_study", "salon_trichology", "pharmacy_dermocosmetic"] },
    learning_context: object({ outcome_verified: { type: "boolean" }, human_reviewed: { type: "boolean" }, comparable_capture_count: { type: "integer", minimum: 0, maximum: 1000000 } }),
    locale: { type: "string", enum: ["it", "en"] },
    session_id: identifier,
  }, ["overall"]), ["core:read"], true, true, { examples: [{ overall: { density_index: 62, miniaturization_index: 28, redness_percent: 14, confidence: 0.88 }, locale: "it" }] }),
  tool("software_components", "Read software intelligence components", "Read the universal lightweight analyzer, optional worker state, evidence schema, versioned dynamic templates and supply-chain boundaries.", object(), ["core:read"]),
  tool("software_intelligence", "Analyze an authorized software artifact", "Use this when you need immediate, read-only static software intelligence for an artifact the caller owns, may inspect with written permission, or that is open source. The artifact is tenant-scoped, raw bytes are not persisted, and execution or patching requires a separate Core verdict.", object({
    artifact: softwareArtifact,
    authorization: softwareAuthorization,
    options: object({ strings_limit: { type: "integer", minimum: 1, maximum: 10_000 } }),
  }, ["artifact", "authorization"]), ["core:read"], true, true, { examples: [{ artifact: { name: "sample.bin", content_base64: "AAECAwQ=" }, authorization: { asserted: true, basis: "owned", purpose: "testing" } }] }),
  tool("software_authorize", "Authorize deep software analysis", "Ask Universal Core to issue a short-lived tenant- and mode-scoped authorization envelope after owner confirmation, memory recall, sandbox readiness and artifact authority checks.", object({
    owner_confirmed: { const: true }, external_side_effect: { const: false }, contains_customer_data: { const: false }, cross_tenant: { const: false }, sandbox_ready: { const: true }, audit_ready: { const: true },
    authorization_basis: { type: "string", enum: ["owned", "written_permission", "open_source"] },
    allowed_modes: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", enum: ["ghidra_headless", "frida_local_agent"] } },
    target_allowlist: { type: "array", maxItems: 100, items: { type: "string", maxLength: 240 } },
    memory_context: { type: "object", additionalProperties: true }
  }, ["owner_confirmed", "external_side_effect", "contains_customer_data", "cross_tenant", "sandbox_ready", "audit_ready", "authorization_basis", "allowed_modes"]), ["core:govern"], false, true),
  tool("software_job_submit", "Submit a governed software intelligence job", "Submit one tenant-scoped software analysis job. Deep Ghidra or Frida modes remain fail-closed without Core authorization, owner confirmation and target allowlisting; arbitrary Frida source is not accepted.", { type: "object", required: ["mode", "authorization"], properties: {
    mode: { type: "string", enum: ["lightweight_static", "ghidra_headless", "frida_local_agent"] },
    artifact: { type: "object", properties: { name: { type: "string", maxLength: 240 }, content_base64: { type: "string", maxLength: 8388608 } }, additionalProperties: false },
    authorization: softwareAuthorization,
    target: { type: "string", maxLength: 240 }, template_id: identifier,
    template_parameters: { type: "object", additionalProperties: { anyOf: [{ type: "string", maxLength: 240 }, { type: "integer" }, { type: "boolean" }] } },
    limits: { type: "object", properties: { cpu_seconds: { type: "integer", minimum: 1, maximum: 120 }, memory_megabytes: { type: "integer", minimum: 64, maximum: 2048 }, wall_time_seconds: { type: "integer", minimum: 1, maximum: 300 }, artifact_bytes: { type: "integer", minimum: 1, maximum: 6291456 }, output_bytes: { type: "integer", minimum: 1024, maximum: 8388608 } }, additionalProperties: false },
    core_governance: { type: "object", properties: {
      authorization_envelope: { type: "object", required: ["schema_version", "tenant_id", "issued_by", "authorized", "owner_confirmed", "allowed_modes", "issued_at", "expires_at"], properties: {
        schema_version: { const: "universal_software_authorization_v1" }, tenant_id: identifier, issued_by: { const: "universal_core" }, authorized: { const: true }, owner_confirmed: { const: true },
        allowed_modes: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", enum: ["ghidra_headless", "frida_local_agent"] } },
        target_allowlist: { type: "array", maxItems: 100, items: { type: "string", maxLength: 240 } }, issued_at: { type: "string", format: "date-time" }, expires_at: { type: "string", format: "date-time" }
      }, additionalProperties: false },
      signature: { type: "string", pattern: "^[a-fA-F0-9]{64}$" }
    }, required: ["authorization_envelope", "signature"], additionalProperties: false }
  }, additionalProperties: false }, ["core:govern"], false, true, { outputSchema: softwareEvidenceOutputSchema, examples: [{ mode: "lightweight_static", artifact: { name: "sample.bin", content_base64: "AAECAwQ=" }, authorization: { asserted: true, basis: "owned", purpose: "testing" } }] }),
  tool("software_job_list", "List software intelligence jobs", "List only the authenticated tenant's redacted software-analysis job records.", object(), ["core:read"]),
  tool("software_job_get", "Read a software intelligence job", "Read one redacted software-analysis job belonging to the authenticated tenant, including state, result error and universal_software_evidence_v1 evidence when complete.", object({ job_id: { type: "string", pattern: "^usij_[a-f0-9-]{36}$" } }, ["job_id"]), ["core:read"], true, true, { outputSchema: softwareEvidenceOutputSchema }),
  tool("software_job_status", "Read software job status and evidence", "Use this when polling a governed Ghidra, Frida or lightweight job. It is a compatible discovery alias for software_job_get and returns the same tenant-scoped state, result error and universal_software_evidence_v1 evidence.", object({ job_id: { type: "string", pattern: "^usij_[a-f0-9-]{36}$" } }, ["job_id"]), ["core:read"], true, true, { outputSchema: softwareEvidenceOutputSchema }),
  tool("software_evidence_get", "Read governed software evidence", "Use this after a software job completes to retrieve its redacted universal_software_evidence_v1 evidence. This is a compatible alias of software_job_get and never exposes raw artifact bytes.", object({ job_id: { type: "string", pattern: "^usij_[a-f0-9-]{36}$" } }, ["job_id"]), ["core:read"], true, true, { outputSchema: softwareEvidenceOutputSchema }),
  tool("software_correlate", "Correlate static and runtime evidence", "Correlate one completed Ghidra job with one completed Frida job for the authenticated tenant, marking reconstructed functions as static-only or runtime-confirmed for Nyra and Codex interpretation.", object({ job_ids: { type: "array", minItems: 2, maxItems: 2, items: { type: "string", pattern: "^usij_[a-f0-9-]{36}$" } } }, ["job_ids"]), ["core:read"]),
  tool("memory_context", "Read tenant AI context", "Read the authenticated tenant's current checkpoint, relevant memories, pending handoffs and recent redacted activity.", object({ ...memoryScopeProperties, activity_limit: { type: "integer", minimum: 1, maximum: 50 } }), ["core:read"]),
  tool("memory_search", "Search tenant AI memory", "Search durable, redacted memory belonging only to the authenticated tenant.", object(memoryScopeProperties), ["core:read"]),
  tool("memory_append", "Append tenant AI memory", "Store an explicit durable memory after Core governance, consent checks and secret redaction.", object({ kind: memoryKind, ...memoryProperties }, ["title", "summary"]), ["core:govern"], false, true),
  tool("memory_checkpoint", "Create tenant AI checkpoint", "Save a durable checkpoint so another AI can resume the authenticated tenant's work.", object(memoryProperties, ["summary"]), ["core:govern"], false, true),
  tool("memory_handoff", "Create tenant AI handoff", "Create a durable handoff for another AI inside the authenticated tenant.", object({ ...memoryProperties, to_agent_id: { anyOf: [identifier, { const: "all" }] } }, ["summary", "to_agent_id"]), ["core:govern"], false, true),
  tool("memory_handoff_acknowledge", "Acknowledge tenant AI handoff", "Acknowledge a handoff addressed to this AI inside the authenticated tenant.", object({ handoff_id: { type: "string", pattern: "^mem_[a-f0-9-]{36}$" }, agent_id: identifier }, ["handoff_id", "agent_id"]), ["core:govern"], false, true),
  tool("search", "Search tenant knowledge", "Use this when ChatGPT, Codex, company knowledge or deep research needs validated tenant documents and research evidence.", object({ query: text(500) }, ["query"]), ["core:read"], true, true, { outputSchema: searchOutputSchema }),
  tool("fetch", "Fetch tenant knowledge document", "Use this after search to read one tenant-scoped document or validated research source with a canonical citation URL.", object({ id: { type: "string", pattern: "^[a-f0-9]{24}$" } }, ["id"]), ["core:read"], true, true, { outputSchema: fetchOutputSchema }),
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

  tool("agent_heartbeat", "Register agent heartbeat", "Register or refresh an agent identity inside the authenticated tenant.", object({ agent_id: identifier, display_name: { type: "string", maxLength: 120 }, capabilities: { type: "array", maxItems: 20, items: identifier } }, ["agent_id"]), ["core:govern"], false, true),
  tool("agent_list", "List tenant agents", "List registered agents and their last heartbeat in the authenticated tenant.", object(), ["core:read"]),
  tool("message_post", "Post agent message", "Post a tenant-scoped message from a registered agent to another agent or all agents.", object({ from_agent_id: identifier, to_agent_id: { anyOf: [identifier, { const: "all" }] }, body: text(20_000), thread_id: { type: "string", maxLength: 80 }, idempotency_key: { type: "string", maxLength: 120 } }, ["from_agent_id", "body"]), ["core:govern"], false, true),
  tool("message_inbox", "Read agent inbox", "Read tenant-scoped messages addressed to one agent or all agents.", object({ agent_id: identifier, unread_only: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["agent_id"]), ["core:read"]),
  tool("message_acknowledge", "Acknowledge agent message", "Mark one tenant-scoped agent message as read.", object({ message_id: text(80), agent_id: identifier }, ["message_id", "agent_id"]), ["core:govern"], false, true)
];
