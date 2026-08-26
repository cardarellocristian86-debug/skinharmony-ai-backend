import { indexSoftwareDiff, softwareDigest, validateGraphMutation } from "../../universal-core-service/src/softwareCognition.js";

const identifier = { type: "string", minLength: 1, maxLength: 160 };
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const stringList = { type: "array", maxItems: 500, uniqueItems: true, items: identifier };
const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const payload = { type: "object", maxProperties: 300, additionalProperties: true };
const GITHUB_ORIGIN = "https://api.github.com";
const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_SHA = /^[a-f0-9]{40}$/;
// One request maps to one Atlas transaction. Keeping the page deliberately
// small makes a retry idempotent without a half-written sub-batch.
const ATLAS_BOOTSTRAP_FILE_LIMIT = 8;
const ATLAS_BOOTSTRAP_FILE_BYTES = 96_000;
const ATLAS_BOOTSTRAP_TOTAL_BYTES = 1_000_000;
const ATLAS_BOOTSTRAP_FRONTIER_LIMIT = 2_048;
const ATLAS_BOOTSTRAP_DIRECTORY_READ_LIMIT = 128;

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
  ["nyra_precore_decision_generate", "Generate signed pre-Core decision", "Generate a purpose-signed append-only Nyra advisory decision from server-read authorities; never authorizes execution.", object({ ...base,
    disposition: { type: "string", enum: ["PROPOSE", "CHALLENGE", "ABSTAIN", "RECOMMEND_BLOCK"] }, recommendation: { type: "string", minLength: 1, maxLength: 8000 },
    rationale: { type: "array", maxItems: 50, items: { type: "string", minLength: 1, maxLength: 2000 } }, uncertainties: stringList,
    evidence_refs: { type: "array", maxItems: 100, uniqueItems: true, items: digest }, expected_sequence: { type: "integer", minimum: 0 },
    expected_parent_digest: { anyOf: [digest, { type: "null" }] }, supersedes_decision_id: identifier, idempotency_key: identifier,
    risks: stringList, conditions: stringList, rollback_requirements: stringList }, ["project_id", "work_id", "change_id", "plan_id", "disposition", "recommendation", "expected_sequence", "idempotency_key"]), false],
  ["nyra_precore_decision_read", "Read signed pre-Core decision", "Read one exact signed advisory decision from the Work Continuity receipt chain.", object({ ...base, decision_id: identifier }, ["project_id", "work_id", "change_id", "plan_id", "decision_id"]), true],
  ["nyra_precore_decision_list", "List signed pre-Core decisions", "List the bounded append-only advisory decision history for an exact Work and Native Plan.", object({ ...base,
    limit: { type: "integer", minimum: 1, maximum: 200 }, before_sequence: { type: "integer", minimum: 1 } }, ["project_id", "work_id", "change_id", "plan_id"]), true],
  ["nyra_precore_decision_verify", "Verify signed pre-Core decision", "Verify signature, chain head, scope and current server-read authority bindings; superseded or stale records are invalid.", object({ ...base, decision_id: identifier }, ["project_id", "work_id", "change_id", "plan_id", "decision_id"]), true],
  ["software_cognition_closure_evaluate", "Evaluate software closure", "Re-read Native Plan, Atlas, Causal and ICF evidence in one snapshot and derive advisory readiness.", object({ ...base, intent_binding: payload, icf_required: { type: "boolean" }, icf_binding: payload }, ["project_id", "work_id", "change_id", "plan_id"]), false],
];

const atlasBootstrapDefinition = ["software_cognition_repository_bootstrap", "Bootstrap Software/Architecture Atlas", "Read one bounded, server-fetched repository snapshot batch and persist only the derived Work Atlas graph and digests. Source text is never returned or persisted. Continue with the returned cursor until completed.", object({
  project_id: identifier, work_id: identifier, repository: identifier,
  branch: { type: "string", minLength: 1, maxLength: 240 },
  cursor: { type: "integer", minimum: 0 },
  snapshot_commit: { type: "string", pattern: "^[a-f0-9]{40}$" },
  snapshot_tree_sha: { type: "string", pattern: "^[a-f0-9]{40}$" },
  file_limit: { type: "integer", minimum: 1, maximum: ATLAS_BOOTSTRAP_FILE_LIMIT },
  idempotency_key: identifier,
}, ["project_id", "work_id", "repository", "idempotency_key"]), false];

export const SOFTWARE_COGNITION_TOOLS = Object.freeze([...definitions.map((entry) => tool(...entry)), tool(...atlasBootstrapDefinition)]);

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
  nyra_precore_decision_generate: "/v1/nyra-precore-decisions/generate",
  nyra_precore_decision_read: "/v1/nyra-precore-decisions/read",
  nyra_precore_decision_list: "/v1/nyra-precore-decisions/list",
  nyra_precore_decision_verify: "/v1/nyra-precore-decisions/verify",
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

function bootstrapFail(code) { throw new Error(code); }

function bootstrapRepository(value) {
  const repository = String(value || "").trim();
  if (!GITHUB_REPOSITORY.test(repository)) bootstrapFail("software_atlas_repository_invalid");
  return repository;
}

function bootstrapBranch(value) {
  const branch = String(value || "main").trim();
  if (!branch || branch.length > 240 || branch.includes("\u0000")) bootstrapFail("software_atlas_branch_invalid");
  return branch;
}

function bootstrapPath(value) {
  const path = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.length > 2_000 || path.includes("\u0000") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    bootstrapFail("software_atlas_source_path_invalid");
  }
  return path;
}

function excludedArchitecturePath(path) {
  return /(^|\/)(?:node_modules|\.git|dist|build|coverage|vendor|shared-work-memory|test|tests|__tests__|fixtures|reports)(?:\/|$)/i.test(path);
}

function architectureDocumentationPath(path) {
  if (!path.startsWith("docs/")) return true;
  if (path.startsWith("docs/architecture/") || path.startsWith("docs/adr/")) return true;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return /(?:^|[_-])(?:architecture|architectural|adr|design|topology|runtime|system|service|boundary|decision)(?:[_\-.]|$)/i.test(basename);
}

function indexableSnapshotPath(path) {
  // The Atlas represents the architecture of the repository, not mutable
  // work-memory, test fixtures, reports, or generated delivery artifacts.
  // Keeping those out avoids a high-volume, low-signal graph while retaining
  // runtime source, deployment configuration, database definitions and the
  // architecture documentation that describes their boundaries.
  if (excludedArchitecturePath(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path)) return false;
  if (!architectureDocumentationPath(path)) return false;
  return /(?:\.[cm]?[jt]sx?|\.json|\.ya?ml|\.sql|\.md)$/i.test(path);
}

function analyzableSourcePath(path) {
  return /\.[cm]?[jt]sx?$/i.test(path);
}

function treePath(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

function normalizeTreeFrontier(value, rootTreeSha) {
  const source = value && typeof value === "object" ? value : {};
  const directories = Array.isArray(source.directories) ? source.directories : [{ path: "", tree_sha: rootTreeSha, offset: 0 }];
  if (!directories.length || directories.length > ATLAS_BOOTSTRAP_FRONTIER_LIMIT) bootstrapFail("software_atlas_tree_frontier_invalid");
  const normalized = directories.map((entry) => {
    const path = String(entry?.path || "");
    const treeSha = String(entry?.tree_sha || "").toLowerCase();
    const offset = Number(entry?.offset || 0);
    if ((path && bootstrapPath(path) !== path) || !GITHUB_SHA.test(treeSha) || !Number.isSafeInteger(offset) || offset < 0) {
      bootstrapFail("software_atlas_tree_frontier_invalid");
    }
    return { path, tree_sha: treeSha, offset };
  });
  const sourceFilesSeen = Number(source.source_files_seen || 0);
  if (!Number.isSafeInteger(sourceFilesSeen) || sourceFilesSeen < 0) bootstrapFail("software_atlas_tree_frontier_invalid");
  return { directories: normalized, source_files_seen: sourceFilesSeen };
}

async function githubJson(fetchImpl, url, token = "", { oversizeAsNull = false } = {}) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "skinharmony-nyra-atlas-bootstrap-v1",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response?.ok) bootstrapFail("software_atlas_repository_read_unavailable");
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > ATLAS_BOOTSTRAP_TOTAL_BYTES) {
    // A single repository file can legitimately exceed the bounded Atlas
    // transport budget.  It is not a repository failure: callers that are
    // reading a source file may record it as skipped and advance the pinned
    // cursor.  Commit and tree reads remain fail-closed.
    if (oversizeAsNull) return null;
    bootstrapFail("software_atlas_repository_response_too_large");
  }
  try { return JSON.parse(body); } catch { bootstrapFail("software_atlas_repository_response_invalid"); }
}

async function readRepositorySnapshot(fetchImpl, repository, ref, expectedTreeSha, token) {
  const commit = await githubJson(fetchImpl, `${GITHUB_ORIGIN}/repos/${repository}/commits/${encodeURIComponent(ref)}`, token);
  const commitSha = String(commit?.sha || "").toLowerCase();
  const treeSha = String(commit?.commit?.tree?.sha || "").toLowerCase();
  if (!GITHUB_SHA.test(commitSha) || !GITHUB_SHA.test(treeSha)) bootstrapFail("software_atlas_repository_commit_invalid");
  if (expectedTreeSha && treeSha !== expectedTreeSha) bootstrapFail("software_atlas_snapshot_tree_mismatch");
  return { commit: commitSha, tree_sha: treeSha };
}

async function readRepositoryPathsBatch(fetchImpl, repository, treeSha, frontierValue, fileLimit, token) {
  const frontier = normalizeTreeFrontier(frontierValue, treeSha);
  const paths = [];
  let directoryReads = 0;
  while (paths.length < fileLimit && frontier.directories.length) {
    if (directoryReads >= ATLAS_BOOTSTRAP_DIRECTORY_READ_LIMIT) bootstrapFail("software_atlas_tree_walk_limit");
    const current = frontier.directories[0];
    const tree = await githubJson(fetchImpl, `${GITHUB_ORIGIN}/repos/${repository}/git/trees/${current.tree_sha}`, token);
    if (tree?.truncated === true || !Array.isArray(tree?.tree)) bootstrapFail("software_atlas_repository_tree_incomplete");
    directoryReads += 1;
    const entries = [...tree.tree].sort((left, right) => String(left?.path || "").localeCompare(String(right?.path || "")));
    for (let index = current.offset; index < entries.length; index += 1) {
      const entry = entries[index] || {};
      current.offset = index + 1;
      const name = bootstrapPath(entry.path);
      const path = treePath(current.path, name);
      const entrySha = String(entry.sha || "").toLowerCase();
      if (entry.type === "tree") {
        if (excludedArchitecturePath(path)) continue;
        if (!GITHUB_SHA.test(entrySha)) bootstrapFail("software_atlas_repository_tree_invalid");
        frontier.directories.push({ path, tree_sha: entrySha, offset: 0 });
        if (frontier.directories.length > ATLAS_BOOTSTRAP_FRONTIER_LIMIT) bootstrapFail("software_atlas_tree_frontier_limit");
        continue;
      }
      if (entry.type !== "blob" || String(entry.mode || "") === "120000" || !indexableSnapshotPath(path)) continue;
      if (analyzableSourcePath(path)) frontier.source_files_seen += 1;
      paths.push(path);
      if (paths.length >= fileLimit) break;
    }
    if (current.offset >= entries.length) frontier.directories.shift();
  }
  if (!paths.length && !frontier.directories.length && !frontier.source_files_seen) {
    bootstrapFail("software_atlas_repository_unsupported");
  }
  return { paths, frontier, completed: frontier.directories.length === 0 };
}

async function readSnapshotFile(fetchImpl, repository, commit, path, token) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const payload = await githubJson(
    fetchImpl,
    `${GITHUB_ORIGIN}/repos/${repository}/contents/${encodedPath}?ref=${commit}`,
    token,
    { oversizeAsNull: true },
  );
  if (!payload) return null;
  if (payload?.type !== "file" || payload?.encoding !== "base64" || typeof payload?.content !== "string") {
    // A pinned tree entry may become non-readable through the Contents API
    // (for example an unsupported file representation). It is not an
    // integrity failure: retain the checkpoint and let a later bounded pass
    // skip this one path rather than abandoning the whole Atlas bootstrap.
    return null;
  }
  const content = Buffer.from(payload.content.replace(/\s/g, ""), "base64");
  if (!content.length || content.length > ATLAS_BOOTSTRAP_FILE_BYTES || content.includes(0)) return null;
  return { path, status: "modified", content: content.toString("utf8") };
}

function mergeIndexedBatch(items) {
  const nodes = [...new Map(items.flatMap((item) => item.nodes_added_or_updated).map((node) => [node.node_id, node])).values()];
  const edges = [...new Map(items.flatMap((item) => item.edges_added).map((edge) => [`${edge.edge_type}:${edge.from_node_id}:${edge.to_node_id}`, edge])).values()];
  return { nodes, edges };
}

function repositoryBinding(repositoryBindings, projectId, repository, branch, tenantId, githubTokens) {
  const binding = repositoryBindings?.[projectId];
  if (!binding) bootstrapFail("software_atlas_repository_binding_missing");
  if (binding.repository !== repository || binding.branch !== branch) {
    bootstrapFail("software_atlas_repository_binding_mismatch");
  }
  const credentialTenantId = binding.credentialTenantId || tenantId;
  return { binding, token: String(githubTokens?.[credentialTenantId] || "").trim() };
}

function bootstrapResult(value) { return textResult({
  schema_version: "software_repository_atlas_bootstrap_v2",
  source_text_persisted: false,
  execution_authorized: false,
  external_action_authorized: false,
  ...value,
}); }

async function bootstrapRepositoryAtlas({ args, identity, atlasRuntime, fetchImpl, repositoryBindings, githubTokens }) {
  if (!atlasRuntime || typeof atlasRuntime.readAtlasGraph !== "function" || typeof atlasRuntime.upsertAtlas !== "function") {
    bootstrapFail("software_atlas_runtime_required");
  }
  if (typeof fetchImpl !== "function") bootstrapFail("software_atlas_repository_fetch_unavailable");
  const tenantId = String(identity?.tenantId || "").trim();
  if (!tenantId || !identity.agentPresence) bootstrapFail("agent_presence_session_required");
  const projectId = String(args.project_id || "").trim();
  const workId = String(args.work_id || "").trim();
  const repository = bootstrapRepository(args.repository);
  const branch = bootstrapBranch(args.branch);
  const cursor = Number(args.cursor || 0);
  const fileLimit = Math.min(Math.max(Number(args.file_limit || 20), 1), ATLAS_BOOTSTRAP_FILE_LIMIT);
  if (!Number.isSafeInteger(cursor) || cursor < 0) bootstrapFail("software_atlas_cursor_invalid");
  if (typeof atlasRuntime.readIntent !== "function") bootstrapFail("software_atlas_work_binding_required");
  const intent = await atlasRuntime.readIntent(identity, { work_id: workId });
  if (String(intent?.project_id || "") !== projectId) bootstrapFail("continuity_project_mismatch");
  const { token } = repositoryBinding(repositoryBindings, projectId, repository, branch, tenantId, githubTokens);
  const suppliedCommit = String(args.snapshot_commit || "").toLowerCase();
  const suppliedTreeSha = String(args.snapshot_tree_sha || "").toLowerCase();
  if (cursor > 0 && (!GITHUB_SHA.test(suppliedCommit) || !GITHUB_SHA.test(suppliedTreeSha))) {
    bootstrapFail("software_atlas_snapshot_required");
  }
  const snapshot = await readRepositorySnapshot(fetchImpl, repository, cursor > 0 ? suppliedCommit : branch, cursor > 0 ? suppliedTreeSha : "", token);
  if (cursor > 0 && snapshot.commit !== suppliedCommit) bootstrapFail("software_atlas_snapshot_commit_mismatch");
  const sourceHash = softwareDigest({ schema_version: "software_repository_architecture_snapshot_v2", repository, commit: snapshot.commit, tree_sha: snapshot.tree_sha });
  let graph;
  try { graph = await atlasRuntime.readAtlasGraph(identity, { project_id: projectId, work_id: workId }); }
  catch (error) { if (error?.message !== "work_atlas_not_found") throw error; graph = { revision: 0, nodes: [], edges: [] }; }
  const bootstrap = graph.bootstrap || null;
  if (bootstrap && (bootstrap.repository !== repository || bootstrap.commit !== snapshot.commit || bootstrap.tree_sha !== snapshot.tree_sha)) {
    if (cursor > 0) bootstrapFail("software_atlas_snapshot_binding_mismatch");
  }
  const nextPersistedCursor = Number(bootstrap?.next_cursor || 0);
  if (bootstrap?.state === "available" && bootstrap?.source_hash === sourceHash) {
    return bootstrapResult({ tenant_id: tenantId, project_id: projectId, work_id: workId, repository, branch,
      snapshot_commit: snapshot.commit, snapshot_tree_sha: snapshot.tree_sha, source_hash: sourceHash,
      cursor, next_cursor: null, completed: true, already_applied: true, atlas_revision: Number(graph.revision || 0),
      total_nodes: Number(graph.metrics?.total_nodes || 0), total_context_bytes: Number(graph.metrics?.total_context_bytes || 0) });
  }
  if (cursor < nextPersistedCursor && bootstrap?.source_hash === sourceHash) {
    return bootstrapResult({ tenant_id: tenantId, project_id: projectId, work_id: workId, repository, branch,
      snapshot_commit: snapshot.commit, snapshot_tree_sha: snapshot.tree_sha, source_hash: sourceHash,
      cursor, next_cursor: nextPersistedCursor, completed: false, already_applied: true, atlas_revision: Number(graph.revision || 0),
      total_nodes: Number(graph.metrics?.total_nodes || 0), total_context_bytes: Number(graph.metrics?.total_context_bytes || 0) });
  }
  if (cursor > nextPersistedCursor) bootstrapFail("software_atlas_cursor_out_of_sequence");
  if (cursor > 0 && (bootstrap?.state !== "indexing" || !bootstrap?.frontier || bootstrap?.source_hash !== sourceHash)) {
    bootstrapFail("software_atlas_snapshot_binding_mismatch");
  }
  const enumeration = await readRepositoryPathsBatch(
    fetchImpl,
    repository,
    snapshot.tree_sha,
    cursor > 0 ? bootstrap.frontier : null,
    fileLimit,
    token,
  );
  // A repository made only of supported-looking configuration files is not an
  // architecture source index.  Do not mark it available merely because the
  // final page happened to contain a non-source file: at least one JS/TS
  // source file must have been observed across the pinned snapshot.
  if (enumeration.completed && !enumeration.frontier.source_files_seen) {
    bootstrapFail("software_atlas_repository_unsupported");
  }
  const paths = enumeration.paths;
  if (!paths.length) bootstrapFail("software_atlas_repository_empty_batch");
  let revision = Number(graph.revision || 0);
  const indexed = [];
  const skipped = [];
  let totalBytes = 0;
  for (const path of paths) {
    const file = await readSnapshotFile(fetchImpl, repository, snapshot.commit, path, token);
    if (!file) { skipped.push(path); continue; }
    totalBytes += Buffer.byteLength(file.content, "utf8");
    if (totalBytes > ATLAS_BOOTSTRAP_TOTAL_BYTES) { skipped.push(path); continue; }
    const result = indexSoftwareDiff({ tenant_id: tenantId, project_id: projectId, work_id: workId, repository,
      base_commit: snapshot.commit, head_commit: snapshot.commit, known_graph_revision: revision, changed_files: [file] });
    if (result.nodes_added_or_updated.length > 500 || result.edges_added.length > 2_000) bootstrapFail("software_atlas_file_too_complex");
    indexed.push(result);
  }
  const batch = mergeIndexedBatch(indexed);
  if (batch.nodes.length > 500 || batch.edges.length > 2_000) bootstrapFail("software_atlas_batch_too_large");
  const completed = enumeration.completed;
  const nextCursor = completed ? null : cursor + paths.length;
  const firstPage = cursor === 0;
  const batchNodeIds = new Set(batch.nodes.map((node) => node.node_id));
  const edges = firstPage ? batch.edges.filter((edge) => batchNodeIds.has(edge.from_node_id) && batchNodeIds.has(edge.to_node_id)) : batch.edges;
  const written = await atlasRuntime.upsertAtlas(identity, {
    work_id: workId, expected_revision: revision, nodes: batch.nodes.map(atlasNode), edges: edges.map(atlasEdge),
    allow_existing_edge_nodes: !firstPage, replace: firstPage, replace_snapshot_nodes: firstPage, source_hash: sourceHash,
    base_commit: snapshot.commit, head_commit: snapshot.commit,
    bootstrap: { state: completed ? "available" : "indexing", repository, commit: snapshot.commit, tree_sha: snapshot.tree_sha,
      source_hash: sourceHash, cursor, next_cursor: nextCursor, total_candidate_files: completed ? cursor + paths.length : null,
      frontier: enumeration.frontier },
    idempotency_key: `atlas-bootstrap-${softwareDigest({ workId, sourceHash, cursor, nodes: batch.nodes.map((node) => node.node_id) })}`,
  });
  revision = Number(written.revision);
  return bootstrapResult({ tenant_id: tenantId, project_id: projectId, work_id: workId,
    repository, branch, snapshot_commit: snapshot.commit, snapshot_tree_sha: snapshot.tree_sha, source_hash: sourceHash,
    cursor, next_cursor: nextCursor,
    completed, total_candidate_files: completed ? cursor + paths.length : null,
    processed_files: indexed.length, skipped_paths: skipped, bytes_analyzed: totalBytes,
    atlas_revision: revision, total_nodes: written?.total_nodes || Number(graph?.metrics?.total_nodes || 0),
    total_context_bytes: written?.total_context_bytes || Number(graph?.metrics?.total_context_bytes || 0),
    seed_node_ids: indexed.flatMap((item) => item.affected_seeds).slice(0, 20),
  });
}

export function createSoftwareCognitionHandlers({ coreRequest, issueAgentContext, atlasRuntime, fetchImpl = globalThis.fetch, repositoryBindings = {}, githubTokens = {} } = {}) {
  if (typeof coreRequest !== "function" || typeof issueAgentContext !== "function") throw new TypeError("software cognition transport required");
  const handlers = Object.fromEntries(definitions.map(([capabilityId]) => [capabilityId, async (args = {}, identity = {}) => {
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
  handlers.software_cognition_repository_bootstrap = async (args = {}, identity = {}) => bootstrapRepositoryAtlas({
    args, identity, atlasRuntime, fetchImpl, repositoryBindings, githubTokens,
  });
  return handlers;
}
