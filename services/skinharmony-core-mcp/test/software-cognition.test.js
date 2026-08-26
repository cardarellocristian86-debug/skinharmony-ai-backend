import assert from "node:assert/strict";
import test from "node:test";

import { SOFTWARE_COGNITION_TOOLS, createSoftwareCognitionHandlers } from "../src/software-cognition.js";
import { validateToolArguments } from "../src/schema-validation.js";

const EXPECTED = Object.freeze([
  "software_cognition_graph_upsert", "software_cognition_index_diff", "software_cognition_graph_select",
  "software_cognition_traceability_build", "software_cognition_architecture_recover", "software_cognition_event_route",
  "software_cognition_calibration_update",
  "software_cognition_impact_predict", "software_cognition_impact_reconcile", "software_cognition_obligation_expand",
  "software_cognition_obligation_coverage", "software_cognition_plan_record", "software_cognition_supervise",
  "software_cognition_challenge_read", "software_cognition_challenge_resolve", "software_cognition_runtime_observe",
  "software_cognition_learning_promote", "software_cognition_research_plan", "software_cognition_technology_profile", "software_cognition_technology_verify", "software_cognition_research_bind",
  "software_cognition_precore_decide", "software_cognition_precore_read", "nyra_precore_decision_generate", "nyra_precore_decision_read",
  "nyra_precore_decision_list", "nyra_precore_decision_verify", "software_cognition_closure_evaluate",
  "software_cognition_repository_bootstrap",
]);

const agentPresence = Object.freeze({
  agent_id: "agent-a", session_id: "session-a", session_fingerprint: "fingerprint-a",
  signature: "signature-a", actor_provenance: "codex:test", client_type: "codex",
});

test("software cognition MCP tools are bounded, strict and never host-authoritative", () => {
  assert.deepEqual(SOFTWARE_COGNITION_TOOLS.map((item) => item.name), EXPECTED);
  for (const item of SOFTWARE_COGNITION_TOOLS) {
    assert.equal(item.inputSchema.additionalProperties, false, item.name);
    assert.equal(item.annotations.destructiveHint, false, item.name);
    assert.equal(item.annotations.openWorldHint, false, item.name);
    assert.equal(item.scopes.length, 1, item.name);
  }
  const graphSchema = SOFTWARE_COGNITION_TOOLS.find((item) => item.name === "software_cognition_graph_upsert").inputSchema;
  assert.deepEqual(validateToolArguments(graphSchema, {
    project_id: "11111111-1111-4111-8111-111111111111", work_id: "22222222-2222-4222-8222-222222222222",
    change_id: "33333333-3333-4333-8333-333333333333", plan_id: "44444444-4444-4444-8444-444444444444",
    source_evidence_digest: "a".repeat(64), expected_revision: 0,
    nodes: [{ kind: "file", source_ref: "src/a.js" }], edges: [], idempotency_key: "graph-a",
  }), []);
  assert(validateToolArguments(graphSchema, {
    project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a", source_evidence_digest: "a".repeat(64),
    expected_revision: 0, nodes: [{ kind: "file", source_ref: "src/a.js" }], edges: [], idempotency_key: "graph-a", tenant_id: "spoofed",
  }).some((item) => item.code === "additional_property"));
});

test("transport derives tenant and signed DTT context exclusively from authenticated identity", async () => {
  const calls = [];
  const issued = [];
  const handlers = createSoftwareCognitionHandlers({
    coreRequest: async (...args) => { calls.push(args); return { ok: true, graph_revision: 1 }; },
    issueAgentContext: (value) => { issued.push(value); return "signed-context"; },
  });
  assert.deepEqual(Object.keys(handlers), EXPECTED);
  const result = await handlers.software_cognition_closure_evaluate({
    project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a", tenant_id: "spoofed",
  }, { tenantId: "tenant-a", agentPresence });
  assert.deepEqual(issued, [{ tenant_id: "tenant-a", agent_presence: agentPresence }]);
  assert.equal(calls[0][0], "/v1/software-cognition/closure/evaluate");
  assert.equal(calls[0][1], "tenant-a");
  assert.equal(calls[0][2].body.tenant_id, undefined);
  assert.equal(calls[0][2].additionalHeaders["x-sh-dtt-agent-context"], "signed-context");
  assert.deepEqual(result.structuredContent, { ok: true, graph_revision: 1 });
  await assert.rejects(() => handlers.software_cognition_graph_select({ project_id: "project-a", work_id: "work-a", seed_node_ids: [] }, {}), /agent_presence_session_required/);
});

test("Atlas writer rejects an authorization receipt for a different request", async () => {
  let writes = 0;
  const handlers = createSoftwareCognitionHandlers({
    coreRequest: async () => ({ authorized: true, schema_version: "software_atlas_mutation_authorization_v1",
      tenant_id: "tenant-a", project_id: "another-project", work_id: "work-a", change_id: "change-a",
      evidence_digest: "a".repeat(64), request_digest: "b".repeat(64), subject_digest: "c".repeat(64),
      atlas_single_writer: "work_continuity_runtime" }),
    issueAgentContext: () => "signed-context",
    atlasRuntime: { readAtlasGraph: async () => ({ revision: 0, nodes: [], edges: [] }), upsertAtlas: async () => { writes += 1; } },
  });
  await assert.rejects(() => handlers.software_cognition_graph_upsert({
    project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a",
    source_evidence_digest: "a".repeat(64), expected_revision: 0,
    nodes: [{ kind: "file", source_ref: "src/a.js" }], edges: [], idempotency_key: "graph-a",
  }, { tenantId: "tenant-a", agentPresence }), /software_diff_evidence_not_authorized/);
  assert.equal(writes, 0);
});

test("repository bootstrap fetches a bounded snapshot and persists only the derived Atlas", async () => {
  const commit = "a".repeat(40);
  const tree = "b".repeat(40);
  const files = new Map([
    ["src/app.ts", "export const endpoint = process.env.API_URL;\n"],
    ["render.yaml", "services:\n  - type: web\n"],
    ["shared-work-memory/tenant/snapshot.json", "{\"not\":\"architecture\"}\n"],
    ["test/fixture.ts", "export const fixture = true;\n"],
    ["src/component.spec.ts", "export const fixture = true;\n"],
    ["docs/adr/001-atlas.md", "# Atlas decision\n"],
    ["docs/CORE_RUNTIME_ARCHITECTURE.md", "# Core architecture\n"],
  ]);
  const contentRequests = [];
  const fetchImpl = async (url) => {
    if (url.includes("/contents/")) contentRequests.push(url);
    const json = url.includes(`/commits/main`)
      ? { sha: commit, commit: { tree: { sha: tree } } }
      : url.includes(`/git/trees/${tree}`)
        ? { truncated: false, tree: [...files.keys()].map((path) => ({ path, type: "blob", mode: "100644" })) }
        : (() => {
          const path = [...files.keys()].find((item) => url.includes(`/contents/${item}`));
          return path ? { type: "file", encoding: "base64", content: Buffer.from(files.get(path)).toString("base64") } : null;
        })();
    return { ok: Boolean(json), text: async () => JSON.stringify(json || { message: "not found" }) };
  };
  const graph = { revision: 0, nodes: [], edges: [], metrics: { total_nodes: 0, total_context_bytes: 0 } };
  const writes = [];
  const handlers = createSoftwareCognitionHandlers({
    coreRequest: async () => ({ ok: true }), issueAgentContext: () => "signed-context", fetchImpl,
    repositoryBindings: { "project-a": { repository: "owner/repository", branch: "main", credentialTenantId: null } },
    atlasRuntime: {
      readAtlasGraph: async () => graph.revision ? graph : Promise.reject(new Error("work_atlas_not_found")),
      readIntent: async () => ({ project_id: "project-a" }),
      upsertAtlas: async (_identity, input) => {
        assert.equal(input.replace, true);
        assert.equal(input.expected_revision, graph.revision);
        writes.push(input);
        graph.revision += 1;
        graph.nodes.push(...input.nodes);
        graph.edges.push(...input.edges);
        graph.bootstrap = input.bootstrap;
        return { revision: graph.revision, total_nodes: graph.nodes.length, total_context_bytes: JSON.stringify(graph.nodes).length };
      },
    },
  });
  const result = await handlers.software_cognition_repository_bootstrap({
    project_id: "project-a", work_id: "work-a", repository: "owner/repository", file_limit: 10, idempotency_key: "atlas-bootstrap-a",
  }, { tenantId: "tenant-a", agentPresence });
  assert.equal(result.structuredContent.completed, true);
  assert.equal(result.structuredContent.processed_files, 4);
  assert.equal(result.structuredContent.source_text_persisted, false);
  assert.equal(result.structuredContent.atlas_revision, 1);
  assert.equal(writes.length, 1);
  assert(writes[0].nodes.some((node) => node.path === "src/app.ts"));
  assert.equal(contentRequests.some((url) => url.includes("shared-work-memory")), false);
  assert.equal(contentRequests.some((url) => url.includes("test/fixture")), false);
  assert.equal(contentRequests.some((url) => url.includes("component.spec")), false);
  assert(contentRequests.some((url) => url.includes("docs/adr/001-atlas")));
  assert(contentRequests.some((url) => url.includes("CORE_RUNTIME_ARCHITECTURE")));
  assert.equal(Object.hasOwn(result.structuredContent, "content"), false);
});

test("repository bootstrap binds Work/project/repository and pins each continuation to its snapshot", async () => {
  const commit = "a".repeat(40);
  const tree = "b".repeat(40);
  const files = new Map([
    ["src/a.ts", "export const alpha = 1;\n"],
    ["src/b.ts", "export const beta = 2;\n"],
  ]);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const ref = url.includes(`/commits/${commit}`) ? commit : "main";
    const json = url.includes("/commits/")
      ? { sha: commit, commit: { tree: { sha: tree } } }
      : url.includes(`/git/trees/${tree}`)
        ? { truncated: false, tree: [...files.keys()].map((path) => ({ path, type: "blob", mode: "100644" })) }
        : (() => {
          const path = [...files.keys()].find((item) => url.includes(`/contents/${item}`));
          return path ? { type: "file", encoding: "base64", content: Buffer.from(files.get(path)).toString("base64") } : null;
        })();
    return { ok: Boolean(json), text: async () => JSON.stringify(json || { message: "not found" }) };
  };
  const graph = { revision: 0, nodes: [], edges: [], metrics: { total_nodes: 0, total_context_bytes: 0 } };
  const handlers = createSoftwareCognitionHandlers({
    coreRequest: async () => ({ ok: true }), issueAgentContext: () => "signed-context", fetchImpl,
    repositoryBindings: { "project-a": { repository: "owner/repository", branch: "main", credentialTenantId: "tenant-a" } },
    githubTokens: { "tenant-a": "token-only-on-server-123456789" },
    atlasRuntime: {
      readIntent: async () => ({ project_id: "project-a" }),
      readAtlasGraph: async () => graph.revision ? graph : Promise.reject(new Error("work_atlas_not_found")),
      upsertAtlas: async (_identity, input) => {
        graph.revision += 1;
        graph.nodes.push(...input.nodes);
        graph.edges.push(...input.edges);
        graph.bootstrap = input.bootstrap;
        return { revision: graph.revision, total_nodes: graph.nodes.length, total_context_bytes: 1 };
      },
    },
  });
  const identity = { tenantId: "tenant-a", agentPresence };
  const first = await handlers.software_cognition_repository_bootstrap({
    project_id: "project-a", work_id: "work-a", repository: "owner/repository", file_limit: 1, idempotency_key: "atlas-page-0",
  }, identity);
  assert.equal(first.structuredContent.completed, false);
  assert.equal(first.structuredContent.next_cursor, 1);
  assert.equal(first.structuredContent.snapshot_commit, commit);
  const second = await handlers.software_cognition_repository_bootstrap({
    project_id: "project-a", work_id: "work-a", repository: "owner/repository", cursor: first.structuredContent.next_cursor,
    snapshot_commit: first.structuredContent.snapshot_commit, snapshot_tree_sha: first.structuredContent.snapshot_tree_sha,
    file_limit: 1, idempotency_key: "atlas-page-1",
  }, identity);
  assert.equal(second.structuredContent.completed, true);
  assert.equal(second.structuredContent.snapshot_commit, commit);
  assert(calls.some(({ options }) => options.headers.authorization === "Bearer token-only-on-server-123456789"));
  assert(calls.every(({ url }) => !url.includes("?recursive=")), "tree walking must be incremental");
  assert.equal(JSON.stringify(second.structuredContent).includes("token-only-on-server"), false);
  await assert.rejects(() => handlers.software_cognition_repository_bootstrap({
    project_id: "project-a", work_id: "work-a", repository: "unrelated/repository", idempotency_key: "wrong-repo",
  }, identity), /software_atlas_repository_binding_mismatch/);
  await assert.rejects(() => handlers.software_cognition_repository_bootstrap({
    project_id: "other-project", work_id: "work-a", repository: "owner/repository", idempotency_key: "wrong-work",
  }, identity), /continuity_project_mismatch/);
});

test("repository bootstrap checkpoints a non-indexable page and continues without dropping the snapshot", async () => {
  const commit = "a".repeat(40);
  const tree = "b".repeat(40);
  const files = new Map([
    ["assets/logo.md", Buffer.from([0, 1, 2])],
    ["src/app.ts", Buffer.from("export const app = true;\n")],
  ]);
  const fetchImpl = async (url) => {
    const json = url.includes("/commits/")
      ? { sha: commit, commit: { tree: { sha: tree } } }
      : url.includes(`/git/trees/${tree}`)
        ? { truncated: false, tree: [...files.keys()].map((path) => ({ path, type: "blob", mode: "100644" })) }
        : (() => {
          const path = [...files.keys()].find((item) => url.includes(`/contents/${item}`));
          return path ? { type: "file", encoding: "base64", content: files.get(path).toString("base64") } : null;
        })();
    return { ok: Boolean(json), text: async () => JSON.stringify(json || { message: "not found" }) };
  };
  const graph = { revision: 0, nodes: [], edges: [], metrics: { total_nodes: 0, total_context_bytes: 0 } };
  const writes = [];
  const handlers = createSoftwareCognitionHandlers({
    coreRequest: async () => ({ ok: true }), issueAgentContext: () => "signed-context", fetchImpl,
    repositoryBindings: { "project-a": { repository: "owner/repository", branch: "main" } },
    atlasRuntime: {
      readIntent: async () => ({ project_id: "project-a" }),
      readAtlasGraph: async () => graph.revision ? graph : Promise.reject(new Error("work_atlas_not_found")),
      upsertAtlas: async (_identity, input) => {
        writes.push(input);
        graph.revision += 1;
        graph.nodes.push(...input.nodes);
        graph.edges.push(...input.edges);
        graph.bootstrap = input.bootstrap;
        return { revision: graph.revision, total_nodes: graph.nodes.length, total_context_bytes: 1 };
      },
    },
  });
  const identity = { tenantId: "tenant-a", agentPresence };
  const skipped = await handlers.software_cognition_repository_bootstrap({
    project_id: "project-a", work_id: "work-a", repository: "owner/repository", file_limit: 1, idempotency_key: "atlas-skip-0",
  }, identity);
  assert.equal(skipped.structuredContent.processed_files, 0);
  assert.deepEqual(skipped.structuredContent.skipped_paths, ["assets/logo.md"]);
  assert.equal(skipped.structuredContent.next_cursor, 1);
  assert.equal(writes[0].replace, true);
  assert.deepEqual(writes[0].nodes, []);
  const indexed = await handlers.software_cognition_repository_bootstrap({
    project_id: "project-a", work_id: "work-a", repository: "owner/repository", cursor: 1,
    snapshot_commit: commit, snapshot_tree_sha: tree, file_limit: 1, idempotency_key: "atlas-skip-1",
  }, identity);
  assert.equal(indexed.structuredContent.completed, true);
  assert.equal(indexed.structuredContent.processed_files, 1);
  assert.equal(writes[1].replace, false);
});
