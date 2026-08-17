const identifier = { type: "string", minLength: 1, maxLength: 160 };
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const stringList = { type: "array", maxItems: 500, uniqueItems: true, items: identifier };
const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const payload = { type: "object", maxProperties: 300, additionalProperties: true };

function tool(name, title, description, inputSchema, readOnly) {
  return {
    name, title, description, inputSchema,
    outputSchema: { type: "object", additionalProperties: true },
    scopes: [readOnly ? "core:read" : "core:govern"],
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  };
}

const base = { project_id: identifier, work_id: identifier, change_id: identifier, plan_id: identifier };
const definitions = [
  ["software_cognition_graph_upsert", "Update Software Reality Graph", "CAS-update the exact Work Atlas graph only after Core verifies source evidence.", object({ ...base, source_evidence_digest: digest, expected_revision: { type: "integer", minimum: 0 }, nodes: { type: "array", minItems: 1, maxItems: 500, items: payload }, edges: { type: "array", maxItems: 2000, items: payload }, idempotency_key: identifier }, ["project_id", "work_id", "change_id", "plan_id", "source_evidence_digest", "expected_revision", "nodes", "edges", "idempotency_key"]), false],
  ["software_cognition_index_diff", "Index software diff", "Index an independently evidenced bounded JS/TS diff into the exact Work Atlas revision.", object({ ...base, diff_evidence_digest: digest, repository: identifier, base_commit: identifier, head_commit: identifier, known_graph_revision: { type: "integer", minimum: 0 }, changed_files: { type: "array", minItems: 1, maxItems: 500, items: payload }, idempotency_key: identifier }, ["project_id", "work_id", "change_id", "plan_id", "diff_evidence_digest", "repository", "base_commit", "head_commit", "known_graph_revision", "changed_files", "idempotency_key"]), false],
  ["software_cognition_graph_select", "Select bounded software context", "Select seed nodes and a bounded dependency cone from Work Atlas.", object({ project_id: identifier, work_id: identifier, seed_node_ids: stringList, edge_types: stringList, max_depth: { type: "integer", minimum: 0, maximum: 4 }, max_nodes: { type: "integer", minimum: 1, maximum: 500 }, max_bytes: { type: "integer", minimum: 256, maximum: 128000 } }, ["project_id", "work_id", "seed_node_ids"]), true],
  ["software_cognition_traceability_build", "Build requirement traceability", "Build evidence-qualified requirement, capability, code, test and runtime links from Work Atlas.", object({ ...base, links: { type: "array", maxItems: 2000, items: payload } }, ["project_id", "work_id", "change_id", "plan_id", "links"]), false],
  ["software_cognition_architecture_recover", "Recover software architecture", "Recover observed and inferred boundaries, layers and coupling with evidence-gated verification.", object({ ...base, verification_evidence: { type: "array", maxItems: 1000, items: payload } }, ["project_id", "work_id", "change_id", "plan_id"]), false],
  ["software_cognition_event_route", "Route software cognition event", "Select a bounded relevant Atlas context and recommend the next advisory capability.", object({ ...base, event: payload, max_depth: { type: "integer", minimum: 0, maximum: 4 }, max_nodes: { type: "integer", minimum: 1, maximum: 500 } }, ["project_id", "work_id", "change_id", "plan_id", "event"]), false],
  ["software_cognition_calibration_update", "Update verified calibration", "Calculate supervision calibration only from independently verified Causal outcomes.", object({ ...base, cases: { type: "array", maxItems: 1000, items: payload } }, ["project_id", "work_id", "change_id", "plan_id", "cases"]), false],
  ["software_cognition_impact_predict", "Predict software impact", "Calculate deterministic impact from the bound Atlas revision.", object({ ...base, expected_revision: { type: "integer", minimum: 0 }, seed_node_ids: stringList, max_depth: { type: "integer", minimum: 0, maximum: 4 }, max_nodes: { type: "integer", minimum: 1, maximum: 500 } }, ["project_id", "work_id", "change_id", "plan_id", "expected_revision", "seed_node_ids"]), false],
  ["software_cognition_impact_reconcile", "Reconcile predicted and actual change", "Compare persisted predicted impact to the evidence-bound actual change graph.", object({ ...base, actual: payload }, ["project_id", "work_id", "change_id", "plan_id", "actual"]), false],
  ["software_cognition_obligation_expand", "Expand software obligations", "Derive proposals from the persisted impact receipt and current Causal obligations without granting closure authority.", object({ ...base }, ["project_id", "work_id", "change_id", "plan_id"]), true],
  ["software_cognition_obligation_coverage", "Calculate obligation coverage", "Derive weighted coverage exclusively from persisted Causal obligations.", object({ ...base }, ["project_id", "work_id", "change_id", "plan_id"]), false],
  ["software_cognition_plan_record", "Read bound worker plan contract", "Validate and return the immutable software contract embedded in the existing Native Plan.", object({ ...base, base_state_digest: digest }, ["project_id", "work_id", "change_id", "plan_id", "base_state_digest"]), true],
  ["software_cognition_supervise", "Run Nyra software supervision", "Create explicit claims, hypotheses, risks and challenges from persisted Native Plan, impact, Causal obligations, Intent and ICF bindings.", object({ ...base }, ["project_id", "work_id", "change_id", "plan_id"]), false],
  ["software_cognition_challenge_read", "Read supervisory challenges", "Read persisted native-plan-scoped challenges.", object({ ...base }, ["project_id", "work_id", "change_id", "plan_id"]), true],
  ["software_cognition_challenge_resolve", "Resolve supervisory challenge", "Accept or evidence-bound rebut one challenge with CAS and anti-replay semantics.", object({ ...base, challenge_id: identifier, resolution: payload }, ["project_id", "work_id", "change_id", "plan_id", "challenge_id", "resolution"]), false],
  ["software_cognition_runtime_observe", "Record software runtime observation", "Bind Causal runtime evidence to the exact native plan and Atlas digest.", object({ ...base, graph_digest: digest, observation: payload, verification: payload }, ["project_id", "work_id", "change_id", "plan_id", "graph_digest", "observation", "verification"]), false],
  ["software_cognition_learning_promote", "Promote verified software learning", "Promote only learning backed by server-read independent Causal evidence; never mutate model weights.", object({ ...base, evidence_digest: digest, candidate: payload }, ["project_id", "work_id", "change_id", "plan_id", "evidence_digest"]), false],
  ["software_cognition_research_plan", "Plan governed software research", "Detect the bounded technology context and open a multi-source public Research Airlock plan; never authorize execution.", object({ ...base, question: { type: "string", minLength: 1, maxLength: 8000 }, risk_tier: { type: "string", enum: ["normal", "high", "security_critical"] }, expected_revision: { type: "integer", minimum: 0 }, technology_hints: { type: "array", maxItems: 20, uniqueItems: true, items: identifier }, version_context: payload, additional_source_urls: { type: "array", maxItems: 10, uniqueItems: true, items: { type: "string", format: "uri", maxLength: 2000 } } }, ["project_id", "work_id", "change_id", "plan_id", "question"]), false],
  ["software_cognition_technology_profile", "Read software technology profiles", "Detect languages and return bounded sandbox adapter contracts for versions, manifests, parsers, compilers, lint, tests, dependencies and governed sources.", object({ project_id: identifier, work_id: identifier, technology_hints: { type: "array", maxItems: 20, uniqueItems: true, items: identifier } }, ["project_id", "work_id"]), true],
  ["software_cognition_technology_verify", "Bind technology adapter evidence", "Bind independently verified sandbox receipts for version, manifest, compiler, lint, tests and dependencies to the exact research plan.", object({ ...base, research_plan_digest: digest, evidence_digest: digest, profile_results: { type: "array", minItems: 1, maxItems: 20, items: payload } }, ["project_id", "work_id", "change_id", "plan_id", "research_plan_digest", "evidence_digest", "profile_results"]), false],
  ["software_cognition_research_bind", "Bind sealed software research", "Verify and bind an exact signed Research Airlock evidence capsule to the current software Work and Native Plan.", object({ ...base, research_plan_digest: digest, capsule: payload }, ["project_id", "work_id", "change_id", "plan_id", "research_plan_digest", "capsule"]), false],
  ["software_cognition_precore_decide", "Issue provisional Nyra decision", "Issue an append-only evidence-bound Nyra recommendation before Core approval; execution is always unauthorized.", object({ ...base, disposition: { type: "string", enum: ["PROPOSE", "CHALLENGE", "ABSTAIN", "RECOMMEND_BLOCK"] }, recommendation: { type: "string", minLength: 1, maxLength: 8000 }, rationale: { type: "array", maxItems: 50, items: { type: "string", minLength: 1, maxLength: 2000 } }, uncertainties: { type: "array", maxItems: 50, items: { type: "string", minLength: 1, maxLength: 500 } }, evidence_refs: { type: "array", maxItems: 100, uniqueItems: true, items: digest } }, ["project_id", "work_id", "change_id", "plan_id", "disposition", "recommendation"]), false],
  ["software_cognition_precore_read", "Read provisional Nyra decisions", "Read append-only provisional decisions for the exact Work and Native Plan.", object({ ...base }, ["project_id", "work_id", "change_id", "plan_id"]), true],
  ["software_cognition_closure_evaluate", "Evaluate software closure", "Re-read Native Plan, Atlas, Causal and ICF evidence in one snapshot and derive advisory readiness.", object({ ...base, intent_binding: payload, icf_required: { type: "boolean" }, icf_binding: payload }, ["project_id", "work_id", "change_id", "plan_id"]), false],
];

export const SOFTWARE_COGNITION_TOOLS = Object.freeze(definitions.map((entry) => tool(...entry)));

const paths = Object.freeze({
  software_cognition_graph_upsert: "/v1/software-cognition/graphs/upsert",
  software_cognition_index_diff: "/v1/software-cognition/graphs/index-diff",
  software_cognition_graph_select: "/v1/software-cognition/graphs/select",
  software_cognition_traceability_build: "/v1/software-cognition/traceability/build",
  software_cognition_architecture_recover: "/v1/software-cognition/architecture/recover",
  software_cognition_event_route: "/v1/software-cognition/events/route",
  software_cognition_calibration_update: "/v1/software-cognition/calibration/update",
  software_cognition_impact_predict: "/v1/software-cognition/impacts/predict",
  software_cognition_impact_reconcile: "/v1/software-cognition/impacts/reconcile",
  software_cognition_obligation_expand: "/v1/software-cognition/obligations/expand",
  software_cognition_obligation_coverage: "/v1/software-cognition/obligations/coverage",
  software_cognition_plan_record: "/v1/software-cognition/plans",
  software_cognition_supervise: "/v1/software-cognition/supervision",
  software_cognition_challenge_read: "/v1/software-cognition/challenges/read",
  software_cognition_challenge_resolve: "/v1/software-cognition/challenges/resolve",
  software_cognition_runtime_observe: "/v1/software-cognition/runtime-observations",
  software_cognition_learning_promote: "/v1/software-cognition/learning/promote",
  software_cognition_research_plan: "/v1/software-cognition/research/plan",
  software_cognition_technology_profile: "/v1/software-cognition/technology/profiles",
  software_cognition_technology_verify: "/v1/software-cognition/technology/verify",
  software_cognition_research_bind: "/v1/software-cognition/research/bind",
  software_cognition_precore_decide: "/v1/software-cognition/precore/decide",
  software_cognition_precore_read: "/v1/software-cognition/precore/read",
  software_cognition_closure_evaluate: "/v1/software-cognition/closure/evaluate",
});

const textResult = (value) => ({ structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] });

function atlasNode(node) {
  const [path, symbol = ""] = String(node.source_ref || "").split("#", 2);
  return { node_id: node.node_id, node_kind: node.kind, path, symbol, summary: String(node.payload?.summary || "").slice(0, 4_000),
    metadata: node.payload || {}, source_kind: node.source_kind, source_ref: node.source_ref, provenance: node.provenance || {},
    verification_state: node.source_kind === "git_diff" ? "observed" : "inferred_candidate", confidence: node.source_kind === "git_diff" ? 1 : 0.7 };
}
function atlasEdge(edge) { return { from_node_id: edge.from_node_id, to_node_id: edge.to_node_id, edge_type: edge.edge_type,
  provenance: edge.provenance || {}, verification_state: "inferred_candidate", confidence: 0.7 }; }

export function createSoftwareCognitionHandlers({ coreRequest, issueAgentContext, atlasRuntime } = {}) {
  if (typeof coreRequest !== "function" || typeof issueAgentContext !== "function") throw new TypeError("software cognition transport required");
  return Object.fromEntries(definitions.map(([capabilityId]) => [capabilityId, async (args = {}, identity = {}) => {
    const tenantId = String(identity?.tenantId || "").trim();
    if (!tenantId || !identity.agentPresence) throw new Error("agent_presence_session_required");
    const agentContext = issueAgentContext({ tenant_id: tenantId, agent_presence: identity.agentPresence });
    if (!agentContext) throw new Error("dtt_agent_identity_not_ready");
    const body = { ...args };
    delete body.tenant_id;
    delete body.tenantId;
    if (["software_cognition_graph_upsert", "software_cognition_index_diff", "software_cognition_graph_select"].includes(capabilityId)) {
      if (!atlasRuntime || typeof atlasRuntime.upsertAtlas !== "function" || typeof atlasRuntime.readAtlasGraph !== "function") throw new Error("software_atlas_runtime_required");
      if (capabilityId === "software_cognition_graph_select") {
        return textResult(await atlasRuntime.selectAtlas(identity, body));
      }
      const authorization = await coreRequest(paths[capabilityId], tenantId, { method: "POST", body: { ...body, authorize_only: true },
        additionalHeaders: { "x-sh-dtt-agent-context": agentContext } });
      const authority = authorization?.result || authorization;
      const evidenceDigest = body.diff_evidence_digest || body.source_evidence_digest;
      const subject = capabilityId === "software_cognition_index_diff"
        ? { repository: body.repository, base_commit: body.base_commit, head_commit: body.head_commit, changed_files: body.changed_files }
        : { expected_revision: body.expected_revision, nodes: body.nodes, edges: body.edges };
      const authorityMatchesRequest = authority?.schema_version === "software_atlas_mutation_authorization_v1" &&
        authority.authorized === true && authority.atlas_single_writer === "work_continuity_runtime" &&
        authority.tenant_id === tenantId && authority.project_id === body.project_id && authority.work_id === body.work_id &&
        authority.change_id === body.change_id && authority.evidence_digest === evidenceDigest &&
        authority.request_digest === softwareDigest(body) && authority.subject_digest === softwareDigest(subject);
      if (!authorityMatchesRequest) throw new Error("software_diff_evidence_not_authorized");
      let current;
      try { current = await atlasRuntime.readAtlasGraph(identity, body); }
      catch (error) { if (error?.message !== "work_atlas_not_found") throw error; current = { revision: 0, nodes: [], edges: [] }; }
      if (Number(body.expected_revision ?? body.known_graph_revision) !== Number(current.revision)) throw new Error("work_atlas_revision_conflict");
      let nodes; let edges; let sourceHash; let indexed = null;
      if (capabilityId === "software_cognition_index_diff") {
        indexed = indexSoftwareDiff({ ...body, tenant_id: tenantId, known_nodes: current.nodes, known_edges: current.edges });
        const removed = new Set(indexed.nodes_tombstoned.map((node) => node.node_id));
        nodes = [...new Map([...current.nodes.filter((node) => !removed.has(node.node_id)), ...indexed.nodes_added_or_updated].map((node) => [node.node_id, node])).values()];
        const removedEdges = new Set(indexed.edges_removed.map((edge) => `${edge.edge_type}:${edge.from_node_id}:${edge.to_node_id}`));
        edges = [...new Map([...current.edges.filter((edge) => !removedEdges.has(`${edge.edge_type}:${edge.from_node_id}:${edge.to_node_id}`) && !removed.has(edge.from_node_id) && !removed.has(edge.to_node_id)), ...indexed.edges_added]
          .map((edge) => [`${edge.edge_type}:${edge.from_node_id}:${edge.to_node_id}`, edge])).values()];
        sourceHash = indexed.source_digest;
      } else {
        const mutation = validateGraphMutation({ ...body, tenant_id: tenantId }, { currentRevision: current.revision, existingNodeIds: current.nodes.map((node) => node.node_id) });
        const changed = new Set(mutation.nodes.map((node) => node.node_id));
        nodes = [...current.nodes.filter((node) => !changed.has(node.node_id)), ...mutation.nodes].filter((node) => !node.tombstoned);
        const known = new Set(nodes.map((node) => node.node_id));
        edges = [...new Map([...current.edges.filter((edge) => known.has(edge.from_node_id) && known.has(edge.to_node_id)), ...mutation.edges]
          .map((edge) => [`${edge.edge_type}:${edge.from_node_id}:${edge.to_node_id}`, edge])).values()];
        sourceHash = softwareDigest(mutation);
      }
      if (!nodes.length) throw new Error("software_atlas_empty_graph_denied");
      const written = await atlasRuntime.upsertAtlas(identity, { work_id: body.work_id, expected_revision: current.revision,
        replace: true, nodes: nodes.map(atlasNode), edges: edges.map(atlasEdge), source_hash: sourceHash,
        base_commit: body.base_commit, head_commit: body.head_commit, idempotency_key: body.idempotency_key });
      return textResult(indexed ? { ...indexed, graph_revision: written.revision, atlas_event: written.event } : written);
    }
    const value = await coreRequest(paths[capabilityId], tenantId, { method: "POST", body, additionalHeaders: { "x-sh-dtt-agent-context": agentContext } });
    return textResult(value);
  }]));
}
import { indexSoftwareDiff, softwareDigest, validateGraphMutation } from "../../universal-core-service/src/softwareCognition.js";
