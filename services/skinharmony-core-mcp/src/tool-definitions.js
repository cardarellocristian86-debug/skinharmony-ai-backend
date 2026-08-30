import { NYRA_DIALOGUE_WIDGET_URI } from "./nyra-operating-dialogue-widget.js";
import { WORK_CONTINUITY_TOOLS } from "./work-continuity-tools.js";

function annotations(readOnly, idempotent = false, openWorld = false, destructive = false) {
  return { readOnlyHint: readOnly, destructiveHint: destructive, openWorldHint: openWorld, idempotentHint: idempotent };
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
  const ownerConfirmationRequired = !readOnly && options.ownerConfirmationRequired !== false;
  const schema = inputSchema?.type === "object" && options.exactInputSchema !== true
    ? {
        ...inputSchema,
        properties: {
          ...inputSchema.properties,
          ...agentPresenceProperties,
          ...(ownerConfirmationRequired ? ownerConfirmationProperties : {}),
        },
        required: inputSchema.required || [],
      }
    : inputSchema;
  const meta = {
    ...(options.meta || {}),
    ...(!readOnly ? { "skinharmony/ownerConfirmationRequired": ownerConfirmationRequired } : {}),
  };
  return {
    name,
    title,
    description,
    inputSchema: schema,
    ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
    scopes,
    annotations: annotations(readOnly, idempotent, options.openWorld === true, options.destructive === true),
    ...(Object.keys(meta).length ? { _meta: meta } : {}),
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
const runtimeEvidenceState = object({
  high_impact: {
    type: "boolean",
    description: "Escalation-only evidence hint. The server derives the effective value; it cannot authorize execution or suppress V0.",
  },
});
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
  work_preflight: { type: "object" },
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
const researchDistillationEvidence = object({
  source_id: identifier,
  canonical_url: { type: "string", format: "uri", maxLength: 2_048 },
  title: text(500),
  published_at: { type: "string", format: "date-time" },
  claim_summary: text(2_000),
  support_direction: { type: "string", enum: ["support", "contradict", "neutral"] },
  citation: { type: "string", maxLength: 1_000 },
}, ["source_id", "canonical_url", "title", "claim_summary"]);
const researchDistillationEnvelopeProperties = {
  request_id: identifier,
  question: text(2_000),
  branch_ids: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: identifier },
  allowed_source_ids: { type: "array", maxItems: 50, uniqueItems: true, items: identifier },
  max_documents: { type: "integer", minimum: 1, maximum: 100 },
  max_bytes: { type: "integer", minimum: 1, maximum: 5_000_000 },
  max_duration_ms: { type: "integer", minimum: 1_000, maximum: 300_000 },
  max_cost: { type: "number", minimum: 0, maximum: 100 },
  retention_mode: { type: "string", enum: ["ephemeral", "candidate", "review_required"] },
};
const researchAirlockWorkBinding = object({
  project_id: identifier,
  work_id: identifier,
  session_id: identifier,
}, ["project_id", "work_id", "session_id"]);
const nyraDeepV2RequestId = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  pattern: "^[a-zA-Z0-9_.:-]+$",
};
const nyraDeepV2EvidenceRef = {
  type: "string",
  pattern: "^[a-f0-9]{64}$",
};
const nyraDeepV2Source = object({
  id: identifier,
  registry_source_id: identifier,
  url: { type: "string", format: "uri", maxLength: 2_048 },
  title: text(500),
  source_type: sourceType,
  excerpt: { type: "string", minLength: 16, maxLength: 1_200 },
  published_at: { type: "string", format: "date-time" },
}, ["id", "registry_source_id", "url", "title", "source_type", "excerpt"]);
const nyraDeepV2Claim = object({
  id: identifier,
  kind: { type: "string", enum: ["fact", "inference", "hypothesis"] },
  text: text(2_000),
  facts: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: text(2_000) },
  claim_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
  semantic_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
  content_tag: { type: "string", pattern: "^[a-z][a-z0-9_]{1,159}$" },
  capability_spec_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
  source_ids: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: identifier },
  confidence: probability,
}, [
  "id",
  "kind",
  "text",
  "facts",
  "claim_hash",
  "semantic_hash",
  "content_tag",
  "capability_spec_hash",
  "source_ids",
]);
const nyraDeepV2EvidencePack = object({
  research_question: text(2_000),
  sources: { type: "array", minItems: 1, maxItems: 20, items: nyraDeepV2Source },
  claims: { type: "array", minItems: 1, maxItems: 30, items: nyraDeepV2Claim },
}, ["sources", "claims"]);
const nyraDeepV2RequirementBinding = object({
  id: identifier,
  requirement_ref: { type: "string", pattern: "^req_[a-f0-9]{64}$" },
  source_ids: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: identifier },
  claim_ids: { type: "array", minItems: 1, maxItems: 30, uniqueItems: true, items: identifier },
}, ["id", "requirement_ref", "source_ids", "claim_ids"]);
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
const dttReference = { type: "string", minLength: 1, maxLength: 160, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]*$" };
const dttWorkId = { type: "string", format: "uuid" };
const dttNodeInput = object({
  node_id: dttReference,
  kind: { type: "string", enum: ["analysis", "research", "decision", "agent", "ai_model", "tool", "human_gate", "verification", "join", "rollback"] },
  task: text(4_000),
  parent_node_id: dttReference,
  dependencies: { type: "array", maxItems: 30, uniqueItems: true, items: dttReference },
  fallback_node_id: dttReference,
  depth: { type: "integer", minimum: 0, maximum: 16 },
  retry_policy: object({ max_attempts: { type: "integer", minimum: 0, maximum: 10 } }),
  budget: object({
    estimated_tokens: { type: "integer", minimum: 0, maximum: 2_000_000 },
    estimated_cost_micros: { type: "integer", minimum: 0, maximum: 1_000_000_000 },
    estimated_time_ms: { type: "integer", minimum: 0, maximum: 3_600_000 },
  }),
  verification_policy: object({
    required_approvals: { type: "integer", minimum: 2, maximum: 64 },
    allowed_verifier_ids: {
      type: "array",
      minItems: 2,
      maxItems: 64,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 160 },
    },
  }, ["required_approvals", "allowed_verifier_ids"]),
}, ["node_id", "kind", "task"]);
const dttEvidenceInput = object({
  schema_version: { const: "verification_evidence_contract_v2" },
  tenant_id: { type: "string", minLength: 1, maxLength: 120 },
  work_id: dttWorkId,
  tree_id: dttReference,
  node_id: dttReference,
  claim: text(4_000),
  artifacts: {
    type: "array",
    minItems: 1,
    maxItems: 128,
    items: object({
      artifact_id: { type: "string", minLength: 1, maxLength: 160 },
      content_digest: { type: "string", minLength: 1, maxLength: 256 },
      source_reference: text(1_000),
      registry_verified: { type: "boolean" },
      registry_id: { anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }] },
    }, ["artifact_id", "content_digest", "source_reference"]),
  },
  provenance: object({
    tenant_id: { type: "string", minLength: 1, maxLength: 120 },
    work_id: dttWorkId,
    tree_id: dttReference,
    node_id: dttReference,
    producer_id: { type: "string", minLength: 1, maxLength: 160 },
    source_type: { type: "string", minLength: 1, maxLength: 120 },
    source_reference: text(1_000),
  }, ["tenant_id", "work_id", "tree_id", "node_id", "producer_id", "source_type", "source_reference"]),
  evidence_digest: { type: "string", pattern: "^evd_[a-f0-9]{64}$" },
  attestations: {
    type: "array",
    minItems: 1,
    maxItems: 64,
    items: object({
      verifier_id: { type: "string", minLength: 1, maxLength: 160 },
      decision: { type: "string", enum: ["approve", "dissent"] },
      rationale: text(1_000),
      identity_receipt: text(4_000),
      assignment_id: { type: "string", pattern: "^dtta_[a-f0-9]{32}$" },
      attestation_id: { type: "string", pattern: "^att_[a-f0-9]{64}$" },
      scheme: { const: "sha256_work_bound_vote_integrity_v2" },
      identity_verified: { type: "boolean" },
      independence_key: { anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }] },
    }, ["verifier_id", "decision", "rationale", "identity_receipt", "assignment_id", "attestation_id", "scheme"]),
  },
  quorum: object({
    required_approvals: { type: "integer", minimum: 1, maximum: 64 },
    dissent_policy: { const: "block" },
    approvals: { type: "integer", minimum: 0, maximum: 64 },
    dissents: { type: "integer", minimum: 0, maximum: 64 },
    satisfied: { type: "boolean" },
  }, ["required_approvals", "dissent_policy"]),
  identity_verification: object({
    mode: { const: "core_server_side_receipt_resolver" },
    verified_identities: { type: "integer", minimum: 0, maximum: 64 },
    required_identities: { type: "integer", minimum: 0, maximum: 64 },
    satisfied: { type: "boolean" },
  }, ["mode", "verified_identities", "required_identities", "satisfied"]),
  contract_satisfied: { type: "boolean" },
  execution_authorized: { const: false },
}, [
  "schema_version",
  "tenant_id",
  "work_id",
  "tree_id",
  "node_id",
  "claim",
  "artifacts",
  "provenance",
  "evidence_digest",
  "attestations",
  "quorum",
  "execution_authorized",
]);
const dttEvidenceDraftInput = object({
  schema_version: { const: "verification_evidence_draft_v2" },
  tenant_id: { type: "string", minLength: 1, maxLength: 120 },
  work_id: dttWorkId,
  tree_id: dttReference,
  node_id: dttReference,
  claim: text(4_000),
  artifacts: dttEvidenceInput.properties.artifacts,
  provenance: dttEvidenceInput.properties.provenance,
  evidence_digest: { type: "string", pattern: "^evd_[a-f0-9]{64}$" },
  quorum: object({
    required_approvals: { type: "integer", minimum: 1, maximum: 64 },
    dissent_policy: { const: "block" },
  }, ["required_approvals", "dissent_policy"]),
  execution_authorized: { const: false },
}, [
  "schema_version", "tenant_id", "work_id", "tree_id", "node_id", "claim", "artifacts",
  "provenance", "evidence_digest", "quorum", "execution_authorized",
]);
const dttVoteInput = object({
  verifier_id: { type: "string", minLength: 1, maxLength: 160 },
  decision: { type: "string", enum: ["approve", "dissent"] },
  rationale: text(1_000),
  identity_receipt: text(4_000),
  assignment_id: { type: "string", minLength: 1, maxLength: 160 },
}, ["verifier_id", "decision", "rationale", "identity_receipt", "assignment_id"]);

const boundedJsonValue = {
  anyOf: [
    { type: "string", maxLength: 20_000 },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
    { type: "array", maxItems: 500, items: { anyOf: [
      { type: "string", maxLength: 20_000 },
      { type: "number" },
      { type: "boolean" },
      { type: "null" },
    ] } },
    { type: "object", maxProperties: 500, additionalProperties: {
      anyOf: [
        { type: "string", maxLength: 20_000 },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
      ],
    } },
  ],
};
const semanticCandidate = object({
  id: { type: "string", minLength: 1, maxLength: 160 },
  text: text(8_000),
  label: { type: "string", maxLength: 500 },
  locale: { type: "string", maxLength: 64 },
  metadata: { type: "object", maxProperties: 50, additionalProperties: boundedJsonValue },
}, ["id", "text"]);
const entityGraphEntity = object({
  id: identifier,
  entity_type: identifier,
  label: text(500),
  risk_band: { type: "string", enum: ["none", "low", "medium", "high", "critical"] },
  attributes: { type: "object", maxProperties: 100, additionalProperties: boundedJsonValue },
}, ["id", "entity_type"]);
const entityGraphRelation = object({
  id: identifier,
  from: identifier,
  to: identifier,
  relation_type: identifier,
  attributes: { type: "object", maxProperties: 100, additionalProperties: boundedJsonValue },
}, ["id", "from", "to", "relation_type"]);

const policyRegistryUuid = {
  type: "string",
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
};
const policyRegistryOperationId = {
  type: "string",
  minLength: 3,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$",
};
const policyRegistryDomainPackId = {
  type: "string",
  minLength: 3,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$",
};
const policyRegistrySha256 = { type: "string", pattern: "^[a-f0-9]{64}$" };
const policyRegistryPackId = {
  type: "string",
  minLength: 2,
  maxLength: 160,
  pattern: "^[a-z0-9][a-z0-9._/-]{1,159}$",
};
const policyRegistryPackVersion = {
  type: "string",
  minLength: 5,
  maxLength: 64,
  pattern: "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$",
};
const policyRegistryPackReferenceId = {
  type: "string",
  minLength: 8,
  maxLength: 225,
  pattern: "^[a-z0-9][a-z0-9._/-]{1,159}@\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$",
};
const policyRegistryPlainJson = {
  type: ["object", "array", "string", "number", "boolean", "null"],
};
const policyRegistryStringList = {
  type: "array",
  maxItems: 4_096,
  uniqueItems: true,
  items: { type: "string", minLength: 1, maxLength: 200 },
};
const policyRegistryPackReference = object({
  pack_id: policyRegistryPackId,
  version: policyRegistryPackVersion,
  digest: policyRegistrySha256,
}, ["pack_id", "version", "digest"]);
const policyRegistrySnapshot = object({
  schema_version: { const: "nyra_policy_registry_v1" },
  tenant_id: { type: "string", minLength: 1, maxLength: 120 },
  domain_pack_id: policyRegistryDomainPackId,
  ancestry: {
    type: "array",
    minItems: 1,
    maxItems: 4_096,
    items: object({
      ...policyRegistryPackReference.properties,
      scope: object({
        kind: { type: "string", enum: ["core", "global", "sector", "tenant", "environment", "work_type", "action", "policy"] },
        value: { type: "string", minLength: 1, maxLength: 160 },
        tenant_id: { type: ["string", "null"], maxLength: 120 },
      }, ["kind", "value", "tenant_id"]),
    }, ["pack_id", "version", "digest", "scope"]),
  },
  leaf_packs: { type: "array", minItems: 1, maxItems: 4_096, items: policyRegistryPackReference },
  policy: object({
    allow_actions: policyRegistryStringList,
    deny_actions: policyRegistryStringList,
    required_gates: policyRegistryStringList,
    constraints: { type: "object", maxProperties: 500, additionalProperties: true },
  }, ["allow_actions", "deny_actions", "required_gates", "constraints"]),
  bindings: object({
    core_branch_ids: policyRegistryStringList,
    nyra_branch_ids: policyRegistryStringList,
    domain_pack_ids: policyRegistryStringList,
  }, ["core_branch_ids", "nyra_branch_ids", "domain_pack_ids"]),
  sources: policyRegistryStringList,
  validity: object({
    valid_from: { type: "string", minLength: 20, maxLength: 40 },
    expires_at: { type: "string", minLength: 20, maxLength: 40 },
  }, ["valid_from", "expires_at"]),
  resolution: object({
    logical_depth: { type: "integer", minimum: 1, maximum: 4_096 },
    traversal_budget: { type: "integer", minimum: 1, maximum: 4_096 },
    traversed: { type: "integer", minimum: 1, maximum: 4_096 },
    catalog_depth_policy: { const: "no_static_ceiling" },
    runtime_policy: { const: "bounded_fail_closed" },
  }, ["logical_depth", "traversal_budget", "traversed", "catalog_depth_policy", "runtime_policy"]),
  immutable: { const: true },
  snapshot_digest: policyRegistrySha256,
}, [
  "schema_version", "tenant_id", "domain_pack_id", "ancestry", "leaf_packs", "policy",
  "bindings", "sources", "validity", "resolution", "immutable", "snapshot_digest",
]);
const policyRegistryOwnerProperties = {
  owner_confirmed: { type: "boolean", const: true },
  confirmation_reference: {
    type: "string",
    minLength: 1,
    maxLength: 240,
    description: "Opaque audit reference for the explicit owner confirmation; never include secrets.",
  },
};
const policyRegistryCompilerBindingList = {
  type: "array",
  minItems: 1,
  maxItems: 256,
  uniqueItems: true,
  items: { type: "string", minLength: 1, maxLength: 200 },
};
const policyRegistryCompilerPack = object({
  schema_version: { const: "nyra_policy_pack_v1" },
  pack_id: policyRegistryPackId,
  version: policyRegistryPackVersion,
  status: { const: "active" },
  scope: object({
    kind: { type: "string", enum: ["core", "global", "sector", "tenant", "environment", "work_type", "action", "policy"] },
    value: { type: "string", minLength: 1, maxLength: 160 },
    tenant_id: { type: ["string", "null"], maxLength: 120 },
  }, ["kind", "value", "tenant_id"]),
  parent_refs: {
    type: "array",
    maxItems: 8,
    items: policyRegistryPackReference,
  },
  bindings: object({
    core_branch_ids: policyRegistryCompilerBindingList,
    nyra_branch_ids: policyRegistryCompilerBindingList,
    domain_pack_ids: policyRegistryCompilerBindingList,
  }, ["core_branch_ids", "nyra_branch_ids", "domain_pack_ids"]),
  privacy: object({
    raw_customer_data_allowed: { const: false },
    data_classification: { type: "string", minLength: 1, maxLength: 80 },
  }, ["raw_customer_data_allowed", "data_classification"]),
  policy: object({
    allow_mode: { type: "string", enum: ["inherit", "restrict"] },
    allow_actions: policyRegistryStringList,
    deny_actions: policyRegistryStringList,
    required_gates: policyRegistryStringList,
    constraints: { type: "object", maxProperties: 4_096, additionalProperties: true },
  }, ["allow_mode", "allow_actions", "deny_actions", "required_gates", "constraints"]),
  tests: { type: "array", minItems: 2, maxItems: 32, items: policyRegistryPlainJson },
  sources: {
    type: "array",
    minItems: 1,
    maxItems: 16,
    items: object({
      source_id: policyRegistryPackId,
      url: { type: "string", minLength: 8, maxLength: 2_000, pattern: "^https://" },
      claim: { type: "string", minLength: 1, maxLength: 1_200 },
      reviewed_at: { type: "string", minLength: 1, maxLength: 32 },
    }, ["source_id", "url", "claim", "reviewed_at"]),
  },
  freshness_sla_days: { type: "integer", minimum: 1, maximum: 3_650 },
  provenance: policyRegistryPlainJson,
  valid_from: { type: "string", minLength: 20, maxLength: 64 },
  expires_at: { type: "string", minLength: 20, maxLength: 64 },
  rollback_to: policyRegistryPlainJson,
  compatibility: policyRegistryPlainJson,
  trust_mode: { type: "string", enum: ["compiled_core", "signed_bundle"] },
  signatures: {
    type: "array",
    maxItems: 4,
    items: object({
      issuer_id: policyRegistryPackId,
      algorithm: { const: "Ed25519" },
      signature: { type: "string", minLength: 86, maxLength: 86, pattern: "^[A-Za-z0-9_-]{86}$" },
    }, ["issuer_id", "algorithm", "signature"]),
  },
  artifact_digest: policyRegistrySha256,
}, [
  "schema_version", "pack_id", "version", "status", "scope", "parent_refs", "bindings",
  "privacy", "policy", "tests", "sources", "freshness_sla_days", "provenance",
  "valid_from", "expires_at", "rollback_to", "compatibility", "trust_mode", "signatures",
  "artifact_digest",
]);
const policyRegistryCompilerInput = object({
  schema_version: { const: "nyra_policy_compiler_input_v1" },
  leaf_pack_ids: {
    type: "array",
    minItems: 1,
    maxItems: 16,
    uniqueItems: true,
    items: policyRegistryPackReferenceId,
  },
  packs: {
    type: "array",
    minItems: 1,
    maxItems: 64,
    items: policyRegistryCompilerPack,
  },
}, ["schema_version", "leaf_pack_ids", "packs"]);
const policyRegistryToolOptions = {
  exactInputSchema: true,
  ownerConfirmationRequired: true,
  destructive: true,
  meta: {
    "skinharmony/dedicatedCoreGate": true,
    "skinharmony/externalSideEffect": false,
    "skinharmony/providerExecution": false,
  },
};

const nyraConverseNullableText = (maxLength) => ({
  type: ["string", "null"],
  maxLength,
});
const nyraConverseSignalList = {
  type: "array",
  maxItems: 8,
  uniqueItems: true,
  items: { type: "string", minLength: 1, maxLength: 240 },
};
const nyraConverseActionCategory = {
  type: "string",
  enum: ["release", "communication", "destructive", "financial", "scheduling", "access"],
};
const nyraDirectiveCode = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$" };
const nyraDirectiveDigest = { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" };
const nyraDirectiveActionClass = {
  type: "string",
  enum: [
    "NONE", "WORKSPACE_CHANGE", "GIT_COMMIT", "GIT_PUSH", "PULL_REQUEST_OPEN", "GIT_MERGE",
    "DEPLOY", "PUBLISH", "WORK_BOOTSTRAP", "EXTERNAL_MUTATION", "TICKET_RESERVE",
  ],
};
const nyraDirectiveBinding = object({
  tenant_id: { type: "string", minLength: 1, maxLength: 160 },
  work_id: nyraConverseNullableText(80),
  project_id: nyraConverseNullableText(80),
  work_revision: { type: ["integer", "null"], minimum: 1, maximum: 100_000 },
  intent_digest: nyraDirectiveDigest,
  context_digest: nyraDirectiveDigest,
}, ["tenant_id", "work_id", "project_id", "work_revision", "intent_digest", "context_digest"]);
const nyraGovernedContinuationSchema = object({
  schema_version: { const: "nyra_continuation_ref_v1" },
  available: { type: "boolean" },
  continuation_ref: { type: ["string", "null"], pattern: "^nyc1_[A-Za-z0-9_-]{32,80}$" },
  expires_at: { type: ["string", "null"], format: "date-time" },
  state: { type: "string", enum: ["READY", "CONSUMED", "UNAVAILABLE"] },
  reason: { type: ["string", "null"], maxLength: 160 },
}, [
  "schema_version", "available", "continuation_ref", "expires_at", "state", "reason",
]);
const nyraActionContinuationOperation = {
  type: "string",
  enum: ["issue_delegation", "authorize_action"],
};
const nyraContinueSha256 = { type: "string", pattern: "^[a-f0-9]{64}$" };
function nyraContinuationRequestSchema(toolName, { omit = [] } = {}) {
  const source = WORK_CONTINUITY_TOOLS.find((tool) => tool.name === toolName)?.inputSchema;
  if (!source || source.type !== "object") {
    throw new Error(`nyra_continuation_request_schema_missing:${toolName}`);
  }
  const omitted = new Set([
    "agent_id",
    "client_type",
    "idempotency_key",
    "owner_confirmed",
    "confirmation_reference",
    ...omit,
  ]);
  return {
    ...source,
    properties: Object.fromEntries(Object.entries(source.properties || {})
      .filter(([key]) => !omitted.has(key))),
    required: (source.required || []).filter((key) => !omitted.has(key)),
    additionalProperties: false,
  };
}
const nyraContinueResumeRequest = nyraContinuationRequestSchema(
  "work_continuity_resume",
);
const nyraContinueNativePlanRequest = nyraContinuationRequestSchema(
  "work_continuity_native_plan",
  { omit: ["session_id"] },
);
const nyraContinueNativeBindRequest = nyraContinuationRequestSchema(
  "work_continuity_native_bind",
  { omit: ["session_id"] },
);
const nyraContinueHostKind = { type: "string", pattern: "^[a-z][a-z0-9_]{1,62}_native$" };
const nyraContinueRepository = {
  type: "string",
  pattern: "^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$",
};
const nyraContinueBranch = { type: "string", minLength: 1, maxLength: 240 };
const nyraContinueActionKind = {
  type: "string",
  enum: [
    "git.push.branch", "git.push.protected", "github.draft_pr", "github.ready",
    "github.merge", "github.release", "render.deploy", "render.promote",
  ],
};
const nyraContinueDelegationRequest = object({
  work_id: { type: "string", format: "uuid" },
  intent_anchor_digest: nyraContinueSha256,
  repository: nyraContinueRepository,
  audience: {
    type: "array", minItems: 1, maxItems: 1, uniqueItems: true,
    items: nyraContinueHostKind,
  },
  allowed_branches: {
    type: "array", minItems: 1, maxItems: 32, uniqueItems: true,
    items: nyraContinueBranch,
  },
  protected_branches: {
    type: "array", maxItems: 16, uniqueItems: true,
    items: nyraContinueBranch,
  },
  allowed_path_prefixes: {
    type: "array", minItems: 1, maxItems: 128, uniqueItems: true,
    items: { type: "string", minLength: 1, maxLength: 500 },
  },
  allowed_actions: {
    type: "array", minItems: 1, maxItems: 8, uniqueItems: true,
    items: nyraContinueActionKind,
  },
  budget: {
    type: "object",
    additionalProperties: false,
    properties: {
      max_agents: { type: "integer", minimum: 1, maximum: 3 },
      max_parallel: { type: "integer", minimum: 1, maximum: 2 },
      max_commits: { type: "integer", minimum: 0, maximum: 100 },
      max_pushes: { type: "integer", minimum: 0, maximum: 100 },
      max_deploys: { type: "integer", minimum: 0, maximum: 100 },
      max_total_actions: { type: "integer", minimum: 1, maximum: 1_000 },
    },
  },
  release_policy: {
    type: "object",
    additionalProperties: false,
    properties: {
      manifest_required_for_protected_push: { type: "boolean" },
      manifest_required_for_induced_deploy: { type: "boolean" },
      manifest_required_for_deploy: { type: "boolean" },
      independent_verifier_required: { type: "boolean" },
      rollback_required: { type: "boolean" },
      required_checks: {
        type: "array", maxItems: 100, uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 240 },
      },
    },
  },
  ttl_seconds: { type: "integer", minimum: 60, maximum: 43_200 },
}, [
  "work_id", "intent_anchor_digest", "repository", "audience", "allowed_branches",
  "allowed_path_prefixes", "allowed_actions", "ttl_seconds",
]);
const nyraContinueActionRequest = object({
  delegation_id: { type: "string", pattern: "^hnd_[A-Za-z0-9._-]{8,160}$" },
  work_id: { type: "string", format: "uuid" },
  intent_anchor_digest: nyraContinueSha256,
  repository: nyraContinueRepository,
  action: { type: "object", minProperties: 1, maxProperties: 40, additionalProperties: true },
  evidence_digest: nyraContinueSha256,
  release_manifest: { type: "object", maxProperties: 40, additionalProperties: true },
  predecessor_ticket_id: { type: "string", pattern: "^hnt_[A-Za-z0-9-]{8,160}$" },
}, [
  "delegation_id", "work_id", "intent_anchor_digest", "repository", "action",
  "evidence_digest",
]);
const nyraWorkBootstrapSpec = object({
  request_id: { type: "string", minLength: 2, maxLength: 160, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,159}$" },
  work_name: { type: "string", minLength: 1, maxLength: 1_000 },
  work_type: {
    type: "string",
    enum: [
      "software_git", "software_non_git", "deployment", "research", "document",
      "commercial_crm", "hardware", "generic",
    ],
  },
  idea: { type: "string", minLength: 1, maxLength: 8_000 },
  objective: { type: "string", minLength: 1, maxLength: 8_000 },
  architecture: { type: "object", maxProperties: 250, additionalProperties: true },
  next_action: { type: "string", minLength: 1, maxLength: 4_000 },
  acceptance_criteria: {
    type: "array", minItems: 1, maxItems: 250, uniqueItems: true,
    items: { type: "string", minLength: 1, maxLength: 2_000 },
  },
  constraints: {
    type: "array", maxItems: 100, uniqueItems: true,
    items: { type: "string", minLength: 1, maxLength: 1_000 },
  },
  tasks: {
    type: "array", minItems: 1, maxItems: 250,
    items: object({
      title: { type: "string", minLength: 1, maxLength: 2_000 },
      weight: { type: "integer", minimum: 1, maximum: 10_000 },
      required: { type: "boolean" },
    }, ["title"]),
  },
}, [
  "request_id", "work_name", "work_type", "idea", "objective", "architecture",
  "next_action", "acceptance_criteria", "tasks",
]);
const nyraOrchestrationDirectiveSchema = object({
  schema_version: { const: "nyra_orchestration_directive_v1" },
  directive_id: { type: "string", pattern: "^nyra_dir_[a-f0-9]{24}$" },
  request_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  source: { type: "string", enum: ["PERSISTED_WORK", "FRESH_CORE", "LEGACY_CONNECTOR_HINT"] },
  problem: {
    anyOf: [
      { type: "null" },
      object({
        kind: {
          type: "string",
          enum: ["RESUME", "TECHNICAL_REQUEST", "CONSEQUENTIAL_REQUEST", "WORK_BINDING", "WORK_BOOTSTRAP", "CORE_BLOCK", "MANUAL_MERGE"],
        },
        code: nyraDirectiveCode,
        summary: { type: "string", minLength: 1, maxLength: 500 },
        capability_hint: nyraConverseNullableText(64),
      }, ["kind", "code", "summary", "capability_hint"]),
    ],
  },
  core_diagnostics: object({
    state: { type: "string", enum: ["READY", "CONFIRMATION_REQUIRED", "BLOCKED"] },
    guard_mode: { type: "string", enum: ["normal", "confirmation_required"] },
    causes: {
      type: "array",
      maxItems: 8,
      items: object({
        code: nyraDirectiveCode,
        component: { type: "string", enum: ["UNIVERSAL_CORE", "OWNER"] },
        state: { type: "string", enum: ["GUARDED", "CONFIRMATION_REQUIRED", "BLOCKED"] },
        remediation: { type: "string", minLength: 1, maxLength: 500 },
      }, ["code", "component", "state", "remediation"]),
    },
  }, ["state", "guard_mode", "causes"]),
  needs: {
    type: "array",
    maxItems: 8,
    items: object({
      code: nyraDirectiveCode,
      kind: { type: "string", enum: ["CONTEXT", "EVIDENCE", "CONFIRMATION", "AUTHORITY", "CAPABILITY", "MANUAL_ACTION"] },
      state: { type: "string", enum: ["REQUIRED", "MISSING", "STALE", "BLOCKED"] },
      authority: { type: "string", enum: ["WORK_CONTINUITY", "NYRA", "UNIVERSAL_CORE", "HOST", "OWNER"] },
      detail: { type: "string", minLength: 1, maxLength: 500 },
      source_digest: nyraDirectiveDigest,
    }, ["code", "kind", "state", "authority", "detail", "source_digest"]),
  },
  next_actions: {
    type: "array",
    maxItems: 8,
    items: object({
      order: { type: "integer", minimum: 1, maximum: 8 },
      actor: { type: "string", enum: ["NYRA", "CODEX", "UNIVERSAL_CORE", "HOST", "OWNER"] },
      stage: { type: "string", enum: ["CONTEXT", "REASONING", "AUTHORITY", "EXECUTION", "EVIDENCE"] },
      code: nyraDirectiveCode,
      summary: { type: "string", minLength: 1, maxLength: 500 },
      mode: { type: "string", enum: ["READ_ONLY", "BOUNDED_WORKSPACE", "PROPOSAL_ONLY", "CORE_GOVERNED", "MANUAL"] },
      status: { type: "string", enum: ["READY", "WAITING_ON_NEED", "HELD", "MANUAL"] },
      requires: { type: "array", maxItems: 8, uniqueItems: true, items: nyraDirectiveCode },
      external_side_effect: { type: "boolean" },
    }, ["order", "actor", "stage", "code", "summary", "mode", "status", "requires", "external_side_effect"]),
  },
  decision: object({
    disposition: {
      type: "string",
      enum: [
        "RESUME", "PROCEED_READ_ONLY", "PREPARE_BOUNDED_WORK", "REQUEST_CORE_TICKET",
        "REQUEST_WORK_BOOTSTRAP", "MANUAL_HANDOFF", "HOLD", "BLOCK", "INSUFFICIENT_CONTEXT", "COMPLETE",
      ],
    },
    recommendation_authority: { const: "NYRA" },
    final_authority: { const: "UNIVERSAL_CORE" },
    core_verdict: { type: "string", enum: ["NOT_APPLICABLE", "NOT_REQUESTED", "HOLD", "BLOCK", "INSUFFICIENT_CONTEXT"] },
    reason_codes: { type: "array", maxItems: 16, uniqueItems: true, items: nyraDirectiveCode },
    execution_authorized: { const: false },
    external_action_authorized: { const: false },
  }, [
    "disposition", "recommendation_authority", "final_authority", "core_verdict",
    "reason_codes", "execution_authorized", "external_action_authorized",
  ]),
  work_context: object({
    available: { type: "boolean" },
    work_id: nyraConverseNullableText(80),
    project_id: nyraConverseNullableText(80),
    work_revision: { type: ["integer", "null"], minimum: 1, maximum: 100_000 },
    intent_digest: nyraDirectiveDigest,
    context_digest: nyraDirectiveDigest,
    status: nyraConverseNullableText(24),
    acceptance_criteria_count: { type: "integer", minimum: 0, maximum: 250 },
    required_task_count: { type: "integer", minimum: 0, maximum: 64 },
    pending_required_task_count: { type: "integer", minimum: 0, maximum: 64 },
    required_evidence_count: { type: "integer", minimum: 0, maximum: 128 },
    unverified_required_evidence_count: { type: "integer", minimum: 0, maximum: 128 },
    next_required_task: {
      anyOf: [
        { type: "null" },
        object({
          task_id: { type: "string", format: "uuid" },
          title: { type: "string", minLength: 1, maxLength: 500 },
          status: { type: "string", enum: ["planned", "completed"] },
          acceptance_verified: { type: "boolean" },
        }, ["task_id", "title", "status", "acceptance_verified"]),
      ],
    },
    closure_verified: { type: "boolean" },
  }, [
    "available", "work_id", "project_id", "work_revision", "intent_digest", "context_digest",
    "status", "acceptance_criteria_count", "required_task_count", "pending_required_task_count",
    "required_evidence_count", "unverified_required_evidence_count", "next_required_task", "closure_verified",
  ]),
  permitted_progress: {
    type: "array",
    maxItems: 5,
    uniqueItems: true,
    items: {
      type: "string",
      enum: ["DISAMBIGUATION", "WORK_BOOTSTRAP_REVIEW", "READ_ONLY", "ANALYSIS", "EVIDENCE", "BOUNDED_WORKSPACE", "PROPOSAL"],
    },
  },
  can_continue: { type: "boolean" },
  ticket_request: object({
    schema_version: { const: "core_ticket_request_candidate_v1" },
    required: { type: "boolean" },
    state: { type: "string", enum: ["NOT_REQUIRED", "NEEDS_CONTEXT", "WORK_BOOTSTRAP_READY", "READY_FOR_CORE_REVIEW", "AWAITING_CORE", "BLOCKED", "MANUAL_ONLY"] },
    action_class: nyraDirectiveActionClass,
    capability_hint: nyraConverseNullableText(64),
    capability_resolution: { type: "string", enum: ["NOT_REQUIRED", "SERVER_SIDE_REQUIRED", "SERVER_SIDE_RESOLVED"] },
    binding: nyraDirectiveBinding,
    prerequisite_codes: { type: "array", maxItems: 32, uniqueItems: true, items: nyraDirectiveCode },
    owner_confirmation_required: { type: "boolean" },
    host_approval_required: { type: "boolean" },
    core_independent_verification_required: { const: true },
    merge_policy: { type: "string", enum: ["NOT_APPLICABLE", "MANUAL_ONLY"] },
    work_bootstrap_request_digest: nyraDirectiveDigest,
    request_digest: nyraDirectiveDigest,
    ticket_id: { type: "null" },
    ticket_issued: { const: false },
    execution_authorized: { const: false },
    continuation: nyraGovernedContinuationSchema,
  }, [
    "schema_version", "required", "state", "action_class", "capability_hint", "capability_resolution",
    "binding", "prerequisite_codes", "owner_confirmation_required", "host_approval_required",
    "core_independent_verification_required", "merge_policy", "work_bootstrap_request_digest", "request_digest", "ticket_id",
    "ticket_issued", "execution_authorized", "continuation",
  ]),
  execution_authorized: { const: false },
}, [
  "schema_version", "directive_id", "request_digest", "source", "problem", "core_diagnostics", "needs", "next_actions",
  "decision", "work_context", "permitted_progress", "can_continue", "ticket_request", "execution_authorized",
]);
const nyraConverseOutputSchema = object({
  schema_version: { const: "nyra_conversation_turn_v2" },
  ok: { const: true },
  tenant_id: { type: "string", minLength: 1, maxLength: 160 },
  turn_id: { type: "string", pattern: "^nyra_turn_[a-f0-9]{24}$" },
  identity_binding: object({
    authenticated: { const: true },
    tenant_bound: { const: true },
    principal_kind: { type: "string", enum: ["oauth", "codex", "service", "other"] },
    client_type: { type: "string", enum: ["chatgpt", "codex", "api_agent", "other"] },
    host_registered: { type: "boolean" },
    app_id: nyraConverseNullableText(64),
    host_kind: nyraConverseNullableText(80),
    host_registry_revision: nyraDirectiveDigest,
    caller_authority_accepted: { const: false },
  }, [
    "authenticated", "tenant_bound", "principal_kind", "client_type", "host_registered",
    "app_id", "host_kind", "host_registry_revision", "caller_authority_accepted",
  ]),
  work: object({
    preflight_bound: { const: true },
    work_bound: { type: "boolean" },
    work_id: nyraConverseNullableText(80),
    project_id: nyraConverseNullableText(80),
    state: {
      type: "string",
      enum: ["active", "blocked", "verified", "release_ready", "completed", "failed", "selection_required", "unbound", "unknown"],
    },
    next_action: nyraConverseNullableText(500),
    next_action_available: { type: "boolean" },
    selection_required: { type: "boolean" },
  }, ["preflight_bound", "work_bound", "work_id", "project_id", "state", "next_action", "next_action_available", "selection_required"]),
  memory: object({
    loaded: { type: "boolean" },
    active_task_count: { type: "integer", minimum: 0, maximum: 100_000 },
    active_lock_count: { type: "integer", minimum: 0, maximum: 100_000 },
    artifact_count: { type: "integer", minimum: 0, maximum: 100_000 },
    revision: { type: "integer", minimum: 0, maximum: 100_000 },
    relevant_count: { type: "integer", minimum: 0, maximum: 100_000 },
    handoff_count: { type: "integer", minimum: 0, maximum: 100_000 },
    recent_activity_count: { type: "integer", minimum: 0, maximum: 100_000 },
    raw_memory_returned: { const: false },
  }, [
    "loaded", "active_task_count", "active_lock_count", "artifact_count", "revision",
    "relevant_count", "handoff_count", "recent_activity_count", "raw_memory_returned",
  ]),
  interpretation: object({
    core: object({
      mode: { type: "string", enum: ["active", "shadow", "off"] },
      route: { type: "string", enum: ["V0", "V1", "V2"] },
      authority: { type: "string", enum: ["V0", "V1", "V2"] },
      parity_matched: { type: ["boolean", "null"] },
      execution_allowed: { const: false },
    }, ["mode", "route", "authority", "parity_matched", "execution_allowed"]),
    selected_action_id: nyraConverseNullableText(160),
    selected_action: nyraConverseNullableText(500),
    selected_action_available: { type: "boolean" },
    core_state: { type: "string", enum: ["observe", "ok", "attention", "critical", "protection", "blocked"] },
    core_control: { type: "string", enum: ["observe", "suggest", "confirm", "execute_allowed", "blocked"] },
    risk_band: { type: "string", enum: ["low", "medium", "high", "blocked", "unknown"] },
    blocked_reasons: nyraConverseSignalList,
    governance_diagnostics: object({
      state: { type: "string", enum: ["READY", "CONFIRMATION_REQUIRED", "BLOCKED"] },
      guard_mode: { type: "string", enum: ["normal", "confirmation_required"] },
      causes: {
        type: "array", maxItems: 8,
        items: object({
          code: nyraDirectiveCode,
          component: { type: "string", enum: ["UNIVERSAL_CORE", "OWNER"] },
          state: { type: "string", enum: ["GUARDED", "CONFIRMATION_REQUIRED", "BLOCKED"] },
          remediation: { type: "string", minLength: 1, maxLength: 500 },
        }, ["code", "component", "state", "remediation"]),
      },
    }, ["state", "guard_mode", "causes"]),
    unmet_conditions: nyraConverseSignalList,
    evidence_requirements: nyraConverseSignalList,
    allowed_alternatives: nyraConverseSignalList,
    next_step: nyraConverseNullableText(500),
    runbook_candidate: nyraConverseNullableText(160),
    owner_confirmation_required: { type: "boolean" },
    dialogue_accepted: { type: "boolean" },
    opened_branch_count: { type: "integer", minimum: 0, maximum: 100_000 },
  }, [
    "core", "selected_action_id", "selected_action", "selected_action_available", "core_state",
    "core_control", "risk_band",
    "blocked_reasons", "governance_diagnostics", "unmet_conditions", "evidence_requirements", "allowed_alternatives",
    "next_step", "runbook_candidate", "owner_confirmation_required", "dialogue_accepted",
    "opened_branch_count",
  ]),
  nyra_dialogue: object({
    dialogue_id: nyraConverseNullableText(80),
    manual_digest: nyraConverseNullableText(64),
    work_revision: { type: ["integer", "null"], minimum: 1, maximum: 100_000 },
    intent_digest: nyraConverseNullableText(64),
    checkpoint_available: { type: "boolean" },
    gallery_work_count: { type: "integer", minimum: 0, maximum: 100_000 },
    software_state: { type: "string", enum: ["available", "not_indexed", "unknown"] },
    atlas_revision: { type: ["integer", "null"], minimum: 0, maximum: 100_000 },
    diagnosis_state: { type: "string", minLength: 1, maxLength: 80 },
    next_action_available: { type: "boolean" },
    assignment: object({
      available: { type: "boolean" },
      assignment_id: nyraConverseNullableText(80),
      role: nyraConverseNullableText(80),
      state: nyraConverseNullableText(40),
    }, ["available", "assignment_id", "role", "state"]),
  }, ["dialogue_id", "manual_digest", "work_revision", "intent_digest", "checkpoint_available", "gallery_work_count", "software_state", "atlas_revision", "diagnosis_state", "next_action_available", "assignment"]),
  action_policy: object({
    consequential_request_detected: { type: "boolean" },
    categories: {
      type: "array",
      maxItems: 6,
      uniqueItems: true,
      items: nyraConverseActionCategory,
    },
    action_class: nyraDirectiveActionClass,
    capability_hint: nyraConverseNullableText(64),
    merge_requested: { type: "boolean" },
    ticket_reserve_requested: { type: "boolean" },
    work_bootstrap_requested: { type: "boolean" },
    work_bootstrap_spec_provided: { type: "boolean" },
    manual_owner_execution_requested: { type: "boolean" },
    mode: { type: "string", enum: ["advisory_only", "proposal_only"] },
    classification_only: { const: true },
    external_action_authorized: { const: false },
    consequential_action_performed: { const: false },
  }, [
    "consequential_request_detected", "categories", "action_class", "capability_hint",
    "merge_requested", "ticket_reserve_requested", "work_bootstrap_requested",
    "work_bootstrap_spec_provided", "manual_owner_execution_requested", "mode", "classification_only",
    "external_action_authorized", "consequential_action_performed",
  ]),
  orchestration_directive: nyraOrchestrationDirectiveSchema,
  host_response_contract: object({
    speaker: { const: "Nyra" },
    renderer: { const: "nyra_widget_with_host_fallback" },
    response_language: { type: "string", enum: ["it", "en", "match_user"] },
    response_style: { type: "string", enum: ["concise", "balanced", "detailed"] },
    reply_seed: { type: "string", minLength: 1, maxLength: 1_200 },
    next_action: nyraConverseNullableText(500),
    connected_ai_brief: object({
      schema_version: { const: "nyra_connected_ai_brief_v1" },
      state: { type: "string", enum: ["READY", "WAITING"] },
      goal: { type: "string", minLength: 1, maxLength: 500 },
      steps: {
        type: "array", maxItems: 3,
        items: object({
          order: { type: "integer", minimum: 1, maximum: 3 },
          instruction: { type: "string", minLength: 1, maxLength: 500 },
          mode: { type: "string", enum: ["READ_ONLY", "BOUNDED_WORKSPACE"] },
          expected_evidence: { type: "array", maxItems: 3, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 500 } },
          external_side_effect: { const: false },
        }, ["order", "instruction", "mode", "expected_evidence", "external_side_effect"]),
      },
      expected_evidence: { type: "array", maxItems: 3, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 500 } },
      research_required: { const: false },
      external_action_authorized: { const: false },
    }, ["schema_version", "state", "goal", "steps", "expected_evidence", "research_required", "external_action_authorized"]),
    rendering_policy: { const: "server_orchestration_directive_first_v2" },
    instructions: { type: "array", minItems: 3, maxItems: 3, items: { type: "string", maxLength: 500 } },
  }, ["speaker", "renderer", "response_language", "response_style", "reply_seed", "next_action", "connected_ai_brief", "rendering_policy", "instructions"]),
  execution_authorized: { const: false },
  external_action_authorized: { const: false },
  provider_execution: { const: false },
  provider_api_key_required: { const: false },
  server_model_calls: { const: 0 },
  dynamic_capability: { type: "object", additionalProperties: true },
}, [
  "schema_version", "ok", "tenant_id", "turn_id", "identity_binding", "work", "memory",
  "interpretation", "nyra_dialogue", "action_policy", "orchestration_directive",
  "host_response_contract", "execution_authorized",
  "external_action_authorized", "provider_execution", "provider_api_key_required", "server_model_calls",
]);

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
      evidence_state: runtimeEvidenceState,
    }, additionalProperties: false },
  }, ["request"]), ["core:read"], true, true, { outputSchema: object({ ok: { type: "boolean" }, tenant_id: { type: "string" }, core_runtime: coreRuntimeOutputSchema }, ["ok", "tenant_id", "core_runtime"]) }),
  tool("work_preflight", "Inspect automatic Tenant Work routing", "Before every generic Nyra/Core action, the gateway automatically opens the authenticated tenant's PostgreSQL Tenant Work Gallery, recalls canonical tenant memory, resumes an unambiguous existing Work Identity, and applies fail-closed governance. Do not call this manually before a normal action: use it only to inspect or diagnose the current route. It can report an owner-governed bootstrap when no existing work is unambiguous. Host-native children are created only by ChatGPT/Codex and require no provider API key. Never ask the user for a separate Gallery or shared-memory loading prompt.", object({
    request: text(),
    target_system: { type: "string", maxLength: 100 },
    operation_type: { type: "string", maxLength: 100 },
    tool_name: { type: "string", maxLength: 100 },
    work_id: { type: "string", format: "uuid" },
    parent_work_id: { type: "string", format: "uuid" },
    session_id: identifier,
    project_id: identifier,
    agent_id: identifier,
    host_type: { type: "string", pattern: "^[a-z][a-z0-9_]{1,62}_native$" },
    acceptance_criteria: { type: "array", maxItems: 100, items: text(1_000) },
    constraints: { type: "array", maxItems: 100, items: text(1_000) },
    response_mode: { type: "string", enum: ["compact", "full"] },
    nyra_branches: { type: "array", maxItems: 64, items: identifier },
    available_capabilities: { type: "array", maxItems: 50, items: { type: "string", maxLength: 80 } },
    evidence_state: {
      type: "object",
      properties: {
        source_count: { type: "integer", minimum: 0, maximum: 10_000 },
        confidence: probability,
        freshness_state: { type: "string", enum: ["fresh", "aging", "stale", "unknown"] },
        contradiction_count: { type: "integer", minimum: 0, maximum: 10_000 },
        knowledge_gap: { type: "boolean" },
        evidence_gap: { type: "boolean" },
        high_impact: { type: "boolean" },
      },
      additionalProperties: false,
    },
    research_allowed_domains: {
      type: "array",
      maxItems: 20,
      uniqueItems: true,
      items: { type: "string", minLength: 3, maxLength: 253 },
    },
    core_input: { type: "object", properties: { signals: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: true } }, data_quality: { type: "object", additionalProperties: true }, context: { type: "object", additionalProperties: true }, evidence_state: runtimeEvidenceState }, additionalProperties: false },
  }, ["request"]), ["core:read"], true, true, { outputSchema: workPreflightOutputSchema, meta: { "openai/toolInvocation/invoking": "Preparo Nyra…", "openai/toolInvocation/invoked": "Nyra è pronta." } }),
  tool("nyra_policy_registry_activate", "Activate a governed Nyra policy snapshot", "Request activation of one immutable, tenant-bound Policy Registry snapshot plus the exact active signed pack set used for Universal Core's deterministic recompile. Universal Core remains the final authority; the connector cannot execute provider workflows or accept caller-supplied proof, compiler authority, identity, preflight, receipt, attestation or key material.", object({
    work_id: policyRegistryUuid,
    operation_id: policyRegistryOperationId,
    domain_pack_id: policyRegistryDomainPackId,
    snapshot: policyRegistrySnapshot,
    compiler_input: policyRegistryCompilerInput,
    ...policyRegistryOwnerProperties,
  }, ["work_id", "operation_id", "domain_pack_id", "snapshot", "compiler_input", "owner_confirmed", "confirmation_reference"]), ["core:govern"], false, true, policyRegistryToolOptions),
  tool("nyra_policy_registry_rollback", "Roll back a governed Nyra policy snapshot", "Request rollback to one exact previously activated snapshot digest. Universal Core remains the final authority; caller-supplied proof, identity, preflight, receipt, attestation and key material are rejected.", object({
    work_id: policyRegistryUuid,
    operation_id: policyRegistryOperationId,
    domain_pack_id: policyRegistryDomainPackId,
    target_snapshot_digest: policyRegistrySha256,
    ...policyRegistryOwnerProperties,
  }, ["work_id", "operation_id", "domain_pack_id", "target_snapshot_digest", "owner_confirmed", "confirmation_reference"]), ["core:govern"], false, true, policyRegistryToolOptions),
  tool("nyra_policy_registry_reconcile", "Reconcile a governed Nyra policy operation", "Reconcile one exact in-progress Policy Registry operation after a fail-closed interruption. This never authorizes provider execution and accepts no caller-supplied proof or authority context.", object({
    work_id: policyRegistryUuid,
    operation_id: policyRegistryOperationId,
    ...policyRegistryOwnerProperties,
  }, ["work_id", "operation_id", "owner_confirmed", "confirmation_reference"]), ["core:govern"], false, true, {
    ...policyRegistryToolOptions,
    destructive: false,
  }),
  tool("nyra_runtime_context", "Read Nyra runtime context", "Read Nyra readiness, tenant memory and control context. Product packs are resolved only from authenticated Core key metadata.", object({ include_control_snapshot: { type: "boolean" }, ...memoryScopeProperties }), ["core:read"]),
  tool("nyra_converse", "Nyra: resume or guide the current Work", "Use this as the first and only read tool when the user addresses Nyra or asks to resume, continue, understand, diagnose, or coordinate a Work. It is the conversational front door: the server performs authenticated preflight, binds one canonical Work, reads bounded Work tasks/evidence, and returns Nyra's problem, needs, ordered actors, progress disposition and revision-bound Universal Core ticket candidate. For a ready external action, select exactly one continuation operation: issue_delegation or authorize_action; that choice is signed and cannot be changed on another replica. Do not call a preflight, Gallery, branch registry, self-model read or capability catalog first. PREPARE_BOUNDED_WORK permits local analysis, tests and evidence but never an external mutation. Merge is always MANUAL_ONLY for the owner after the Core gate. Nyra never calls a provider model, accepts caller authority, issues a ticket, or authorizes or performs an external action.", object({
    message: text(12_000),
    work_id: { type: "string", format: "uuid" },
    project_id: identifier,
    work_bootstrap: nyraWorkBootstrapSpec,
    continuation_operation: nyraActionContinuationOperation,
    locale: { type: "string", enum: ["auto", "it", "en"] },
    response_style: { type: "string", enum: ["concise", "balanced", "detailed"] },
  }, ["message"]), ["core:read"], true, true, {
    outputSchema: nyraConverseOutputSchema,
    meta: {
      "skinharmony/providerExecution": false,
      "skinharmony/externalSideEffect": false,
      ui: { resourceUri: NYRA_DIALOGUE_WIDGET_URI },
      "openai/outputTemplate": NYRA_DIALOGUE_WIDGET_URI,
      "openai/toolInvocation/invoking": "Nyra sta ascoltando…",
      "openai/toolInvocation/invoked": "Nyra ha preparato la risposta.",
    },
  }),
  tool("nyra_continue", "Nyra: continue one governed request", "Continue only the opaque, short-lived continuation_ref returned by nyra_converse. Nyra resolves it server-side and submits its bounded request to Universal Core; the AI never receives a Core candidate attestation. A registered host may request a duplicate review and owner-governed canonical V2 Work bootstrap, one bounded native-host delegation, or one exact action ticket. Work creation is two-phase and private by default; registration never grants owner authority. The tool never reserves or executes a ticket, never calls GitHub/Render, and never performs merge, deploy or publish. Unknown apps, host drift, expired references and durable replays fail closed.", object({
    operation: { type: "string", enum: ["review_work_bootstrap", "create_work", "issue_delegation", "authorize_action"] },
    continuation_ref: { type: "string", pattern: "^nyc1_[A-Za-z0-9_-]{32,80}$" },
    work_bootstrap: nyraWorkBootstrapSpec,
    review_decision: { type: "string", enum: ["CONTINUE_NEW_WORK", "PARALLEL_VALID"] },
    delegation_request: nyraContinueDelegationRequest,
    action_request: nyraContinueActionRequest,
    resume_request: nyraContinueResumeRequest,
    native_plan_request: nyraContinueNativePlanRequest,
    native_bind_request: nyraContinueNativeBindRequest,
    idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
    ...ownerConfirmationProperties,
  }, ["operation", "continuation_ref", "idempotency_key"]), ["core:govern"], false, true, {
    ownerConfirmationRequired: false,
    meta: {
      "skinharmony/dedicatedCoreGate": true,
      "skinharmony/externalSideEffect": false,
      "skinharmony/providerExecution": false,
      "skinharmony/nyraGovernedContinuation": true,
    },
  }),
  tool("nyra_branch_catalog", "Read Nyra neural branches", "Read the tenant-scoped Nyra branch and subbranch catalog governed by Universal Core.", object(), ["core:read"]),
  tool("nyra_self_model", "Read Nyra persistent self model", "Read Nyra's tenant-scoped, signed self model through Universal Core. This read never creates, refreshes, authorizes or executes anything.", object(), ["core:read"]),
  tool("nyra_self_model_refresh", "Materialize Nyra persistent self model", "Materialize or refresh Nyra's tenant-scoped, signed self model through Universal Core. This is an owner-confirmed internal state mutation: it never authorizes execution, calls a provider model, modifies a Work, or performs an external action.", object(), ["core:govern"], false, true, {
    meta: {
      "skinharmony/dedicatedCoreGate": true,
      "skinharmony/providerExecution": false,
      "skinharmony/externalSideEffect": false,
    },
  }),
  tool("core_capability_catalog", "Read governed Core capability catalog", "Discover bounded connector capabilities by functional group. The catalog never accepts arbitrary paths, never exposes admin/bootstrap/secret surfaces and leaves Universal Core as final authority.", object({
    group: identifier,
    capability_id: identifier,
    include_schema: { type: "boolean" },
    cursor: { type: "string", pattern: "^\\d+$", maxLength: 12 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    // A child that was created by a host-native plan has no ambient operate
    // grant. It may use this redacted proof only to discover its own exact
    // terminal report or verifier acceptance-contract read capability; the
    // server validates the signed transport binding, live lease and
    // assignment before returning any catalog entry.
    native_report_assignment: object({
      work_id: { type: "string", format: "uuid" },
      plan_id: { type: "string", format: "uuid" },
      native_agent_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{1,119}$" },
      host_task_id: { type: "string", minLength: 2, maxLength: 240, pattern: "^(?:/[a-zA-Z0-9][a-zA-Z0-9_/-]*|[a-zA-Z0-9][a-zA-Z0-9._:/-]*)$" },
      assignment_capability: { type: "string", pattern: "^hnac_[A-Za-z0-9_-]{43}$" },
    }, ["work_id", "plan_id", "native_agent_id", "host_task_id", "assignment_capability"]),
  }), ["core:read"]),
  tool("core_branch_registry", "Read Core branch intelligence", "Read the registry, taxonomy, maturity or authenticated authorization view for Core branches. Tenant and entitlements are derived from the Core key.", object({
    view: { type: "string", enum: ["registry", "taxonomy", "maturity", "authorized"] },
    branches: { type: "array", maxItems: 50, uniqueItems: true, items: identifier },
  }), ["core:read"]),
  tool("core_branch_analyze", "Analyze through a Core branch", "Run one authorized Core branch in advisory mode. It cannot execute, publish or bypass the final Core verdict.", object({
    branch: identifier,
    request: text(20_000),
    signals: { type: "array", maxItems: 100, items: { type: "object", maxProperties: 50, additionalProperties: boundedJsonValue } },
    context: { type: "object", maxProperties: 100, additionalProperties: boundedJsonValue },
    work_preflight: { type: "object" },
  }, ["branch", "request"]), ["core:read"]),
  tool("core_control_plane_read", "Read Core control plane", "Read one tenant-scoped governance view. Key secrets and administrative bootstrap data are never returned by this connector.", object({
    view: { type: "string", enum: ["tenant_status", "entitlements", "domain_pack", "overview", "dashboard", "ecosystem_pulse", "connector_manifest", "customer_intelligence_contract"] },
  }, ["view"]), ["core:read"]),
  tool("core_evidence_recent", "Read recent Core evidence", "Read a bounded list of tenant-scoped Core evidence records.", object({
    limit: { type: "integer", minimum: 1, maximum: 100 },
  }), ["core:read"]),
  tool("core_semantic_select", "Select semantic candidates", "Rank bounded semantic candidates through Core without publishing or execution.", object({
    candidates: { type: "array", minItems: 1, maxItems: 500, items: semanticCandidate },
    query: text(4_000),
    capability_ids: { type: "array", maxItems: 500, uniqueItems: true, items: identifier },
    target_language: { type: "string", minLength: 2, maxLength: 64 },
    adapter: { type: "string", maxLength: 120 },
    intent: { type: "string", maxLength: 240 },
    limit: { type: "integer", minimum: 1, maximum: 200 },
  }), ["core:read"]),
  tool("core_capability_read", "Read a dynamic Core capability", "Invoke one server-registered read-only capability by exact capability id and catalog revision. Routes, methods, tenant identity and authorization are resolved only server-side.", object({
    capability_id: identifier,
    catalog_revision: { type: "string", pattern: "^[a-f0-9]{64}$" },
    arguments: { type: "object", maxProperties: 200, additionalProperties: true },
    // The outer wrapper may carry an opaque logical transport session when a
    // stateless OAuth host cannot retain the optional MCP session header. It
    // is consumed by the gateway only and is never forwarded to `arguments`.
    session_id: identifier,
  }, ["capability_id", "catalog_revision"]), ["core:read"]),
  tool("core_capability_invoke", "Invoke a governed dynamic capability", "Invoke one server-registered mutating capability by exact capability id and catalog revision. Bounded post-delegation actions use their signed Core gate without another owner prompt; only a target explicitly marked owner-confirmed may consume one fresh owner confirmation.", object({
    capability_id: identifier,
    catalog_revision: { type: "string", pattern: "^[a-f0-9]{64}$" },
    arguments: { type: "object", maxProperties: 200, additionalProperties: true },
    idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
    ...ownerConfirmationProperties,
  }, ["capability_id", "catalog_revision", "idempotency_key"]), ["core:govern"], false, false, {
    ownerConfirmationRequired: false,
  }),
  tool("core_software_language_evaluate", "Evaluate software language", "Apply the horizontal V2/V1/V0 software-language gate to bounded UI copy. This returns findings only and never publishes changes.", object({
    app: identifier,
    target_lang: { type: "string", minLength: 2, maxLength: 64 },
    entries: { type: "array", minItems: 1, maxItems: 1_000, items: object({
      id: { type: "string", minLength: 1, maxLength: 240 },
      text: text(8_000),
      context: { type: "string", maxLength: 1_000 },
    }, ["id", "text"]) },
  }, ["app", "target_lang", "entries"]), ["core:read"]),
  tool("core_content_guard_check", "Check governed content", "Check bounded text through the Core content branch. Suggestions remain review-only and publication stays disabled.", object({
    text: text(100_000),
    locale: { type: "string", minLength: 2, maxLength: 64 },
    context: { type: "string", maxLength: 4_000 },
  }, ["text"]), ["core:read"]),
  tool("core_claim_guard_check", "Check claims", "Check bounded claims for unsupported or risky assertions. The result is advisory and cannot publish.", object({
    text: text(100_000),
    forbidden_terms: { type: "array", maxItems: 500, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 240 } },
  }, ["text"]), ["core:read"]),
  tool("core_pricing_guard_check", "Check pricing content", "Check bounded pricing offers for completeness and consistency without changing catalog or payment data.", object({
    official_prices: { type: "array", minItems: 1, maxItems: 500, items: object({
      id: { type: "string", minLength: 1, maxLength: 160 },
      sku: { type: "string", maxLength: 160 },
      name: { type: "string", maxLength: 500 },
      price: { type: "number", minimum: 0 },
    }, ["id", "price"]) },
    observed_prices: { type: "array", minItems: 1, maxItems: 500, items: object({
      id: { type: "string", minLength: 1, maxLength: 160 },
      sku: { type: "string", maxLength: 160 },
      name: { type: "string", maxLength: 500 },
      price: { type: "number", minimum: 0 },
    }, ["id", "price"]) },
  }, ["official_prices", "observed_prices"]), ["core:read"]),
  tool("core_policy_check", "Check Core policy", "Evaluate a bounded action and policy through the tenant Core policy engine. It returns mediation only and authorizes no execution.", object({
    action: { type: "object", minProperties: 1, maxProperties: 100, additionalProperties: boundedJsonValue },
    policy: { type: "object", maxProperties: 100, additionalProperties: boundedJsonValue },
    context: { type: "object", maxProperties: 100, additionalProperties: boundedJsonValue },
  }, ["action"]), ["core:read"]),
  tool("core_action_mediation_evaluate", "Evaluate action mediation", "Return Core action mediation for a bounded proposed action. This tool does not perform the action.", object({
    action: { type: "object", minProperties: 1, maxProperties: 100, additionalProperties: boundedJsonValue },
    policy: { type: "object", maxProperties: 100, additionalProperties: boundedJsonValue },
    context: { type: "object", maxProperties: 100, additionalProperties: boundedJsonValue },
    work_preflight: { type: "object" },
  }, ["action", "work_preflight"]), ["core:read"]),
  tool("core_release_manifest_check", "Check release manifest", "Validate a bounded release manifest and rollback declaration through Core. It never merges or deploys.", object({
    manifest: object({
      version: { type: "string", minLength: 1, maxLength: 160 },
      channel: { type: "string", enum: ["stable", "beta", "canary"] },
      package_url: { type: "string", format: "uri", maxLength: 2_048 },
      checksum_sha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
      rollback_url: { type: "string", format: "uri", maxLength: 2_048 },
      signed: { type: "boolean" },
      signature: { type: "string", maxLength: 4_000 },
    }, ["version", "channel", "package_url", "checksum_sha256", "rollback_url"]),
  }, ["manifest"]), ["core:read"]),
  tool("core_translator_extractor_status", "Read translator extractor status", "Read the governed Core-side lexical extractor readiness without running the binary.", object(), ["core:read"]),
  tool("core_software_intelligence_components", "Read software intelligence components", "Read available static-analysis components and artifact limits. Execution remains unsupported.", object(), ["core:read"]),
  tool("core_software_intelligence_analyze", "Analyze a software artifact", "Perform bounded static observation of one embedded artifact. Raw content is not persisted and patches require a separate Core verdict.", object({
    artifact: object({
      name: { type: "string", minLength: 1, maxLength: 240 },
      content_base64: { type: "string", minLength: 1, maxLength: 7_000_000, pattern: "^[A-Za-z0-9+/]+={0,2}$" },
    }, ["name", "content_base64"]),
    authorization: object({
      asserted: { const: true },
      basis: { type: "string", enum: ["owned", "written_permission", "open_source"] },
      purpose: { type: "string", enum: ["compatibility", "customization", "debugging", "interoperability", "maintenance", "security_review", "testing"] },
    }, ["asserted", "basis", "purpose"]),
    options: object({
      minimum_string_length: { type: "integer", minimum: 4, maximum: 64 },
      maximum_string_samples: { type: "integer", minimum: 0, maximum: 500 },
    }),
  }, ["artifact", "authorization"]), ["core:read"], true, false),
  tool("core_software_intelligence_jobs", "Read software intelligence jobs", "List tenant-scoped software-analysis jobs or read one exact job. Submission and authorization stay on governed dedicated flows.", object({
    job_id: { type: "string", minLength: 1, maxLength: 160, pattern: "^[a-zA-Z0-9_-]+$" },
  }), ["core:read"]),
  tool("core_entity_graph_read", "Read Core entity graph", "Read the authenticated tenant's generic semantic entity graph.", object(), ["core:read"]),
  tool("core_entity_graph_upsert", "Upsert Core entity graph", "Upsert bounded tenant entities and relations. Exact owner confirmation is required and Core records evidence.", object({
    entities: { type: "array", maxItems: 1_000, items: entityGraphEntity },
    relations: { type: "array", maxItems: 2_000, items: entityGraphRelation },
  }), ["core:govern"], false, true),
  tool("core_review_pending", "Read pending Core reviews", "Read pending review gates for the authenticated tenant.", object(), ["core:read"]),
  tool("core_review_action", "Resolve Core review", "Apply an explicit owner-confirmed decision to one tenant review record.", object({
    review_id: { type: "string", minLength: 1, maxLength: 160 },
    action: { type: "string", enum: ["approve", "reject", "request_changes"] },
    note: { type: "string", maxLength: 4_000 },
  }, ["review_id", "action"]), ["core:govern"], false, false),
  tool("orchestration_capability_catalog", "Read orchestration capability catalog", "Read one bounded page of the Agent Orchestration or AI Orchestration catalog. Virtual combinations are generated lazily and remain proposal-only; reading this catalog never creates agents or invokes models.", object({
    branch: { type: "string", enum: ["agent_orchestration", "ai_orchestration"] },
    view: { type: "string", enum: ["capabilities", "virtual"] },
    cursor: { type: "string", pattern: "^\\d+$", maxLength: 40 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  }, ["branch"]), ["core:read"], true, true),
  tool("lexical_semantic_catalog", "Read lexical-semantic catalog", "Read a bounded page of lexical-semantic capabilities or one lazily generated page from 777,600 proposal-only variants. It never materializes DTT nodes, invokes models or changes policy.", object({
    view: { type: "string", enum: ["capabilities", "virtual"] },
    cursor: { type: "string", pattern: "^\\d+$", maxLength: 40 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  }), ["core:read"], true, true),
  tool("lexical_semantic_analyze", "Analyze lexical-semantic context", "Analyze bounded text for direct commands, quotations, negation, multilingual risk and ambiguity. The branch proposes allow, clarify or block signals; Universal Core remains the final authority and execution is always disabled.", object({
    text: text(32_768),
    locale: { type: "string", minLength: 2, maxLength: 64 },
    source_context: {
      type: "string",
      enum: ["user_input", "inter_agent_handoff", "retrieved_web", "tool_output", "model_output", "documentation", "untrusted_data"],
    },
  }, ["text"]), ["core:read"], true, true),
  tool("orchestration_relational_evaluate", "Evaluate agent relationships", "Build a tenant-bound relational supervision contract under Universal Core. The relational supervisor coordinates Nyra, detects conflicts and proposes reconciliation but cannot invoke models, tools or external actions.", object({
    objective: text(4_000),
    actors: {
      type: "array",
      minItems: 3,
      maxItems: 32,
      items: object({
        actor_id: identifier,
        role: { type: "string", enum: ["core", "relational_supervisor", "nyra", "orchestrator", "agent", "ai", "human"] },
        capabilities: { type: "array", maxItems: 30, uniqueItems: true, items: { type: "string", maxLength: 120 } },
      }, ["actor_id", "role"]),
    },
    relations: {
      type: "array",
      minItems: 2,
      maxItems: 64,
      items: object({
        from: identifier,
        to: identifier,
        type: { type: "string", enum: ["governs", "coordinates", "advises", "opens_context_for", "delegates", "verifies", "joins"] },
      }, ["from", "to", "type"]),
    },
    unresolved_conflicts: { type: "array", maxItems: 30, uniqueItems: true, items: text(500) },
  }, ["objective", "actors", "relations"]), ["core:read"], true, true),
  tool("orchestration_dtt_plan", "Plan a governed Dynamic Task Tree", "Compile a deterministic tenant-and-Work-bound DTT v3 proposal with explicit node, depth, fan-out, parallel, time, token and cost limits. It never runs agents, models or tools and always requires a Universal Core join.", object({
    work_id: dttWorkId,
    objective: text(4_000),
    limits: object({
      max_nodes: { type: "integer", minimum: 1, maximum: 2_000 },
      max_depth: { type: "integer", minimum: 0, maximum: 16 },
      max_fanout: { type: "integer", minimum: 1, maximum: 3 },
      max_parallel: { type: "integer", minimum: 1, maximum: 2 },
      max_time_ms: { type: "integer", minimum: 1, maximum: 3_600_000 },
      max_tokens: { type: "integer", minimum: 1, maximum: 2_000_000 },
      max_cost_micros: { type: "integer", minimum: 1, maximum: 1_000_000_000 },
    }),
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: 200,
      items: dttNodeInput,
    },
  }, ["work_id", "objective", "nodes"]), ["core:read"], true, true),
  tool("orchestration_dtt_read", "Read a Dynamic Task Tree", "Read the current tenant-and-Work-bound DTT v3 state. This exposes audit state only and never invokes a model, tool, agent or external action.", object({
    work_id: dttWorkId,
    tree_id: dttReference,
  }, ["work_id", "tree_id"]), ["core:read"], true, true),
  tool("orchestration_dtt_verification_readiness", "Read persistent DTT verification readiness", "Read only the durable evidence progress for one tenant-and-Work-bound DTT: verifier assignments, recorded outcomes, Core Join state and the exact next governed step. Evidence drafts and unsubmitted receipts remain intentionally non-durable until recorded, so this tool never reports speculative progress as ready.", object({
    work_id: dttWorkId,
    tree_id: dttReference,
  }, ["work_id", "tree_id"]), ["core:read"], true, true),
  tool("orchestration_dtt_expansion_propose", "Propose DTT expansion", "Validate and return a bounded expansion proposal for Core review. The proposal is not applied and authorizes no execution.", object({
    work_id: dttWorkId,
    tree_id: dttReference,
    parent_node_id: dttReference,
    nodes: { type: "array", minItems: 1, maxItems: 200, items: dttNodeInput },
  }, ["work_id", "tree_id", "parent_node_id", "nodes"]), ["core:read"], true, true),
  tool("orchestration_dtt_replan_propose", "Propose DTT replan", "Validate a prune-and-replace DTT proposal for Core review. It does not mutate the tree and authorizes no execution.", object({
    work_id: dttWorkId,
    tree_id: dttReference,
    prune_node_ids: { type: "array", minItems: 1, maxItems: 200, uniqueItems: true, items: dttReference },
    replacement_nodes: { type: "array", maxItems: 200, items: dttNodeInput },
    reason: text(500),
  }, ["work_id", "tree_id", "prune_node_ids", "reason"]), ["core:read"], true, true),
  tool("orchestration_dtt_outcome_record", "Record a DTT node outcome", "Record a tenant-and-Work-bound verified or failed node outcome in the non-executive DTT runtime. The required idempotency key makes retries durable without authorizing execution; Core stores the transition for audit and never invokes agents, models, tools or external actions.", object({
    work_id: dttWorkId,
    tree_id: dttReference,
    node_id: dttReference,
    idempotency_key: { type: "string", minLength: 1, maxLength: 200 },
    outcome: { type: "string", enum: ["verified", "failed"] },
    evidence: {
      anyOf: [
        dttEvidenceInput,
        object({
          failure_reference: text(1_000),
          details: { type: "object", additionalProperties: true },
        }, ["failure_reference"]),
      ],
    },
    evidence_draft: dttEvidenceDraftInput,
    votes: { type: "array", minItems: 1, maxItems: 64, items: dttVoteInput },
  }, ["work_id", "tree_id", "node_id", "idempotency_key", "outcome"]), ["core:govern"], false, true),
  tool("orchestration_dtt_evidence_prepare", "Prepare a DTT evidence draft", "Deterministically compute a tenant/Work/tree/node-bound evidence digest from claim, artifacts and provenance. It performs no execution and lets independent agents request signed attestations without client-side cryptography.", object({
    work_id: dttWorkId,
    tree_id: dttReference,
    node_id: dttReference,
    claim: text(4_000),
    artifacts: dttEvidenceInput.properties.artifacts,
    provenance: object({
      producer_id: { type: "string", minLength: 1, maxLength: 160 },
      source_type: { type: "string", minLength: 1, maxLength: 120 },
      source_reference: text(1_000),
    }, ["producer_id", "source_type", "source_reference"]),
    required_approvals: { type: "integer", minimum: 1, maximum: 64 },
  }, ["work_id", "tree_id", "node_id", "claim", "artifacts", "provenance", "required_approvals"]), ["core:read"], true, true),
  tool("orchestration_dtt_agent_attest", "Attest DTT evidence as the current agent", "Request a short-lived Core-signed identity receipt bound to the authenticated agent presence, tenant, Work, tree, node, evidence digest and vote. Each independent verifier must call this tool from its own registered session before a verified outcome can satisfy quorum.", object({
    work_id: dttWorkId,
    tree_id: dttReference,
    node_id: dttReference,
    evidence_digest: { type: "string", pattern: "^evd_[a-f0-9]{64}$" },
    decision: { type: "string", enum: ["approve", "dissent"] },
    rationale: text(1_000),
    assignment_id: { type: "string", pattern: "^dtta_[a-f0-9]{32}$" },
  }, ["work_id", "tree_id", "node_id", "evidence_digest", "decision", "rationale", "assignment_id"]), ["core:govern"], false, true),
  tool("orchestration_dtt_verifier_assign_self", "Assign the current agent as DTT verifier", "Ask Core to persist a verifier assignment for the current authenticated agent lifecycle and logical session on one tenant-and-Work-bound DTT node. The returned assignment is required before this agent can attest.", object({
    work_id: dttWorkId,
    tree_id: dttReference,
    node_id: dttReference,
  }, ["work_id", "tree_id", "node_id"]), ["core:govern"], false, true),
  tool("orchestration_dtt_artifact_register", "Register immutable DTT evidence", "Send bounded evidence content to Core for hashing. Core stores only tenant-and-Work-bound immutable artifact id, digest and source metadata, never the raw content; drafts and joins must resolve the exact returned tuple.", object({
    work_id: dttWorkId,
    artifact_id: { type: "string", minLength: 1, maxLength: 160 },
    content: text(200_000),
    source_reference: text(1_000),
    registry_reference: text(1_000),
  }, ["work_id", "artifact_id", "content", "source_reference", "registry_reference"]), ["core:govern"], false, true),
  tool("orchestration_dtt_cancel", "Cancel a Dynamic Task Tree", "Propagate a tenant-and-Work-bound kill signal across every non-terminal DTT node. This changes only audit/runtime state and never invokes an external action.", object({
    work_id: dttWorkId,
    tree_id: dttReference,
    reason: text(500),
  }, ["work_id", "tree_id", "reason"]), ["core:govern"], false, true, { destructive: true }),
  tool("orchestration_dtt_retry_fallback_read", "Read DTT retry and fallback state", "Read retry and fallback proposals from the current tenant-and-Work-bound DTT state. Proposals authorize no execution.", object({
    work_id: dttWorkId,
    tree_id: dttReference,
  }, ["work_id", "tree_id"]), ["core:read"], true, true),
  tool("orchestration_dtt_core_join", "Join a verified DTT through Core", "Request the Universal Core endpoint to join a fully verified tenant-and-Work-bound tree. The caller cannot nominate the authority; Core produces the authority field and the join never executes an agent, model, tool or external action.", object({
    work_id: dttWorkId,
    tree_id: dttReference,
  }, ["work_id", "tree_id"]), ["core:govern"], false, true, { ownerConfirmationRequired: false }),
  tool("nyra_interpret_request", "Interpret a Nyra request", "Use this when a request needs Nyra routing, bounded cognition, dialogue validation or owner protection. It returns a compact fast result by default; choose deep for scenarios and hypotheses, or full only for diagnostics. Universal Core remains final authority and execution stays disabled.", object({ message: text(), session_id: identifier, project_id: identifier, agent_id: identifier, response_mode: { type: "string", enum: ["fast", "deep", "full"] }, nyra_branches: { type: "array", maxItems: 64, items: identifier }, available_capabilities: { type: "array", maxItems: 50, items: { type: "string", maxLength: 80 } } }, ["message"]), ["core:read"]),
  tool("nyra_fetch_analysis", "Fetch Nyra analysis details", "Use this after nyra_interpret_request when the compact result indicates that deeper or diagnostic details are relevant. Results are tenant-scoped and expire after five minutes; execution remains disabled.", object({ analysis_id: { type: "string", pattern: "^nyra_[a-f0-9]{24}$" }, response_mode: { type: "string", enum: ["deep", "full"] }, session_id: identifier, agent_id: identifier }, ["analysis_id"]), ["core:read"]),
  tool("core_gate_action", "Evaluate and authorize a scoped action", "Ask Universal Core to evaluate an action and, only for supported fail-closed operation classes, return a scoped authorization. This tool never executes the action.", { type: "object", required: ["action_label", "action_type"], properties: { action_label: text(500), action_type: text(120), operation_class: text(120), target_commit: { type: "string", pattern: "^[a-fA-F0-9]{40}$" }, read_only: { type: "boolean" }, dry_run: { type: "boolean" }, external_side_effect: { type: "boolean" }, contains_customer_data: { type: "boolean" }, contains_secret: { type: "boolean" }, cross_tenant: { type: "boolean" }, destructive: { type: "boolean" }, verified_outcome: { type: "boolean" }, bypass_orchestrator: { type: "boolean" }, rollback_ready: { type: "boolean" }, audit_ready: { type: "boolean" }, configuration_changes: { type: "boolean" } }, additionalProperties: true }, ["core:govern"], false, true),
  tool("ai_work_quality_observe", "Record and evaluate an AI work-quality failure", "Submit one evidence-bound exact-code observation to Universal Core. Core always keeps execution disabled, opens or joins one tenant-scoped remediation, and lets Nyra explain the corrective path without granting ALLOW.", object({
    observation_id: identifier,
    work_id: identifier,
    attempt_id: identifier,
    observer_role: text(120),
    code: { type: "string", minLength: 1, maxLength: 120, pattern: "^[A-Z][A-Z0-9_]+$" },
    summary: text(2_000),
    evidence: { type: "array", minItems: 1, maxItems: 50, items: text(2_000) },
    evidence_receipts: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", required: ["artifact_id", "content_digest", "source_reference", "registry_reference"], properties: {
      artifact_id: identifier,
      content_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
      source_reference: identifier,
      registry_reference: { type: "string", pattern: "^awqb_[a-f0-9]{64}$" },
    }, additionalProperties: false } },
    expected_state_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    observed_state_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    project_id: identifier,
    branch_id: identifier,
    session_id: identifier,
    target_system: text(200),
    operation_type: text(120),
    repository: text(240),
    ref: text(240),
    environment: text(120),
    resource_ids: { type: "array", maxItems: 50, items: text(240) },
  }, ["observation_id", "work_id", "code", "summary", "evidence", "evidence_receipts", "expected_state_digest", "observed_state_digest"]), ["core:govern"], false, true, { ownerConfirmationRequired: false }),
  tool("core_block_remediation_status", "Read core block remediation status", "Read the tenant-scoped remediation contract and blocker state for one remediation_id. This never authorizes execution.", object({
    remediation_id: identifier,
  }, ["remediation_id"]), ["core:read"], true, true),
  tool("core_block_remediation_explain", "Read core block remediation explanation", "Read the Nyra explanation or deterministic fallback for one remediation contract. This only explains the block and never changes verdicts.", object({
    remediation_id: identifier,
  }, ["remediation_id"]), ["core:read"], true, true),
  tool("core_block_remediation_propose", "Submit a core block remediation proposal", "Submit an AI proposal for a blocked Core decision. Core remains final authority; the proposal only records diagnosis, evidence, tests and rollback.", object({
    remediation_id: identifier,
    expected_version: { type: "integer", minimum: 0, maximum: 1_000_000 },
    idempotency_key: text(120),
    diagnosis: {
      type: "object",
      required: ["root_cause"],
      properties: {
        root_cause: text(4_000),
        evidence: { type: "array", maxItems: 100, items: text(2_000) },
        unknowns: { type: "array", maxItems: 100, items: text(2_000) },
        affected_components: { type: "array", maxItems: 100, items: text(200) },
      },
      additionalProperties: false,
    },
    proposal: {
      type: "object",
      required: ["proposal_type", "summary", "scope"],
      properties: {
        proposal_type: { type: "string", enum: ["same_action_remediation", "safe_alternative", "owner_confirmation_route", "transient_retry"] },
        summary: text(4_000),
        scope: { type: "object", additionalProperties: true },
        changes: { type: "array", maxItems: 100, items: { type: "object", properties: { component: text(120), path: text(500), change: text(2_000), reason: text(2_000) }, required: ["component", "change", "reason"], additionalProperties: false } },
        tests: { type: "array", maxItems: 100, items: { type: "object", properties: { name: text(200), type: { type: "string", enum: ["unit", "integration", "security", "tenant_isolation", "regression", "smoke"] }, command: text(1_000), expected_result: text(2_000) }, required: ["name", "type", "expected_result"], additionalProperties: false } },
        evidence: { type: "array", maxItems: 100, items: text(2_000) },
        rollback: { type: "object", properties: { available: { type: "boolean" }, steps: { type: "array", maxItems: 100, items: text(2_000) }, trigger_conditions: { type: "array", maxItems: 100, items: text(2_000) } }, required: ["available"], additionalProperties: false },
        conditions_addressed: { type: "array", maxItems: 100, items: text(2_000) },
        residual_risks: { type: "array", maxItems: 100, items: text(2_000) },
        alternative_only: { type: "boolean" },
      },
      additionalProperties: false,
    },
  }, ["remediation_id", "expected_version", "idempotency_key", "diagnosis", "proposal"]), ["core:govern"], false, true),
  tool("core_block_remediation_review", "Review a core block remediation proposal", "Ask Nyra to review the latest blocked-Core remediation proposal. Nyra may approve for Core, request revision, or reject, but never execute.", object({
    remediation_id: identifier,
    attempt_id: identifier,
  }, ["remediation_id", "attempt_id"]), ["core:govern"], false, true),
  tool("core_block_remediation_resubmit", "Resubmit a core block remediation proposal to Core", "Ask Universal Core to re-evaluate the latest approved remediation proposal using a new decision request. Core remains the only authority that can produce ALLOW.", object({
    remediation_id: identifier,
    attempt_id: identifier,
  }, ["remediation_id", "attempt_id"]), ["core:govern"], false, true),
  tool("core_block_remediation_cancel", "Cancel a core block remediation", "Cancel a tenant-scoped remediation contract without deleting its audit trail.", object({
    remediation_id: identifier,
    reason: text(500),
  }, ["remediation_id"]), ["core:govern"], false, true, { destructive: true }),
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
  tool("decision_ledger_report", "Read Core decision and security quality report", "Read tenant-scoped counts for AI work, Core corrections, denials, confirmations, failures, prompt-injection quarantines, quality evidence, false completion claims and verified outcomes. Raw prompts, customer data and secrets are never returned.", object({ days: { type: "integer", minimum: 1, maximum: 365 } }), ["core:read"]),
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
  tool("nyra_research_distillation_status", "Read Research Distillation status", "Read the tenant-bound Core mode, policy version, allowlist decision and shadow metrics. This never authorizes research or persistence.", object(), ["core:read"]),
  tool("nyra_research_airlock_status", "Read Research Airlock status", "Read the tenant-scoped Airlock readiness, PostgreSQL state backend, narrow Core/Nyra enforcement overlay, metrics and explicit ChatGPT host-tool boundary.", object(), ["core:read"]),
  tool("nyra_research_airlock_bootstrap", "Start a public-only research Airlock", "Automatically issue and consume the short-lived Core plan capability for the authenticated tenant/session. The capability never leaves the server, is single-use and is bound to the exact tenant, project, work and session.", object({
    work_binding: researchAirlockWorkBinding,
    source_urls: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "string", format: "uri", maxLength: 2_048 } },
    ttl_seconds: { type: "integer", minimum: 300, maximum: 3_600 },
  }, ["work_binding", "source_urls"]), ["core:govern"], false, false, { ownerConfirmationRequired: false }),
  tool("nyra_research_airlock_plan", "Issue a public-only research plan", "Make this the first Nyra/Core work action in a fresh logical session. Universal Core validates exact HTTPS source URLs, computes the immutable plan digest and returns a short-lived single-use plan capability. Any earlier private or unclassified Nyra/Core tool use permanently prevents Airlock opening in that session.", object({
    work_binding: researchAirlockWorkBinding,
    source_urls: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "string", format: "uri", maxLength: 2_048 } },
  }, ["work_binding", "source_urls"]), ["core:govern"], false, false, { ownerConfirmationRequired: false }),
  tool("nyra_research_airlock_open", "Open public-only research", "Consume the Core-issued single-use plan capability to atomically open an irreversible Research Airlock state machine. The exact source URLs and plan digest come only from the durable Core plan.", object({
    work_binding: researchAirlockWorkBinding,
    plan_capability: { type: "string", pattern: "^rap_[a-f0-9-]{36}\\.[a-f0-9]{64}$" },
    ttl_seconds: { type: "integer", minimum: 300, maximum: 3_600 },
  }, ["work_binding", "plan_capability"]), ["core:govern"], false, false, { ownerConfirmationRequired: false }),
  tool("nyra_research_airlock_discover", "Fetch public evidence through Core", "Have Universal Core perform a fixed HTTPS GET or HEAD with DNS/IP pinning, redirect revalidation, strict limits and deterministic sanitization. Raw source bytes never return to the model.", object({
    work_binding: researchAirlockWorkBinding,
    url: { type: "string", format: "uri", maxLength: 2_048 },
    method: { type: "string", enum: ["GET", "HEAD"] },
  }, ["work_binding", "url"]), ["core:govern"], false, false, { ownerConfirmationRequired: false, openWorld: true, dedicatedCoreGate: true }),
  tool("nyra_research_airlock_seal", "Seal public evidence", "Seal all verified evidence for one work. This irreversible transition closes Nyra/Core public discovery and issues one single-use private-entry capability.", object({
    work_binding: researchAirlockWorkBinding,
  }, ["work_binding"]), ["core:govern"], false, false, { ownerConfirmationRequired: false }),
  tool("nyra_research_airlock_private_enter", "Enter private synthesis", "Consume the single-use private-entry capability. Core changes the work to PRIVATE_SYNTHESIS and returns only typed sanitized evidence with all Nyra/Core external tools denied.", object({
    work_binding: researchAirlockWorkBinding,
    private_entry_capability: { type: "string", pattern: "^rac_[a-f0-9-]{36}\\.[a-f0-9]{64}$" },
  }, ["work_binding", "private_entry_capability"]), ["core:govern"], false, false, { ownerConfirmationRequired: false }),
  tool("nyra_research_airlock_tool_authorize", "Authorize an Airlock tool", "Read server-side FSM state before a Nyra/Core tool action. External research tools are allowed only in DISCOVERY_OPEN and fail closed after evidence is sealed.", object({
    work_binding: researchAirlockWorkBinding,
    tool_name: identifier,
  }, ["work_binding", "tool_name"]), ["core:govern"], false, false, { ownerConfirmationRequired: false }),
  tool("nyra_research_airlock_complete", "Close private research", "Irreversibly close a PRIVATE_SYNTHESIS work while preserving PostgreSQL proof and audit metadata.", object({
    work_binding: researchAirlockWorkBinding,
  }, ["work_binding"]), ["core:govern"], false, false, { ownerConfirmationRequired: false }),
  tool("nyra_research_source_registry", "Read trusted research sources", "Read the Core-owned trusted source registry and branch bindings for this tenant. Use source ids from this registry when opening a workspace.", object(), ["core:read"]),
  tool("nyra_research_learning_pack", "Read a branch learning pack", "Read the empty-by-default, versioned learning pack for one Core branch. Verified knowledge is never synthesized by the MCP.", object({
    branch_id: identifier,
  }), ["core:read"]),
  tool("nyra_research_envelope_authorize", "Authorize a research envelope", "Ask Universal Core to issue its own non-executing directive and bound branches, source ids, document count, bytes, duration, cost and retention. Shadow mode returns shadow_only and never authorizes external side effects.", object(researchDistillationEnvelopeProperties, ["question", "branch_ids"]), ["core:govern"], false, false),
  tool("nyra_research_workspace_open", "Open a governed research workspace", "Open a tenant-isolated Research Distillation workspace from a single-use opaque envelope issued by Universal Core. In shadow it is observational and has no durable workspace writes.", object({
    envelope_id: { type: "string", pattern: "^rae_[a-f0-9-]{36}$" },
  }, ["envelope_id"]), ["core:govern"], false, false),
  tool("nyra_research_workspace_attach", "Attach governed research evidence", "Attach only short evidence records that match the Core source registry and workspace envelope. Raw pages, private hosts and unknown sources are rejected.", object({
    workspace_id: { type: "string", pattern: "^rw_[a-f0-9-]{36}$" },
    evidence: { type: "array", minItems: 1, maxItems: 100, items: researchDistillationEvidence },
  }, ["workspace_id", "evidence"]), ["core:govern"], false, false),
  tool("nyra_research_distill", "Distill a governed learning candidate", "Create a tenant-bound candidate from evidence already validated by Core. This MCP path always forces persist_verified=false; automatic promotion is impossible.", object({
    workspace_id: { type: "string", pattern: "^rw_[a-f0-9-]{36}$" },
    evidence: { type: "array", maxItems: 100, items: researchDistillationEvidence },
    lesson: text(1_000),
    learning: text(1_000),
    scope: { type: "string", maxLength: 200 },
    confidence: probability,
    limitations: { type: "array", maxItems: 10, items: text(1_000) },
    outcome_refs: { type: "array", maxItems: 10, items: identifier },
    audit_reference: { type: "string", maxLength: 240 },
  }, ["workspace_id"]), ["core:govern"], false, false),
  tool("nyra_research_workspace_close", "Close a governed research workspace", "Close one tenant-bound Core workspace after candidate review. It cannot close another tenant's workspace.", object({
    workspace_id: { type: "string", pattern: "^rw_[a-f0-9-]{36}$" },
  }, ["workspace_id"]), ["core:govern"], false, true),
  tool("nyra_research_cleanup", "Clean expired research workspaces", "Ask Core to remove only expired workspaces for the authenticated tenant. It cannot address another tenant.", object(), ["core:govern"], false, true, { destructive: true }),
  tool("nyra_v2_preview", "Preview Deep Branch V2", "Ask Universal Core to route Nyra V1 first, issue a signed bounded Deep V2 preview request and return only a non-executing Core-authoritative preview.", object({
    message: text(),
    request_id: nyraDeepV2RequestId,
    nyra_branches: { type: "array", maxItems: 64, uniqueItems: true, items: identifier },
  }, ["message"]), ["core:read"], true, false),
  tool("nyra_v2_requirements", "Read Deep V2 evidence requirements", "Ask Universal Core for the opaque evidence requirements of one Core-opened Deep V2 branch and subbranch. It never authorizes execution.", object({
    message: text(),
    request_id: nyraDeepV2RequestId,
    branch_id: identifier,
    subbranch_id: identifier,
  }, ["message", "branch_id", "subbranch_id"]), ["core:read"], true, false),
  tool("nyra_v2_evidence_prepare", "Prepare governed Deep V2 evidence", "Send a bounded evidence pack to Universal Core. MCP computes and signs the exact pack binding; Core retrieves only registry-authorized sources and returns opaque evidence references. No Nyra execution is authorized.", object({
    message: text(),
    request_id: nyraDeepV2RequestId,
    branch_id: identifier,
    subbranch_id: identifier,
    evidence_pack: nyraDeepV2EvidencePack,
    requirement_bindings: { type: "array", minItems: 1, maxItems: 64, items: nyraDeepV2RequirementBinding },
  }, ["message", "branch_id", "subbranch_id", "evidence_pack", "requirement_bindings"]), ["core:govern"], false, false, {
    openWorld: true,
    meta: { "skinharmony/externalSideEffect": false },
  }),
  tool("nyra_v2_evaluate", "Evaluate a Deep V2 branch", "Ask Universal Core to resolve previously prepared tenant evidence, issue the operational attestation and call Nyra for a non-executing advisory evaluation. Raw evidence cannot be supplied here.", object({
    message: text(),
    request_id: nyraDeepV2RequestId,
    branch_id: identifier,
    subbranch_id: identifier,
    evidence_refs: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: nyraDeepV2EvidenceRef },
  }, ["message", "branch_id", "subbranch_id", "evidence_refs"]), ["core:govern"], false, false, {
    openWorld: true,
    meta: { "skinharmony/externalSideEffect": false },
  }),
  tool("skin_analyzer", "Interpret Skin Analyzer scores", "Read-only cosmetic interpretation of structured skin scores through the authenticated tenant Core branch; never diagnoses, prescribes or auto-publishes.", object({
    scores: { type: "array", minItems: 1, maxItems: 12, items: skinScore }, products: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } }, protocols: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } }, report_text: { type: "string", maxLength: 10_000 }, data_quality_score: score,
    acquisition: object({ device_model: { type: "string", maxLength: 120 }, capture_protocol_id: identifier, focus_score: score, illumination_score: score, color_calibrated: { type: "boolean" }, polarization: { type: "string", enum: ["polarized", "non_polarized", "mixed", "unknown"] } }), previous_scores: { type: "array", maxItems: 12, items: skinScore }, previous_acquisition: object({ device_model: { type: "string", maxLength: 120 }, capture_protocol_id: identifier }), learning_context: object({ outcome_verified: { type: "boolean" }, human_reviewed: { type: "boolean" }, comparable_capture_count: { type: "integer", minimum: 0, maximum: 1000000 } }), session_id: identifier,
  }, ["scores"]), ["core:read"], true, true),
  tool("scalp_analyzer", "Interpret Scalp Analyzer metrics", "Read-only Scalp v2 for medical-study documentation support, salon technical trichology and pharmacy dermocosmetic counselling. It never impersonates a physician, diagnoses, prescribes or auto-publishes marketing.", object({
    overall: scalpMetrics, zones: { type: "array", maxItems: 12, items: object({ zone: identifier, metrics: scalpMetrics }, ["zone", "metrics"]) }, acquisition: scalpAcquisition, previous: object({ overall: scalpMetrics, acquisition: scalpAcquisition }), reported_warning_signals: { type: "array", maxItems: 5, uniqueItems: true, items: { type: "string", enum: ["sudden_change", "pain", "bleeding", "open_lesion", "infection_suspected"] } }, professional_profile: { type: "string", enum: ["medical_study", "salon_trichology", "pharmacy_dermocosmetic"] }, learning_context: object({ outcome_verified: { type: "boolean" }, human_reviewed: { type: "boolean" }, comparable_capture_count: { type: "integer", minimum: 0, maximum: 1000000 } }), locale: { type: "string", enum: ["it", "en"] }, session_id: identifier,
  }, ["overall"]), ["core:read"], true, true),
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

  tool("agent_heartbeat", "Register unique agent presence", "Register or refresh one uniquely signed session. A pre-issued, consumed Genesis-bound Causal Context may recover presence only; it never authorizes host actions, publishing or deployment.", object({ agent_id: identifier, client_type: { type: "string", enum: ["chatgpt", "codex", "api_agent", "other"] }, session_id: { type: "string", minLength: 1, maxLength: 240 }, display_name: { type: "string", maxLength: 120 }, capabilities: { type: "array", maxItems: 20, items: identifier }, recovery_context: object({ envelope: { type: "object", additionalProperties: true }, signature: { anyOf: [{ type: "string", pattern: "^hnc_[a-f0-9]{64}$" }, object({ key_id: identifier, digest: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["key_id", "digest"])] } }, ["envelope", "signature"]) }, ["agent_id", "client_type"]), ["core:govern"], false, true),
  tool("agent_list", "List tenant agents", "List registered agents and their last heartbeat in the authenticated tenant.", object(), ["core:read"]),
  tool("message_post", "Post agent message", "Post a tenant-scoped message from a registered agent to another agent or all agents.", object({ from_agent_id: identifier, to_agent_id: { anyOf: [identifier, { const: "all" }] }, body: text(20_000), thread_id: { type: "string", maxLength: 80 }, idempotency_key: { type: "string", maxLength: 120 } }, ["from_agent_id", "body"]), ["core:govern"], false, true),
  tool("message_inbox", "Read agent inbox", "Read tenant-scoped messages addressed to one agent or all agents.", object({ agent_id: identifier, unread_only: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["agent_id"]), ["core:read"]),
  tool("message_acknowledge", "Acknowledge agent message", "Mark one tenant-scoped agent message as read.", object({ message_id: text(80), agent_id: identifier }, ["message_id", "agent_id"]), ["core:govern"], false, true)
,
  tool("web_compatibility_manifest", "Read Web Agent Compatibility branches", "Read the governed web compatibility contract for browser transport, structured ingestion and long URL continuity.", object(), ["core:read"], true, true, { meta: { "skinharmony/webCompatibility": true } }),
  tool("web_compatibility_execute", "Execute a governed web compatibility request", "Fetch an allowlisted web origin with cookie persistence, GET/POST support and JSON-LD preservation. Universal Core gates the request before transport and the result remains tenant-scoped.", object({
    url: { type: "string", format: "uri", maxLength: 8192 },
    method: { type: "string", enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] },
    headers: { type: "object", maxProperties: 30, additionalProperties: { type: "string", maxLength: 2000 } },
    body: { type: "string", maxLength: 2000000 },
  }, ["url"], ["core:govern"], false, true, { openWorld: true, meta: { "skinharmony/webCompatibility": true, "skinharmony/dedicatedCoreGate": true } })),
];
