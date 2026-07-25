import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../../universal-core-service/src/app.js";
import { createSoftwareAuthorizationVerifier } from "../../universal-core-service/src/universalSoftwareIntelligence.js";
import { createAnalyzerHandlers } from "../src/analyzer-handlers.js";
import { createApp } from "../src/app.js";
import { createCoreHandlers, createCoreWriteGuard } from "../src/core-handlers.js";
import { createMemoryFabric, createMemoryFabricHandlers } from "../src/memory-fabric.js";

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function generateKey(coreUrl, adminKey, tenantId) {
  const response = await fetch(`${coreUrl}/v1/keys/generate`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminKey}`, "content-type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, preset: "nyra_core_360_connector", tier: "internal", domain_pack_id: "analyzer" }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.key;
}

function buildMcp(config, memoryRoot) {
  const govern = createCoreWriteGuard(config);
  const memory = createMemoryFabric({ ...config, memoryFabricRoot: memoryRoot, memoryRetentionDays: 30, personalMemoryRetentionDays: 7 }, { govern });
  const core = createCoreHandlers(config, { contextProvider: (input, identity) => memory.context(input, identity) });
  const handlers = { ...core, ...createMemoryFabricHandlers(memory), ...createAnalyzerHandlers() };
  const native = new Set(["core_health", "work_preflight", "nyra_runtime_context", "nyra_branch_catalog", "nyra_interpret_request", "core_gate_action", "memory_context", "memory_search"]);
  return createApp(config, {
    handlers,
    beforeToolCall: async ({ identity, toolName, args }) => {
      if (native.has(toolName)) return null;
      const result = await core.work_preflight({
        request: String(args.request || args.message || args.summary || args.query || `Run ${toolName}`).slice(0, 20_000),
        operation_type: toolName,
        tool_name: toolName,
        session_id: args.session_id,
        agent_id: args.agent_id || "chatgpt_local_test",
        available_capabilities: ["skinharmony_core_mcp", toolName],
        owner_confirmed: identity.ownerConfirmed === true,
        confirmation_reference: identity.confirmationReference,
      }, identity);
      return result.structuredContent;
    },
    afterToolCall: (event) => memory.recordToolActivity(event),
  });
}

function mcpClient(base, token) {
  let id = 0;
  return async (method, params = {}) => {
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const body = await response.json();
    return { status: response.status, body };
  };
}

async function completed(call, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await call("tools/call", { name: "software_job_status", arguments: { job_id: jobId } });
    const job = response.body.result?.structuredContent?.job;
    if (["completed", "failed"].includes(job?.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("software_job_did_not_settle");
}

test("real local MCP covers Core V2, Nyra memory and branches, software jobs, analyzers and tenant isolation", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  const adminKey = "local-live-mcp-admin";
  const authorizationSecret = "local-live-software-authorization-secret-32-bytes";
  process.env.CORE_SERVICE_ADMIN_KEY = adminKey;
  const root = path.join(os.tmpdir(), `live-core-nyra-mcp-${Date.now()}-${Math.random()}`);
  const workerAdapters = {
    ghidra_headless: async () => ({ schema_version: "universal_software_evidence_v1", functions: [{ name: "demo", entry: "1000" }], call_graph: [], decompilation: [] }),
    frida_local_agent: async () => ({ schema_version: "universal_software_evidence_v1", events: [{ kind: "call_enter", symbol: "demo" }] }),
  };
  const coreService = createUniversalCoreService({
    storageRoot: path.join(root, "core"),
    softwareWorkerAdapters: workerAdapters,
    softwareAuthorizationSecret: authorizationSecret,
    softwareAuthorizationVerifier: createSoftwareAuthorizationVerifier({ secret: authorizationSecret }),
  });
  const core = await listen(coreService.app);
  let mcpA;
  let mcpB;
  try {
    const tenantA = "tenant-live-a";
    const tenantB = "tenant-live-b";
    const keyA = await generateKey(core.url, adminKey, tenantA);
    const keyB = await generateKey(core.url, adminKey, tenantB);
    const universalCoreKeys = { [tenantA]: keyA, [tenantB]: keyB };
    const baseConfig = {
      publicUrl: "http://127.0.0.1",
      resource: "http://127.0.0.1/mcp",
      auth0Issuer: "",
      auth0Audience: "",
      jwksUri: "",
      codexScopes: ["core:read", "core:govern"],
      supportedScopes: ["core:read", "core:govern"],
      universalCoreUrl: core.url,
      universalCoreKey: "",
      universalCoreKeys,
      godModeEnabled: false,
      godModeEmergencyStop: false,
    };
    mcpA = await listen(buildMcp({ ...baseConfig, codexKeys: ["mcp-token-a"], defaultTenantId: tenantA }, path.join(root, "memory")));
    mcpB = await listen(buildMcp({ ...baseConfig, codexKeys: ["mcp-token-b"], defaultTenantId: tenantB }, path.join(root, "memory")));
    const callA = mcpClient(mcpA.url, "mcp-token-a");
    const callB = mcpClient(mcpB.url, "mcp-token-b");

    const initialized = await callA("initialize");
    assert.equal(initialized.body.result.serverInfo.version, "0.8.0");
    const listed = await callA("tools/list");
    const names = listed.body.result.tools.map((item) => item.name);
    for (const name of ["work_preflight", "memory_context", "nyra_branch_catalog", "software_intelligence", "software_job_status", "skin_analyzer", "scalp_analyzer"]) assert(names.includes(name), name);

    const append = await callA("tools/call", { name: "memory_append", arguments: {
      kind: "decision",
      title: "Authenticated tenant decision",
      summary: "Use the governed analyzer and preserve read-only evidence.",
      tags: ["live_mcp"],
      owner_confirmed: true,
      confirmation_reference: "local integration owner confirmation",
    } });
    assert.equal(append.body.result.structuredContent.created, true);
    await callB("tools/call", { name: "memory_append", arguments: {
      kind: "decision",
      title: "Tenant B private decision",
      summary: "This memory must never appear for tenant A.",
      owner_confirmed: true,
      confirmation_reference: "local integration tenant B confirmation",
    } });
    const memory = await callA("tools/call", { name: "memory_context", arguments: { query: "governed analyzer evidence" } });
    assert.equal(memory.body.result.structuredContent.tenant_id, tenantA);
    assert(memory.body.result.structuredContent.relevant_memories.some((item) => item.title === "Authenticated tenant decision"));
    assert(!JSON.stringify(memory.body).includes("Tenant B private decision"));

    const preflight = await callA("tools/call", { name: "work_preflight", arguments: { request: "Interpret analyzer evidence and plan a read-only review" } });
    assert.equal(preflight.body.result.structuredContent.tenant_id, tenantA);
    assert(preflight.body.result.structuredContent.work_preflight.memory_first.revision >= 1);
    assert(preflight.body.result.structuredContent.work_preflight.preflight_id);
    const branches = await callA("tools/call", { name: "nyra_branch_catalog", arguments: {} });
    assert(branches.body.result.structuredContent.catalog.branches.some((item) => item.id === "analyzer_domain"));
    const interpreted = await callA("tools/call", { name: "nyra_interpret_request", arguments: { message: "Interpreta la memoria e apri i rami analyzer consentiti" } });
    assert.equal(interpreted.body.result.structuredContent.ok, true);
    assert.equal(interpreted.body.result.structuredContent.tenant_id, tenantA);

    const staticAnalysis = await callA("tools/call", { name: "software_intelligence", arguments: {
      artifact: { name: "fixture.bin", content_base64: Buffer.from("local fixture").toString("base64") },
      authorization: { asserted: true, basis: "owned", purpose: "testing" },
    } });
    assert.equal(staticAnalysis.body.result.structuredContent.analysis.artifact.raw_content_persisted, false);

    const authorization = await callA("tools/call", { name: "software_authorize", arguments: {
      owner_confirmed: true,
      confirmation_reference: "owner approved local isolated software probes",
      external_side_effect: false,
      contains_customer_data: false,
      cross_tenant: false,
      sandbox_ready: true,
      audit_ready: true,
      authorization_basis: "owned",
      allowed_modes: ["ghidra_headless", "frida_local_agent"],
      target_allowlist: ["process:owned-demo"],
    } });
    assert.equal(authorization.body.result.structuredContent.ok, true, JSON.stringify(authorization.body));
    const coreGovernance = authorization.body.result.structuredContent.core_governance;

    const ghidraSubmit = await callA("tools/call", { name: "software_job_submit", arguments: {
      mode: "ghidra_headless",
      artifact: { name: "fixture.bin", content_base64: Buffer.from("local fixture").toString("base64") },
      authorization: { asserted: true, basis: "owned", purpose: "testing", owner_confirmed: true },
      core_governance: coreGovernance,
      owner_confirmed: true,
      confirmation_reference: "owner approved Ghidra job",
    } });
    const ghidra = await completed(callA, ghidraSubmit.body.result.structuredContent.job.job_id);
    assert.equal(ghidra.state, "completed");
    assert.equal(ghidra.evidence.schema_version, "universal_software_evidence_v1");

    const fridaSubmit = await callA("tools/call", { name: "software_job_submit", arguments: {
      mode: "frida_local_agent",
      target: "process:owned-demo",
      template_id: "observe_module_loads_v1",
      template_parameters: { module_name_filter: "demo" },
      authorization: { asserted: true, basis: "owned", purpose: "testing", owner_confirmed: true },
      core_governance: coreGovernance,
      owner_confirmed: true,
      confirmation_reference: "owner approved Frida job",
    } });
    const frida = await completed(callA, fridaSubmit.body.result.structuredContent.job.job_id);
    assert.equal(frida.state, "completed");
    assert.equal(frida.evidence.schema_version, "universal_software_evidence_v1");

    const correlated = await callA("tools/call", { name: "software_correlate", arguments: { job_ids: [ghidra.job_id, frida.job_id] } });
    assert.equal(correlated.body.result.structuredContent.correlation.evidence_schema, "universal_software_evidence_v1");

    const skin = await callA("tools/call", { name: "skin_analyzer", arguments: { scores: [
      { key: "skin_tone_brightness", score: 66 },
      { key: "water_oil_balance", score: 85 },
      { key: "texture_fine_lines", score: 73 },
      { key: "redness_sensitivity_signals", score: 50 },
      { key: "spots_pigmentation_signals", score: 94 },
      { key: "pores_texture", score: 30 },
    ], data_quality_score: 88 } });
    assert.equal(skin.body.result.structuredContent.branch_output.branch, "skinharmony_skin_ensemble_v2");
    assert.equal(skin.body.result.structuredContent.guardrail.execution_allowed, false);

    const scalp = await callA("tools/call", { name: "scalp_analyzer", arguments: { overall: { density_index: 62, miniaturization_index: 28, redness_percent: 14, confidence: 0.88 }, locale: "it" } });
    assert.equal(scalp.body.result.structuredContent.schema_version, "scalp_analyzer_interpretation_v2");
    assert.equal(scalp.body.result.structuredContent.governance.diagnosis_allowed, false);
    assert(scalp.body.result.structuredContent.work_preflight.preflight_id);

    const crossTenantArgument = await callA("tools/call", { name: "memory_context", arguments: { tenant_id: tenantB } });
    assert.equal(crossTenantArgument.body.error.code, -32602);
    const insufficient = await fetch(`${mcpA.url}/mcp`, { method: "POST", headers: { authorization: "Bearer invalid", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" }) });
    assert.equal(insufficient.status, 401);
    const tenantBJob = await callB("tools/call", { name: "software_job_submit", arguments: {
      mode: "lightweight_static",
      artifact: { name: "tenant-b.bin", content_base64: Buffer.from("tenant B").toString("base64") },
      authorization: { asserted: true, basis: "owned", purpose: "testing" },
      owner_confirmed: true,
      confirmation_reference: "tenant B local job",
    } });
    const crossJob = await callA("tools/call", { name: "software_job_status", arguments: { job_id: tenantBJob.body.result.structuredContent.job.job_id } });
    assert.equal(crossJob.body.result.isError, true);
    assert.equal(crossJob.body.result.structuredContent.error.code, "software_job_not_found");
  } finally {
    if (mcpA) await close(mcpA.server);
    if (mcpB) await close(mcpB.server);
    await close(core.server);
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});
