import crypto from "node:crypto";
import ts from "typescript";

export const SOFTWARE_COGNITION_SCHEMA_VERSION = "nyra_software_cognition_v1";

export const SOFTWARE_NODE_KINDS = Object.freeze([
  "project", "product", "service", "module", "package", "file", "class", "function", "method",
  "type", "constant", "configuration", "environment_variable_reference", "api_endpoint", "api_contract",
  "database", "database_table", "database_column", "database_migration", "queue", "event", "worker",
  "deployment", "service_runtime", "test", "requirement", "capability", "intent", "icf_constraint",
  "decision", "work", "change", "obligation", "evidence", "runtime_observation", "incident",
]);

export const SOFTWARE_EDGE_TYPES = Object.freeze([
  "contains", "imports", "calls", "reads", "writes", "implements", "depends_on", "emits", "consumes",
  "configures", "deploys", "tests", "validates", "authorizes", "satisfies", "derived_from", "required_by",
  "affects", "may_regress", "observed_by", "contradicts", "supersedes", "bound_to_intent", "bound_to_icf",
  "bound_to_requirement", "bound_to_change", "bound_to_obligation",
]);

export const OBLIGATION_CRITICALITY = Object.freeze(["advisory", "normal", "required", "critical"]);
export const OBLIGATION_STATUSES = Object.freeze([
  "discovered", "modeled", "authorized", "executing", "executed", "verifying", "verified", "contradicted",
  "blocked", "waived_by_authority", "closed", "reopened",
]);
export const TRACEABILITY_STATES = Object.freeze(["explicit", "inferred_candidate", "verified", "contradicted", "stale"]);
export const CHALLENGE_TYPES = Object.freeze([
  "scope_underapproximated", "scope_overapproximated", "missing_dependency", "missing_obligation",
  "unsupported_assumption", "architecture_conflict", "intent_conflict", "icf_conflict", "test_gap",
  "security_gap", "deployment_gap", "runtime_gap", "contradictory_evidence", "false_completion",
]);
export const ARCHITECTURE_ASSERTION_STATES = Object.freeze(["observed", "inferred", "verified"]);

const NODE_KINDS = new Set(SOFTWARE_NODE_KINDS);
const EDGE_TYPES = new Set(SOFTWARE_EDGE_TYPES);
const VERIFIED_OBLIGATION_STATES = new Set(["verified", "closed", "waived_by_authority"]);
const RESOLVABLE_CHALLENGE_STATES = new Set(["open"]);
const weights = Object.freeze({ advisory: 0.25, normal: 1, required: 3, critical: 8 });

export class SoftwareCognitionError extends Error {
  constructor(code, status = 400, details = undefined) {
    super(code);
    this.name = "SoftwareCognitionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, status = 400, details) {
  throw new SoftwareCognitionError(code, status, details);
}

function text(value, code, max = 512) {
  const result = String(value || "").trim();
  if (!result || result.length > max) fail(code);
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function softwareDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function softwareAuthoritySnapshotDigest(snapshot) {
  return softwareDigest({
    project: snapshot?.project || null, work: snapshot?.work || null, change: snapshot?.change || null,
    obligations: snapshot?.obligations || [], evidence: snapshot?.evidence || [], icf: snapshot?.icf || null,
    graph: snapshot?.graph || null, native_plan: snapshot?.native_plan || null, native_closure: snapshot?.native_closure || null,
    latest_native_plan_id: snapshot?.latest_native_plan_id || null,
    challenges: snapshot?.challenges || [],
    artifacts: Object.fromEntries(Object.entries(snapshot?.artifacts || {}).filter(([kind]) => !["closure", "learning"].includes(kind))),
  });
}

function scoped(input) {
  return {
    tenant_id: text(input?.tenant_id, "tenant_id_required", 120),
    project_id: text(input?.project_id, "project_id_required", 160),
  };
}

export function deterministicSoftwareId({ tenant_id, project_id, kind, source_ref }) {
  const scope = scoped({ tenant_id, project_id });
  const canonicalKind = text(kind, "node_kind_required", 80);
  if (!NODE_KINDS.has(canonicalKind)) fail("node_kind_invalid");
  const sourceRef = text(source_ref, "source_ref_required", 2_000).replaceAll("\\", "/");
  return `scn_${softwareDigest({ ...scope, kind: canonicalKind, source_ref: sourceRef }).slice(0, 48)}`;
}

export function validateGraphMutation(input, { currentRevision = 0, existingNodeIds = [] } = {}) {
  const scope = scoped(input);
  const expectedRevision = Number(input.expected_revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail("expected_revision_invalid");
  if (expectedRevision !== Number(currentRevision)) fail("stale_graph_revision", 409, { current_revision: currentRevision });
  const known = new Set(existingNodeIds.map(String));
  const nodes = (input.nodes || []).map((candidate) => {
    if (candidate.tenant_id && candidate.tenant_id !== scope.tenant_id) fail("cross_tenant_node_reference", 403);
    if (candidate.project_id && candidate.project_id !== scope.project_id) fail("cross_project_node_reference", 403);
    const kind = text(candidate.kind, "node_kind_required", 80);
    if (!NODE_KINDS.has(kind)) fail("node_kind_invalid");
    const source_ref = text(candidate.source_ref, "source_ref_required", 2_000).replaceAll("\\", "/");
    const derivedNodeId = deterministicSoftwareId({ ...scope, kind, source_ref });
    if (candidate.node_id && candidate.node_id !== derivedNodeId) fail("node_id_scope_mismatch", 403);
    const node_id = derivedNodeId;
    const canonical = {
      ...scope, node_id, kind, source_ref,
      source_kind: text(candidate.source_kind || "repository", "source_kind_required", 80),
      provenance: stable(candidate.provenance || {}),
      payload: stable(candidate.payload || {}),
      version: Number.isSafeInteger(candidate.version) && candidate.version > 0 ? candidate.version : 1,
      tombstoned: candidate.tombstoned === true,
    };
    canonical.digest = softwareDigest(canonical);
    known.add(node_id);
    return canonical;
  });
  const edges = (input.edges || []).map((candidate) => {
    if (candidate.tenant_id && candidate.tenant_id !== scope.tenant_id) fail("cross_tenant_edge", 403);
    if (candidate.project_id && candidate.project_id !== scope.project_id) fail("cross_project_edge", 403);
    const edge_type = text(candidate.edge_type, "edge_type_required", 80);
    if (!EDGE_TYPES.has(edge_type)) fail("edge_type_invalid");
    const from_node_id = text(candidate.from_node_id, "from_node_id_required", 160);
    const to_node_id = text(candidate.to_node_id, "to_node_id_required", 160);
    if (!known.has(from_node_id) || !known.has(to_node_id)) fail("edge_endpoint_not_found", 422);
    const canonical = { ...scope, edge_type, from_node_id, to_node_id, provenance: stable(candidate.provenance || {}) };
    return { ...canonical, edge_id: `sce_${softwareDigest(canonical).slice(0, 48)}`, digest: softwareDigest(canonical) };
  });
  return { schema_version: SOFTWARE_COGNITION_SCHEMA_VERSION, ...scope, expected_revision: expectedRevision, next_revision: expectedRevision + 1, nodes, edges };
}

function propertyName(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return String(node.text);
  return null;
}

function exported(node) {
  return Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword));
}

function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = calleeName(expression.expression);
    return owner ? `${owner}.${expression.name.text}` : expression.name.text;
  }
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) {
    const owner = calleeName(expression.expression);
    return owner ? `${owner}.${expression.argumentExpression.text}` : expression.argumentExpression.text;
  }
  return null;
}

function sourcePosition(sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: start.line + 1, column: start.character + 1 };
}

/** A bounded syntax-only compiler pass. It performs no module resolution and never executes repository code. */
export function analyzeJavaScriptTypeScript(path, content) {
  const extension = path.toLowerCase().match(/\.[^.]+$/)?.[0];
  const scriptKind = extension === ".tsx" ? ts.ScriptKind.TSX : extension === ".jsx" ? ts.ScriptKind.JSX
    : [".ts", ".mts", ".cts"].includes(extension) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind);
  const declarations = []; const imports = []; const calls = []; const environment = []; const routes = []; const exports = [];
  function declaration(kind, name, node, extra = {}) {
    if (!name) return;
    declarations.push({ kind, name, source_ref: `${path}#${kind}:${name}`, exported: exported(node), position: sourcePosition(sourceFile, node), ...extra });
    if (exported(node)) exports.push({ name, kind, position: sourcePosition(sourceFile, node) });
  }
  function visit(node, className = null) {
    let nestedClass = className;
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      imports.push({ specifier: node.moduleSpecifier.text, type_only: node.importClause?.isTypeOnly === true, position: sourcePosition(sourceFile, node) });
    } else if (ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
      const names = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((element) => element.name.text) : ["*"];
      for (const name of names) exports.push({ name, kind: "re_export", specifier, type_only: node.isTypeOnly === true, position: sourcePosition(sourceFile, node) });
      if (specifier) imports.push({ specifier, type_only: node.isTypeOnly === true, re_export: true, position: sourcePosition(sourceFile, node) });
    } else if (ts.isExportAssignment(node)) {
      exports.push({ name: node.isExportEquals ? "export=" : "default", kind: "assignment", position: sourcePosition(sourceFile, node) });
    } else if (ts.isFunctionDeclaration(node)) declaration("function", node.name?.text || "default", node);
    else if (ts.isClassDeclaration(node)) { nestedClass = node.name?.text || "default"; declaration("class", nestedClass, node); }
    else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) declaration("type", node.name.text, node);
    else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
      const name = propertyName(node.name); declaration("method", className ? `${className}.${name}` : name, node, { parent: className });
    } else if (ts.isVariableStatement(node)) {
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const item of node.declarationList.declarations) if (ts.isIdentifier(item.name)) {
        const functionLike = item.initializer && (ts.isArrowFunction(item.initializer) || ts.isFunctionExpression(item.initializer));
        if (functionLike) declaration("function", item.name.text, node);
        else if (isConst && /^[A-Z][A-Z0-9_]*$/.test(item.name.text)) declaration("constant", item.name.text, node);
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node.expression);
      if (callee === "require" && ts.isStringLiteralLike(node.arguments[0])) imports.push({ specifier: node.arguments[0].text, type_only: false, require: true, position: sourcePosition(sourceFile, node) });
      const routeMatch = callee?.match(/^(?:app|router)\.(get|post|put|patch|delete)$/);
      if (routeMatch && ts.isStringLiteralLike(node.arguments[0])) routes.push({ method: routeMatch[1].toUpperCase(), path: node.arguments[0].text, position: sourcePosition(sourceFile, node) });
      else if (callee && callee !== "require") calls.push({ callee, position: sourcePosition(sourceFile, node) });
    }
    if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "process" && node.expression.name.text === "env") {
      environment.push({ name: node.name.text, position: sourcePosition(sourceFile, node) });
    }
    if (ts.isElementAccessExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "process" && node.expression.name.text === "env"
      && ts.isStringLiteralLike(node.argumentExpression)) environment.push({ name: node.argumentExpression.text, position: sourcePosition(sourceFile, node) });
    ts.forEachChild(node, (child) => visit(child, nestedClass));
  }
  visit(sourceFile);
  const dedupe = (values, key) => [...new Map(values.map((item) => [key(item), item])).values()];
  const diagnostics = sourceFile.parseDiagnostics.map((diagnostic) => ({ code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    ...(Number.isInteger(diagnostic.start) ? sourcePosition(sourceFile, { getStart: () => diagnostic.start }) : {}) }));
  return Object.freeze({ parser: "typescript_compiler_api", parser_version: ts.version,
    declarations: dedupe(declarations, (item) => `${item.kind}:${item.name}`), imports: dedupe(imports, (item) => `${item.specifier}:${item.type_only}`),
    exports: dedupe(exports, (item) => `${item.kind}:${item.name}:${item.specifier || ""}`), calls: dedupe(calls, (item) => item.callee),
    environment: dedupe(environment, (item) => item.name), routes: dedupe(routes, (item) => `${item.method}:${item.path}`), diagnostics });
}

function classifyFile(path) {
  if (/(^|\/)migrations?\/|\.sql$/i.test(path)) return "database_migration";
  if (/(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/i.test(path)) return "test";
  if (/(^|\/)(config|configuration)\/|(?:^|\/)(?:render|docker|package|tsconfig)[^/]*\.(?:json|ya?ml)$/i.test(path)) return "configuration";
  return "file";
}

export function indexSoftwareDiff(input) {
  const scope = scoped(input);
  const expectedRevision = Number(input.known_graph_revision ?? 0);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail("known_graph_revision_invalid");
  const repository = text(input.repository, "repository_required", 300);
  const base_commit = text(input.base_commit, "base_commit_required", 64);
  const head_commit = text(input.head_commit, "head_commit_required", 64);
  const changedFiles = Array.isArray(input.changed_files) ? input.changed_files : fail("changed_files_required");
  const nodes = [];
  const edges = [];
  const removed = [];
  const knownNodes = Array.isArray(input.known_nodes) ? input.known_nodes : [];
  const knownEdges = Array.isArray(input.known_edges) ? input.known_edges : [];
  const invalidatedPaths = new Set();
  const fileIds = new Map();
  for (const entry of changedFiles) {
    const path = text(entry.path, "changed_file_path_required", 2_000).replaceAll("\\", "/").replace(/^\.\//, "");
    const status = String(entry.status || "modified").toLowerCase();
    const kind = classifyFile(path);
    const fileId = deterministicSoftwareId({ ...scope, kind, source_ref: path });
    fileIds.set(path, fileId);
    invalidatedPaths.add(path);
    if (status === "deleted" || status === "removed") {
      removed.push({ node_id: fileId, source_ref: path, tombstoned: true });
      continue;
    }
    const content = String(entry.content || "");
    const jsTs = /\.[cm]?[jt]sx?$/i.test(path);
    const analysis = jsTs ? analyzeJavaScriptTypeScript(path, content) : null;
    const fileEvidence = { classification: kind,
      migration_evidence: kind === "database_migration", test_evidence: kind === "test", configuration_evidence: kind === "configuration" };
    nodes.push({ ...scope, node_id: fileId, kind, source_ref: path, source_kind: "git_diff", provenance: { repository, base_commit, head_commit,
      parser: analysis?.parser || "bounded_file_classifier_v1", parser_version: analysis?.parser_version || null }, payload: { bytes: Buffer.byteLength(content), content_digest: softwareDigest(content),
      parse_diagnostics: analysis?.diagnostics || [], exports: analysis?.exports || [], ...fileEvidence } });
    for (const symbol of analysis?.declarations || []) {
      const id = deterministicSoftwareId({ ...scope, kind: symbol.kind, source_ref: symbol.source_ref });
      nodes.push({ ...scope, node_id: id, kind: symbol.kind, source_ref: symbol.source_ref, source_kind: "typescript_compiler_api", provenance: { repository, head_commit,
        parser: analysis.parser, parser_version: analysis.parser_version, position: symbol.position }, payload: { name: symbol.name, exported: symbol.exported, parent: symbol.parent || null } });
      edges.push({ ...scope, edge_type: "contains", from_node_id: fileId, to_node_id: id, provenance: { parser: "typescript_compiler_api", parser_version: analysis.parser_version, source_path: path, position: symbol.position } });
    }
    for (const imported of analysis?.imports || []) {
      const ref = `${path}#import:${imported.specifier}`;
      const id = deterministicSoftwareId({ ...scope, kind: "module", source_ref: ref });
      nodes.push({ ...scope, node_id: id, kind: "module", source_ref: ref, source_kind: "typescript_compiler_api", provenance: { repository, head_commit,
        parser: analysis.parser, parser_version: analysis.parser_version, position: imported.position }, payload: { specifier: imported.specifier, type_only: imported.type_only, re_export: imported.re_export === true } });
      edges.push({ ...scope, edge_type: "imports", from_node_id: fileId, to_node_id: id, provenance: { parser: "typescript_compiler_api", parser_version: analysis.parser_version, source_path: path, position: imported.position } });
    }
    for (const environment of analysis?.environment || []) {
      const name = environment.name;
      const environmentRef = `${path}#env:${name}`;
      const id = deterministicSoftwareId({ ...scope, kind: "environment_variable_reference", source_ref: environmentRef });
      nodes.push({ ...scope, node_id: id, kind: "environment_variable_reference", source_ref: environmentRef, source_kind: "typescript_compiler_api", provenance: { repository, head_commit,
        parser: analysis.parser, parser_version: analysis.parser_version, position: environment.position }, payload: { name } });
      edges.push({ ...scope, edge_type: "reads", from_node_id: fileId, to_node_id: id, provenance: { parser: "typescript_compiler_api", parser_version: analysis.parser_version, source_path: path, position: environment.position } });
    }
    for (const route of analysis?.routes || []) {
      const source_ref = `${path}#api:${route.method}:${route.path}`;
      const id = deterministicSoftwareId({ ...scope, kind: "api_endpoint", source_ref });
      nodes.push({ ...scope, node_id: id, kind: "api_endpoint", source_ref, source_kind: "typescript_compiler_api", provenance: { repository, head_commit,
        parser: analysis.parser, parser_version: analysis.parser_version, position: route.position }, payload: { method: route.method, path: route.path } });
      edges.push({ ...scope, edge_type: "contains", from_node_id: fileId, to_node_id: id, provenance: { parser: "typescript_compiler_api", parser_version: analysis.parser_version, source_path: path, position: route.position } });
    }
    for (const call of analysis?.calls || []) {
      const source_ref = `${path}#call:${call.callee}`;
      const id = deterministicSoftwareId({ ...scope, kind: "function", source_ref });
      nodes.push({ ...scope, node_id: id, kind: "function", source_ref, source_kind: "typescript_compiler_api", provenance: { repository, head_commit,
        parser: analysis.parser, parser_version: analysis.parser_version, position: call.position }, payload: { callee: call.callee, external_or_unresolved: true } });
      edges.push({ ...scope, edge_type: "calls", from_node_id: fileId, to_node_id: id, provenance: { parser: "typescript_compiler_api", parser_version: analysis.parser_version, source_path: path, position: call.position } });
    }
  }
  const dedupe = (values, keyFor) => [...new Map(values.map((item) => [keyFor(item), item])).values()];
  const canonical = validateGraphMutation({
    ...scope,
    expected_revision: expectedRevision,
    nodes: dedupe(nodes, (node) => node.node_id),
    edges: dedupe(edges, (edge) => `${edge.edge_type}:${edge.from_node_id}:${edge.to_node_id}`),
  }, { currentRevision: expectedRevision });
  const emittedIds = new Set(canonical.nodes.map((node) => node.node_id));
  const staleKnownNodes = knownNodes.filter((node) => {
    if (node.tenant_id && node.tenant_id !== scope.tenant_id) fail("cross_tenant_node_reference", 403);
    if (node.project_id && node.project_id !== scope.project_id) fail("cross_project_node_reference", 403);
    const sourceRef = String(node.source_ref || "").replaceAll("\\", "/");
    const belongsToChangedFile = [...invalidatedPaths].some((path) => sourceRef === path || sourceRef.startsWith(`${path}#`));
    return belongsToChangedFile && !emittedIds.has(node.node_id);
  }).map((node) => ({ node_id: node.node_id, source_ref: node.source_ref, tombstoned: true }));
  const tombstones = dedupe([...removed, ...staleKnownNodes], (node) => node.node_id);
  const tombstonedIds = new Set(tombstones.map((node) => node.node_id));
  const emittedEdgeKeys = new Set(canonical.edges.map((edge) => `${edge.edge_type}:${edge.from_node_id}:${edge.to_node_id}`));
  const edgesRemoved = knownEdges.filter((edge) => {
    if (edge.tenant_id && edge.tenant_id !== scope.tenant_id) fail("cross_tenant_edge", 403);
    if (edge.project_id && edge.project_id !== scope.project_id) fail("cross_project_edge", 403);
    const key = `${edge.edge_type}:${edge.from_node_id}:${edge.to_node_id}`;
    const sourcedFromChangedFile = invalidatedPaths.has(String(edge.provenance?.source_path || ""));
    return (sourcedFromChangedFile || tombstonedIds.has(edge.from_node_id) || tombstonedIds.has(edge.to_node_id)) && !emittedEdgeKeys.has(key);
  }).map((edge) => ({ edge_id: edge.edge_id || `sce_${softwareDigest(edge).slice(0, 48)}`, edge_type: edge.edge_type, from_node_id: edge.from_node_id, to_node_id: edge.to_node_id }));
  const affected_seeds = [...new Set([...canonical.nodes.map((node) => node.node_id), ...tombstones.map((node) => node.node_id)])].sort();
  const result = { schema_version: "software_incremental_index_v1", ...scope, repository, base_commit, head_commit, graph_revision: canonical.next_revision, nodes_added_or_updated: canonical.nodes, nodes_tombstoned: tombstones, edges_added: canonical.edges, edges_removed: edgesRemoved, affected_seeds };
  return { ...result, source_digest: softwareDigest(result) };
}

function graphMaps(graph) {
  const nodes = new Map((graph.nodes || []).map((node) => [node.node_id, node]));
  const adjacent = new Map();
  for (const edge of graph.edges || []) {
    if (!nodes.has(edge.from_node_id) || !nodes.has(edge.to_node_id)) fail("edge_endpoint_not_found", 422);
    if (!adjacent.has(edge.from_node_id)) adjacent.set(edge.from_node_id, []);
    adjacent.get(edge.from_node_id).push({ edge, node: nodes.get(edge.to_node_id) });
    if (["imports", "calls", "consumes", "depends_on"].includes(edge.edge_type)) {
      if (!adjacent.has(edge.to_node_id)) adjacent.set(edge.to_node_id, []);
      adjacent.get(edge.to_node_id).push({ edge: { ...edge, traversal: "reverse_consumer" }, node: nodes.get(edge.from_node_id) });
    }
  }
  return { nodes, adjacent };
}

export function predictSoftwareImpact({ tenant_id, project_id, change_id, graph, seed_node_ids, max_depth = 4, max_nodes = 500 }) {
  const scope = scoped({ tenant_id, project_id });
  const { nodes, adjacent } = graphMaps(graph || {});
  const queue = (seed_node_ids || []).map((id) => ({ id, depth: 0 }));
  if (!queue.length) fail("impact_seed_required");
  const affected = new Map();
  const affectedEdges = [];
  while (queue.length && affected.size < max_nodes) {
    const current = queue.shift();
    if (affected.has(current.id)) continue;
    const node = nodes.get(current.id);
    if (!node) fail("impact_seed_not_found", 404);
    affected.set(current.id, { node_id: current.id, kind: node.kind, depth: current.depth });
    if (current.depth >= max_depth) continue;
    for (const next of adjacent.get(current.id) || []) {
      affectedEdges.push(next.edge);
      queue.push({ id: next.node.node_id, depth: current.depth + 1 });
    }
  }
  const kinds = new Set([...affected.values()].map((item) => item.kind));
  const impacts = {
    direct: [...affected.values()].filter((item) => item.depth === 0).length,
    transitive_dependency: [...affected.values()].filter((item) => item.depth > 0).length,
    consumer: affectedEdges.filter((edge) => ["imports", "calls", "consumes", "depends_on"].includes(edge.edge_type)).length,
    api: kinds.has("api_endpoint") || kinds.has("api_contract"), database_schema: [...kinds].some((kind) => kind.startsWith("database")),
    configuration: kinds.has("configuration") || kinds.has("environment_variable_reference"), security: affectedEdges.some((edge) => edge.edge_type === "authorizes"),
    test: kinds.has("test"), deployment: kinds.has("deployment") || kinds.has("service"), runtime: kinds.has("service_runtime") || kinds.has("runtime_observation"),
    intent_icf: kinds.has("intent") || kinds.has("icf_constraint"), architecture: kinds.has("service") || kinds.has("module") || kinds.has("package"), rollback: true,
  };
  const required_checks = ["unit"];
  if (impacts.api) required_checks.push("api_contract");
  if (impacts.database_schema) required_checks.push("migration", "rollback");
  if (impacts.security) required_checks.push("security");
  if (impacts.deployment || impacts.runtime) required_checks.push("deployment", "runtime_observation");
  const blast = affected.size > 50 ? "high" : affected.size > 10 ? "medium" : "small";
  const result = { schema_version: "software_impact_prediction_v1", ...scope, change_id: text(change_id, "change_id_required", 160), graph_revision: graph.revision, predicted_impact_set: impacts, affected_nodes: [...affected.values()], affected_edges: affectedEdges, required_checks: [...new Set(required_checks)].sort(), risk: blast === "high" ? "high" : impacts.database_schema || impacts.security ? "medium" : "low", blast_radius: { classification: blast, node_count: affected.size }, unknowns: queue.length ? ["impact_budget_exhausted"] : [], confidence: queue.length ? 0.65 : 0.9 };
  return { ...result, impact_digest: softwareDigest(result) };
}

export function expandSoftwareObligations({ tenant_id, project_id, work_id, change_id, impact, existing = [] }) {
  const scope = scoped({ tenant_id, project_id });
  const templates = [
    ["implementation", "required", true, "Implement the authorized change"],
    ["test", "required", true, "Verify affected behavior"],
    ["rollback", "required", true, "Provide a verified rollback path"],
  ];
  if (impact?.predicted_impact_set?.api) templates.push(["api_contract", "critical", true, "Verify consumer-compatible API contract"]);
  if (impact?.predicted_impact_set?.database_schema) templates.push(["migration", "critical", true, "Verify additive migration and rollback"]);
  if (impact?.predicted_impact_set?.configuration) templates.push(["configuration", "required", true, "Verify configuration parity"]);
  if (impact?.predicted_impact_set?.security) templates.push(["security", "critical", true, "Verify security boundaries"]);
  if (impact?.predicted_impact_set?.deployment || impact?.predicted_impact_set?.runtime) templates.push(["deployment", "required", true, "Verify exact deployed commit"], ["runtime_observation", "critical", true, "Observe runtime contracts"]);
  const combined = [...existing];
  for (const [type, criticality, blocking, description] of templates) {
    const source = { work_id, change_id, impact_digest: impact?.impact_digest || null };
    const obligation_id = `sco_${softwareDigest({ ...scope, source, type, description }).slice(0, 48)}`;
    if (!combined.some((item) => item.obligation_id === obligation_id)) combined.push({ ...scope, obligation_id, source, type, description, criticality, required: criticality !== "advisory", blocking, depends_on: [], satisfied_by: [], evidence_contract: { independently_verified: criticality === "critical" }, status: "discovered" });
  }
  return combined;
}

export function calculateCausalObligationCoverage(obligations = []) {
  let required = 0, verified = 0, contradicted = 0, blocking_missing = 0, critical_missing = 0, possible = 0, earned = 0;
  const categories = {};
  for (const obligation of obligations) {
    const criticality = OBLIGATION_CRITICALITY.includes(obligation.criticality) ? obligation.criticality : "normal";
    const isVerified = VERIFIED_OBLIGATION_STATES.has(obligation.status);
    const isRequired = obligation.required !== false && criticality !== "advisory";
    const weight = weights[criticality];
    possible += weight;
    if (isVerified) earned += weight;
    if (isRequired) required += 1;
    if (isVerified) verified += 1;
    if (obligation.status === "contradicted" || obligation.status === "reopened") contradicted += 1;
    if (obligation.blocking === true && !isVerified) blocking_missing += 1;
    if (criticality === "critical" && !isVerified) critical_missing += 1;
    const category = obligation.type || "uncategorized";
    categories[category] ||= { total: 0, verified: 0 };
    categories[category].total += 1;
    if (isVerified) categories[category].verified += 1;
  }
  const category_coverage = Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, { ...value, coverage: value.total ? value.verified / value.total : 1 }]));
  return { schema_version: "causal_obligation_coverage_v1", total: obligations.length, required, verified, unverified: obligations.length - verified, contradicted, blocking_missing, critical_missing, weighted_coverage: possible ? earned / possible : 1, category_coverage, closure_eligible: critical_missing === 0 && blocking_missing === 0 && contradicted === 0 };
}

export function createWorkerPlanContract(input) {
  const scope = scoped(input);
  const requiredArrays = ["hypotheses", "assumptions", "affected_components", "planned_changes", "expected_effects", "expected_non_effects", "risks", "tests", "rollback", "unknowns"];
  for (const key of requiredArrays) if (!Array.isArray(input[key])) fail(`plan_${key}_required`);
  const payload = { schema_version: "worker_plan_contract_v1", ...scope, plan_id: text(input.plan_id, "plan_id_required", 160), work_id: text(input.work_id, "work_id_required", 160), change_id: text(input.change_id, "change_id_required", 160), actor_provenance: stable(input.actor_provenance || {}), base_state_digest: text(input.base_state_digest, "base_state_digest_required", 64), version: Number(input.version || 1), goal: text(input.goal, "plan_goal_required", 4_000), ...Object.fromEntries(requiredArrays.map((key) => [key, stable(input[key])])) };
  return { ...payload, plan_digest: softwareDigest(payload) };
}

export function reconcileSoftwareImpact({ tenant_id, project_id, predicted, actual }) {
  const scope = scoped({ tenant_id, project_id });
  if (predicted.graph_revision !== actual.base_graph_revision) fail("stale_impact_calculation", 409);
  const predictedIds = new Set((predicted.affected_nodes || []).map((item) => item.node_id));
  const actualIds = new Set((actual.changed_nodes || []).map((item) => item.node_id));
  const deltas = [];
  for (const id of actualIds) if (!predictedIds.has(id)) deltas.push({ type: "UNPLANNED_CHANGE", node_id: id });
  for (const id of predictedIds) if (!actualIds.has(id)) deltas.push({ type: "MISSING_CHANGE", node_id: id });
  for (const kind of actual.new_dependency_kinds || []) deltas.push({ type: "UNEXPECTED_DEPENDENCY", dependency_kind: kind });
  if (actual.architecture_drift) deltas.push({ type: "ARCHITECTURE_DRIFT" });
  if (actual.intent_drift) deltas.push({ type: "INTENT_DRIFT" });
  if (actual.icf_drift) deltas.push({ type: "ICF_DRIFT" });
  if (actual.test_gap) deltas.push({ type: "TEST_GAP" });
  if (actual.runtime_gap) deltas.push({ type: "RUNTIME_GAP" });
  const result = { schema_version: "software_impact_reconciliation_v1", ...scope, predicted_impact_digest: predicted.impact_digest,
    actual_change_digest: softwareDigest(actual), actual_evidence_digest: actual.evidence_digest || null, deltas, reconciled: deltas.length === 0 };
  return { ...result, reconciliation_digest: softwareDigest(result) };
}

export function superviseWorkerPlan({ tenant_id, project_id, work_id, change_id, plan, impact, obligations = [], bindings = {} }) {
  const scope = scoped({ tenant_id, project_id });
  const challenges = [];
  const add = (challenge_type, severity, worker_claim, supervisor_hypothesis, evidence_refs = []) => {
    const base = { ...scope, work_id, change_id, plan_id: plan.plan_id, challenge_type, worker_claim, supervisor_hypothesis, evidence_refs: [...new Set(evidence_refs)].sort(), severity, confidence: severity === "critical" ? 0.95 : 0.8, status: "open", version: 1 };
    challenges.push({ ...base, challenge_id: `sch_${softwareDigest(base).slice(0, 48)}` });
  };
  const planned = new Set(plan.affected_components || []);
  const affected = (impact.affected_nodes || []).map((item) => item.node_id);
  const missing = affected.filter((id) => !planned.has(id));
  if (missing.length) add("scope_underapproximated", "critical", "planned scope is complete", "impact graph contains affected nodes absent from the plan", missing);
  if (!plan.tests?.length) add("test_gap", "critical", "change can be completed", "no tests were planned");
  if (!plan.rollback?.length) add("deployment_gap", "required", "change is reversible", "rollback plan is empty");
  if ((plan.assumptions || []).some((item) => !item.evidence_refs?.length)) add("unsupported_assumption", "required", "assumptions are supported", "one or more assumptions lack evidence");
  if (!bindings.intent_id || !bindings.intent_digest) add("intent_conflict", "critical", "plan is intent-aligned", "current Intent binding is missing");
  if (bindings.icf_required && (!bindings.icf_id || !bindings.icf_digest)) add("icf_conflict", "critical", "plan is ICF-aligned", "current ICF binding is missing");
  if (obligations.some((item) => item.required !== false && !(plan.planned_changes || []).some((change) => change.obligation_id === item.obligation_id))) add("missing_obligation", "critical", "plan covers obligations", "required obligations are absent from planned changes", obligations.filter((item) => item.required !== false).map((item) => item.obligation_id));
  return { schema_version: "nyra_supervisory_reasoning_v1", ...scope, work_id, change_id, plan_id: plan.plan_id, artifacts: challenges.map((item) => ({ type: "challenge", claim: item.worker_claim, hypothesis: item.supervisor_hypothesis, evidence_refs: item.evidence_refs, risk: item.severity, confidence: item.confidence, recommended_action: "ACCEPT_OR_EVIDENCE_BOUND_REBUT" })), challenges };
}

export function resolveSupervisoryChallenge(challenge, resolution) {
  if (!challenge || !RESOLVABLE_CHALLENGE_STATES.has(challenge.status)) fail("challenge_not_open", 409);
  if (Number(resolution.expected_version) !== Number(challenge.version)) fail("stale_challenge_revision", 409);
  const action = text(resolution.action, "challenge_resolution_action_required", 16).toUpperCase();
  if (!new Set(["ACCEPT", "REBUT"]).has(action)) fail("challenge_resolution_action_invalid");
  if (action === "REBUT" && (!Array.isArray(resolution.evidence_refs) || resolution.evidence_refs.length === 0)) fail("rebuttal_evidence_required", 422);
  const evidenceSubjectDigest = softwareDigest({ tenant_id: challenge.tenant_id, project_id: challenge.project_id,
    work_id: challenge.work_id, change_id: challenge.change_id, plan_id: challenge.plan_id,
    challenge_id: challenge.challenge_id, challenge_type: challenge.challenge_type, worker_claim: challenge.worker_claim,
    supervisor_hypothesis: challenge.supervisor_hypothesis, severity: challenge.severity });
  const updated = { ...challenge, status: action === "ACCEPT" ? "accepted" : "rebutted", resolution: { action,
    evidence_refs: [...new Set(resolution.evidence_refs || [])].sort(), evidence_subject_digest: evidenceSubjectDigest,
    actor_provenance: stable(resolution.actor_provenance || {}) }, version: Number(challenge.version) + 1 };
  return { ...updated, resolution_digest: softwareDigest(updated) };
}

export function validateLearningPromotion(input) {
  const scope = scoped(input);
  if (input.evidence_tenant_id !== scope.tenant_id) fail("cross_tenant_learning", 403);
  if (input.outcome_state !== "verified") fail("unverified_learning_promotion", 422);
  if (!input.independently_verified || !input.evidence_digest) fail("unverified_learning_promotion", 422);
  const result = { schema_version: "software_verified_learning_case_v1", ...scope, source_work_id: input.source_work_id, outcome_state: "verified", evidence_digest: input.evidence_digest, independently_verified: true, candidate: stable(input.candidate || {}) };
  return { ...result, learning_digest: softwareDigest(result), policy_mutation_authorized: false, model_weight_mutation_authorized: false };
}

export function buildRequirementTraceability({ tenant_id, project_id, graph, links = [] }) {
  const scope = scoped({ tenant_id, project_id });
  const nodes = new Map((graph?.nodes || []).map((node) => [node.node_id, node]));
  const normalized = links.map((link) => {
    if (link.tenant_id && link.tenant_id !== scope.tenant_id) fail("cross_tenant_traceability", 403);
    if (link.project_id && link.project_id !== scope.project_id) fail("cross_project_traceability", 403);
    if (!nodes.has(link.from_node_id) || !nodes.has(link.to_node_id)) fail("traceability_node_not_found", 422);
    if (!TRACEABILITY_STATES.includes(link.state)) fail("traceability_state_invalid");
    const inferred = link.state === "inferred_candidate";
    if (inferred && (!link.provenance || !Number.isFinite(link.confidence) || !Array.isArray(link.evidence_refs))) fail("inferred_traceability_evidence_required", 422);
    const base = { ...scope, from_node_id: link.from_node_id, to_node_id: link.to_node_id, relation: text(link.relation, "traceability_relation_required", 80),
      state: link.state, provenance: stable(link.provenance || {}), confidence: Number(link.confidence ?? (link.state === "verified" ? 1 : 0)), evidence_refs: [...new Set(link.evidence_refs || [])].sort() };
    return { ...base, link_id: `sctl_${softwareDigest(base).slice(0, 48)}` };
  });
  const verified = normalized.filter((link) => link.state === "verified");
  const result = { schema_version: "software_requirement_traceability_v1", ...scope, links: normalized,
    hard_block_authority_link_ids: verified.map((link) => link.link_id).sort(), inferred_links_are_authoritative: false };
  return { ...result, traceability_digest: softwareDigest(result) };
}

export function recoverSoftwareArchitecture({ tenant_id, project_id, graph, verification_evidence = [] }) {
  const scope = scoped({ tenant_id, project_id });
  const nodes = graph?.nodes || []; const edges = graph?.edges || [];
  const degree = new Map(nodes.map((node) => [node.node_id, { incoming: 0, outgoing: 0 }]));
  for (const edge of edges) { if (!degree.has(edge.from_node_id) || !degree.has(edge.to_node_id)) fail("edge_endpoint_not_found", 422); degree.get(edge.from_node_id).outgoing += 1; degree.get(edge.to_node_id).incoming += 1; }
  const assertions = [];
  for (const node of nodes.filter((item) => ["service", "module", "package"].includes(item.kind))) {
    const observed = { assertion_type: "boundary_detection", subject_node_id: node.node_id, state: "observed", confidence: 1,
      evidence_refs: [node.digest].filter(Boolean), facts: { kind: node.kind, source_ref: node.source_ref } };
    assertions.push({ ...observed, assertion_id: `scar_${softwareDigest({ ...scope, ...observed }).slice(0, 48)}` });
  }
  const pathLayers = new Map([["routes", "interface"], ["controllers", "application"], ["services", "domain"], ["repositories", "data"]]);
  for (const node of nodes) for (const [segment, layer] of pathLayers) if (String(node.source_ref || "").split("/").includes(segment)) {
    const inferred = { assertion_type: "layer_detection", subject_node_id: node.node_id, state: "inferred", confidence: 0.7, evidence_refs: [], facts: { layer, path_segment: segment } };
    assertions.push({ ...inferred, assertion_id: `scar_${softwareDigest({ ...scope, ...inferred }).slice(0, 48)}` });
  }
  for (const assertion of assertions) {
    const proof = verification_evidence.find((item) => item.assertion_id === assertion.assertion_id && item.verification_state === "verified" && item.evidence_digest);
    if (proof) { assertion.state = "verified"; assertion.confidence = 1; assertion.evidence_refs = [proof.evidence_digest]; }
  }
  const coupling = [...degree].map(([node_id, counts]) => ({ node_id, ...counts, total: counts.incoming + counts.outgoing })).sort((a, b) => b.total - a.total || a.node_id.localeCompare(b.node_id));
  const result = { schema_version: "software_architecture_recovery_v1", ...scope, assertions, coupling,
    architecture_patterns_are_authoritative: false, verified_assertion_ids: assertions.filter((item) => item.state === "verified").map((item) => item.assertion_id) };
  return { ...result, architecture_digest: softwareDigest(result) };
}

export function calibrateSoftwareSupervision({ tenant_id, project_id, cases = [] }) {
  const scope = scoped({ tenant_id, project_id });
  for (const item of cases) {
    if (item.tenant_id !== scope.tenant_id) fail("cross_tenant_calibration", 403);
    if (item.project_id !== scope.project_id) fail("cross_project_calibration", 403);
  }
  const verified = cases.filter((item) => item.outcome_state === "verified" && item.independently_verified === true && item.evidence_digest);
  const ratio = (field) => verified.length ? verified.filter((item) => item[field] === true).length / verified.length : null;
  const metrics = { sample_size: verified.length, scope_prediction_accuracy: ratio("scope_prediction_accurate"), dependency_recall: ratio("dependencies_complete"),
    obligation_recall: ratio("obligations_complete"), impact_prediction_accuracy: ratio("impact_prediction_accurate"), test_recall: ratio("tests_complete"),
    false_completion_rate: verified.length ? verified.filter((item) => item.false_completion === true).length / verified.length : null,
    regression_rate: verified.length ? verified.filter((item) => item.regression === true).length / verified.length : null,
    verification_pass_rate: ratio("verification_passed") };
  const elevated = verified.length >= 3 && (metrics.false_completion_rate > 0 || metrics.dependency_recall < 0.8 || metrics.obligation_recall < 0.8);
  const result = { schema_version: "software_agent_calibration_v1", ...scope, metrics,
    adaptation: { supervision_depth: elevated ? "elevated" : "standard", required_verifier_count: elevated ? 2 : 1, impact_expansion: elevated ? 1 : 0, required_evidence: elevated ? "enhanced" : "standard" },
    excluded_unverified_cases: cases.length - verified.length, ranking_authorized: false, model_weight_mutation_authorized: false };
  return { ...result, calibration_digest: softwareDigest(result) };
}

export function routeSoftwareCognitionEvent({ tenant_id, project_id, graph, event, max_nodes = 200, max_depth = 2 }) {
  const scope = scoped({ tenant_id, project_id });
  if (!event || typeof event !== "object") fail("software_event_required");
  const eventType = text(event.type, "software_event_type_required", 80);
  const nodes = graph?.nodes || []; const edges = graph?.edges || [];
  const explicit = new Set(event.node_ids || []);
  const refs = new Set([event.source_ref, ...(event.source_refs || [])].filter(Boolean));
  for (const node of nodes) if (refs.has(node.source_ref) || refs.has(String(node.source_ref || "").split("#")[0])) explicit.add(node.node_id);
  const selected = new Set([...explicit].filter((id) => nodes.some((node) => node.node_id === id)));
  const allowedEdges = new Set(event.edge_types || ["imports", "calls", "depends_on", "consumes", "routes_to", "tested_by", "verified_by"]);
  for (let depth = 0; depth < Math.min(4, Math.max(0, Number(max_depth))); depth += 1) {
    for (const edge of edges) if (allowedEdges.has(edge.edge_type) && (selected.has(edge.from_node_id) || selected.has(edge.to_node_id))) {
      selected.add(edge.from_node_id); selected.add(edge.to_node_id);
      if (selected.size >= Math.min(500, Number(max_nodes))) break;
    }
  }
  const routed = nodes.filter((node) => selected.has(node.node_id)).slice(0, Math.min(500, Number(max_nodes)));
  const capabilityByEvent = { diff_observed: "software_cognition_impact_predict", plan_created: "software_cognition_supervise",
    execution_completed: "software_cognition_impact_reconcile", runtime_observed: "software_cognition_closure_evaluate",
    obligation_reopened: "software_cognition_closure_evaluate", challenge_opened: "software_cognition_challenge_read" };
  const result = { schema_version: "software_event_relevance_route_v1", ...scope, event_type: eventType,
    event_digest: softwareDigest(event), recommended_capability: capabilityByEvent[eventType] || "software_cognition_graph_select",
    selected_node_ids: routed.map((node) => node.node_id), selected_nodes: routed.length, max_nodes: Math.min(500, Number(max_nodes)),
    max_depth: Math.min(4, Math.max(0, Number(max_depth))), edge_types: [...allowedEdges].sort(), selection_is_advisory: true };
  return { ...result, route_digest: softwareDigest(result) };
}

export function evaluateSoftwareClosure(input) {
  const coverage = calculateCausalObligationCoverage(input.obligations || []);
  const reasons = [];
  if (!input.intent_binding?.id || !input.intent_binding?.digest || input.intent_binding?.state !== "verified") reasons.push("intent_not_verified");
  if (input.icf_required && (!input.icf_binding?.id || !input.icf_binding?.digest || input.icf_binding?.state !== "verified")) reasons.push("icf_not_verified");
  if (!input.acceptance_criteria_verified) reasons.push("acceptance_criteria_unverified");
  if (!coverage.closure_eligible) reasons.push("obligation_coverage_incomplete");
  if ((input.challenges || []).some((item) => item.severity === "critical" && item.status !== "verified_resolved" && item.status !== "rejected_by_core")) reasons.push("blocking_supervisory_challenge");
  if (!input.reconciliation?.reconciled) reasons.push("impact_not_reconciled");
  if (!input.architecture_constraints_verified) reasons.push("architecture_constraints_unverified");
  if (!input.tests_verified) reasons.push("tests_unverified");
  if (!input.runtime_observation?.verified || input.runtime_observation?.fresh !== true) reasons.push("runtime_observation_missing");
  if (!input.rollback?.verified) reasons.push("rollback_not_ready");
  if (!input.verifier?.independently_verified || input.verifier?.agent_id === input.builder?.agent_id || input.verifier?.session_fingerprint === input.builder?.session_fingerprint) reasons.push("independent_verifier_missing");
  if (input.core_join && !input.core_join.valid) reasons.push("core_join_invalid");
  const result = { schema_version: "software_closure_evaluation_v1", work_id: input.work_id, change_id: input.change_id, coverage, verdict: reasons.length ? "CLOSURE_DENIED" : "RELEASE_READY", reasons, authoritative_transition_performed: false };
  return { ...result, closure_digest: softwareDigest(result) };
}
