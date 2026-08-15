import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../src/app.js";
import { createCoreHandlers } from "../src/core-handlers.js";
import { createDynamicCapabilityHandlers } from "../src/dynamic-capability-router.js";
import { TOOLS } from "../src/tool-definitions.js";
import { WORK_CONTINUITY_TOOLS } from "../src/work-continuity-tools.js";
import { createWorkContinuityRuntime } from "../src/work-continuity-runtime.js";
import { createUniversalCoreService } from "../../universal-core-service/src/app.js";
import { HOST_NATIVE_HEALTH_CONTRACT_DIGEST } from "../../universal-core-service/src/hostNativeGovernance.js";
import { HOST_NATIVE_NYRA_WORK_AUTOMATION } from "../src/host-native-tools.js";

test("Nyra Work Automation v3 requires no provider execution", () => {
  assert.equal(HOST_NATIVE_NYRA_WORK_AUTOMATION.provider_execution, false);
  assert.equal(HOST_NATIVE_NYRA_WORK_AUTOMATION.verifier_assignment, "system_owned");
});

function mapKey(...parts) {
  return parts.join("\u0000");
}

// This pool is an integration persistence boundary, not a substitute for the
// continuity runtime. Every state transition, digest, assignment capability,
// reporter-attestation check and closure material is still produced by the
// production Work Continuity implementation.
class EphemeralContinuityPool {
  constructor(now = () => new Date()) {
    this.now = now;
    this.works = new Map();
    this.bindings = new Map();
    this.anchors = new Map();
    this.events = new Map();
    this.idempotency = new Map();
    this.plans = new Map();
    this.nativeAgents = new Map();
    this.evaluations = new Map();
  }

  async query(sql, parameters = []) {
    const query = sql.replace(/\s+/g, " ").trim();
    if (query.includes("CREATE TABLE IF NOT EXISTS core_continuity_works")) {
      return { rows: [], rowCount: 0 };
    }
    if (query.startsWith("SELECT pg_advisory_xact_lock")) {
      return { rows: [], rowCount: 0 };
    }
    if (query.startsWith("SELECT work_id FROM core_continuity_works")) {
      const work = this.works.get(mapKey(parameters[0], parameters[1]));
      return {
        rows: work ? [{ work_id: work.work_id }] : [],
        rowCount: work ? 1 : 0,
      };
    }

    if (query.startsWith("SELECT work_id,create_request_digest FROM core_continuity_session_bindings")) {
      const row = this.bindings.get(mapKey(parameters[0], parameters[1], parameters[2]));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (query.startsWith("SELECT intent_digest FROM core_continuity_intent_anchors")) {
      const row = this.anchors.get(mapKey(parameters[0], parameters[1]));
      return {
        rows: row ? [{ intent_digest: row.intent_digest }] : [],
        rowCount: row ? 1 : 0,
      };
    }
    if (query.startsWith("SELECT project_id,session_id,anchor,intent_digest,created_by,created_at")) {
      const row = this.anchors.get(mapKey(parameters[0], parameters[1]));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (query.startsWith("INSERT INTO core_continuity_works")) {
      const [
        tenantId,
        projectId,
        workId,
        sessionId,
        parentWorkId,
        idea,
        objective,
        repositoryHash,
        policyHash,
        liveStateHash,
        nextAction,
        createdBy,
      ] = parameters;
      const timestamp = this.now().toISOString();
      this.works.set(mapKey(tenantId, workId), {
        tenant_id: tenantId,
        project_id: projectId,
        work_id: workId,
        session_id: sessionId,
        parent_work_id: parentWorkId,
        idea,
        objective,
        status: "active",
        current_version: 1,
        repository_hash: repositoryHash,
        policy_hash: policyHash,
        live_state_hash: liveStateHash,
        next_action: nextAction,
        created_by: createdBy,
        created_at: timestamp,
        updated_at: timestamp,
      });
      return { rows: [], rowCount: 1 };
    }
    if (query.startsWith("INSERT INTO core_continuity_architecture_versions")) {
      return { rows: [], rowCount: 1 };
    }
    if (query.startsWith("INSERT INTO core_continuity_intent_anchors")) {
      const [
        tenantId,
        workId,
        projectId,
        sessionId,
        anchor,
        intentDigest,
        createRequestDigest,
        createdBy,
      ] = parameters;
      this.anchors.set(mapKey(tenantId, workId), {
        project_id: projectId,
        session_id: sessionId,
        anchor: JSON.parse(anchor),
        intent_digest: intentDigest,
        create_request_digest: createRequestDigest,
        created_by: createdBy,
        created_at: this.now().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (query.startsWith("INSERT INTO core_continuity_session_bindings")) {
      const [tenantId, projectId, sessionId, workId, createRequestDigest] = parameters;
      this.bindings.set(mapKey(tenantId, projectId, sessionId), {
        work_id: workId,
        create_request_digest: createRequestDigest,
      });
      return { rows: [], rowCount: 1 };
    }

    if (query.startsWith("SELECT sequence_number,event_hash FROM core_continuity_events")) {
      const rows = this.events.get(mapKey(parameters[0], parameters[1])) || [];
      return {
        rows: rows.length ? [{ ...rows.at(-1) }] : [],
        rowCount: rows.length ? 1 : 0,
      };
    }
    if (query.startsWith("INSERT INTO core_continuity_events")) {
      const [
        tenantId,
        workId,
        eventId,
        sequenceNumber,
        eventType,
        payload,
        previousEventHash,
        eventHash,
        createdBy,
      ] = parameters;
      const key = mapKey(tenantId, workId);
      const rows = this.events.get(key) || [];
      rows.push({
        event_id: eventId,
        sequence_number: sequenceNumber,
        event_type: eventType,
        payload: JSON.parse(payload),
        previous_event_hash: previousEventHash,
        event_hash: eventHash,
        created_by: createdBy,
      });
      this.events.set(key, rows);
      return { rows: [], rowCount: 1 };
    }

    if (query.startsWith("SELECT operation,request_digest,result FROM core_continuity_idempotency")) {
      const row = this.idempotency.get(mapKey(parameters[0], parameters[1], parameters[2]));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (query.startsWith("INSERT INTO core_continuity_idempotency")) {
      const [tenantId, workId, idempotencyKey, operation, requestDigest, result] = parameters;
      this.idempotency.set(mapKey(tenantId, workId, idempotencyKey), {
        operation,
        request_digest: requestDigest,
        result: JSON.parse(result),
      });
      return { rows: [], rowCount: 1 };
    }

    if (query.startsWith("SELECT w.work_id,a.anchor,a.intent_digest")) {
      const work = this.works.get(mapKey(parameters[0], parameters[1]));
      const anchor = this.anchors.get(mapKey(parameters[0], parameters[1]));
      const row = work && anchor
        ? {
            work_id: work.work_id,
            anchor: anchor.anchor,
            intent_digest: anchor.intent_digest,
          }
        : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (query.startsWith("SELECT plan_id,plan_version FROM core_continuity_native_plans")) {
      const rows = [...this.plans.values()]
        .filter((row) => row.tenant_id === parameters[0] && row.work_id === parameters[1])
        .sort((left, right) => Number(right.plan_version || 1) - Number(left.plan_version || 1) ||
          String(right.created_at).localeCompare(String(left.created_at)) || String(right.plan_id).localeCompare(String(left.plan_id)));
      return { rows: rows.length ? [{ plan_id: rows[0].plan_id, plan_version: rows[0].plan_version || 1 }] : [], rowCount: rows.length ? 1 : 0 };
    }
    if (query.startsWith("INSERT INTO core_continuity_native_plans")) {
      const [tenantId, workId, planId, plan, planDigest, createdBy, changeId, baseStateDigest,
        contractSchema, planVersion, supersedesPlanId] = parameters;
      this.plans.set(mapKey(tenantId, planId), {
        tenant_id: tenantId,
        work_id: workId,
        plan_id: planId,
        plan: JSON.parse(plan),
        plan_digest: planDigest,
        status: "planned",
        created_by: createdBy,
        change_id: changeId,
        base_state_digest: baseStateDigest,
        contract_schema: contractSchema,
        plan_version: planVersion,
        supersedes_plan_id: supersedesPlanId,
        created_at: this.now().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (query.startsWith("INSERT INTO core_continuity_native_receipts")) {
      return { rows: [], rowCount: 1 };
    }
    if (query.startsWith("UPDATE core_continuity_native_agents SET status='expired'")) {
      return { rows: [], rowCount: 0 };
    }
    if (query.startsWith("SELECT plan,status FROM core_continuity_native_plans")) {
      const row = this.plans.get(mapKey(parameters[0], parameters[2]));
      if (!row || row.work_id !== parameters[1]) return { rows: [], rowCount: 0 };
      return {
        rows: [{ plan: row.plan, status: row.status }],
        rowCount: 1,
      };
    }
    if (query.startsWith("SELECT task_id,status FROM core_continuity_native_agents")) {
      const rows = [...this.nativeAgents.values()]
        .filter((row) =>
          row.tenant_id === parameters[0] &&
          row.work_id === parameters[1] &&
          row.plan_id === parameters[2])
        .sort((left, right) => left.task_id.localeCompare(right.task_id))
        .map((row) => ({ task_id: row.task_id, status: row.status }));
      return { rows, rowCount: rows.length };
    }
    if (query.startsWith("SELECT task_id,agent_id,host_type,host_task_id,task_digest,")) {
      const [tenantId, planId, taskId, agentId, hostTaskId] = parameters;
      const row = [...this.nativeAgents.values()].find((candidate) =>
        candidate.tenant_id === tenantId &&
        candidate.plan_id === planId &&
        (
          candidate.task_id === taskId ||
          candidate.agent_id === agentId ||
          candidate.host_task_id === hostTaskId
        ));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (query.startsWith("INSERT INTO core_continuity_native_agents")) {
      const [
        tenantId,
        workId,
        planId,
        taskId,
        agentId,
        hostType,
        hostTaskId,
        taskKind,
        taskDigest,
        coordinatorFingerprint,
        assignmentCapabilityDigest,
        boundBy,
        leaseExpiresAt,
      ] = parameters;
      this.nativeAgents.set(mapKey(tenantId, planId, taskId), {
        tenant_id: tenantId,
        work_id: workId,
        plan_id: planId,
        task_id: taskId,
        agent_id: agentId,
        host_type: hostType,
        host_task_id: hostTaskId,
        task_kind: taskKind,
        task_digest: taskDigest,
        coordinator_session_fingerprint: coordinatorFingerprint,
        assignment_capability_digest: assignmentCapabilityDigest,
        native_session_fingerprint: null,
        native_presence_signature: null,
        status: "bound",
        report: null,
        report_digest: null,
        bound_by: boundBy,
        lease_expires_at: leaseExpiresAt,
      });
      return { rows: [], rowCount: 1 };
    }
    if (query.startsWith("SELECT a.task_id,a.task_kind,a.task_digest,a.status,a.report_digest,")) {
      const [tenantId, workId, planId, agentId] = parameters;
      const row = [...this.nativeAgents.values()].find((candidate) =>
        candidate.tenant_id === tenantId &&
        candidate.work_id === workId &&
        candidate.plan_id === planId &&
        candidate.agent_id === agentId);
      const plan = this.plans.get(mapKey(tenantId, planId));
      return {
        rows: row && plan ? [{ ...row, plan: plan.plan, plan_status: plan.status }] : [],
        rowCount: row && plan ? 1 : 0,
      };
    }
    if (query.startsWith("SELECT task_id FROM core_continuity_native_agents")) {
      const [tenantId, planId, nativeSessionFingerprint, agentId] = parameters;
      const row = [...this.nativeAgents.values()].find((candidate) =>
        candidate.tenant_id === tenantId &&
        candidate.plan_id === planId &&
        candidate.native_session_fingerprint === nativeSessionFingerprint &&
        candidate.agent_id !== agentId);
      return { rows: row ? [{ task_id: row.task_id }] : [], rowCount: row ? 1 : 0 };
    }
    if (query.startsWith("UPDATE core_continuity_native_agents SET status=")) {
      const [
        tenantId,
        workId,
        planId,
        agentId,
        status,
        report,
        reportDigest,
        nativeSessionFingerprint,
        nativePresenceSignature,
      ] = parameters;
      const row = [...this.nativeAgents.values()].find((candidate) =>
        candidate.tenant_id === tenantId &&
        candidate.work_id === workId &&
        candidate.plan_id === planId &&
        candidate.agent_id === agentId);
      assert(row, "native agent update target must exist");
      row.status = status;
      row.report = JSON.parse(report);
      row.report_digest = reportDigest;
      row.native_session_fingerprint = nativeSessionFingerprint;
      row.native_presence_signature = nativePresenceSignature;
      return { rows: [], rowCount: 1 };
    }
    if (query.startsWith("SELECT task_id,agent_id,task_kind,status,report,report_digest")) {
      const rows = [...this.nativeAgents.values()]
        .filter((row) =>
          row.tenant_id === parameters[0] &&
          row.work_id === parameters[1] &&
          row.plan_id === parameters[2])
        .sort((left, right) => left.task_id.localeCompare(right.task_id))
        .map((row) => ({ ...row }));
      return { rows, rowCount: rows.length };
    }
    if (query.startsWith("SELECT p.plan,p.plan_digest,p.status,a.intent_digest")) {
      const plan = this.plans.get(mapKey(parameters[0], parameters[2]));
      const anchor = this.anchors.get(mapKey(parameters[0], parameters[1]));
      if (!plan || plan.work_id !== parameters[1] || !anchor) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{
          plan: plan.plan,
          plan_digest: plan.plan_digest,
          status: plan.status,
          intent_digest: anchor.intent_digest,
        }],
        rowCount: 1,
      };
    }
    if (query.startsWith("INSERT INTO core_continuity_closure_evaluations")) {
      const [
        tenantId,
        workId,
        planId,
        evaluationId,
        evaluation,
        evaluationDigest,
        evaluatedBy,
      ] = parameters;
      const key = mapKey(tenantId, workId, planId);
      const rows = this.evaluations.get(key) || [];
      rows.push({
        evaluation_id: evaluationId,
        evaluation: JSON.parse(evaluation),
        evaluation_digest: evaluationDigest,
        evaluated_by: evaluatedBy,
        created_at: this.now().toISOString(),
      });
      this.evaluations.set(key, rows);
      return { rows: [], rowCount: 1 };
    }
    if (query.startsWith("UPDATE core_continuity_works SET next_action=")) {
      const work = this.works.get(mapKey(parameters[0], parameters[1]));
      assert(work, "continuity work update target must exist");
      work.next_action = parameters[2];
      work.updated_at = this.now().toISOString();
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`ephemeral_continuity_query_not_implemented:${query.slice(0, 180)}`);
  }

  async end() {}
}

function textResult(payload) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

function internalActionType(toolName) {
  if (toolName.includes("native_plan")) return "native_agent.plan";
  if (toolName.includes("native_bind")) return "native_agent.bind";
  if (toolName.includes("native_report")) return "native_agent.report";
  if (toolName.includes("closure")) return "native_agent.verify";
  return "continuity.update";
}

function collectNamedFlags(value, targetKey, flags = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectNamedFlags(item, targetKey, flags);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === targetKey) flags.push(item);
      collectNamedFlags(item, targetKey, flags);
    }
  }
  return flags;
}

test("host-native MCP to Core reaches independently attested closure material with zero provider calls", async () => {
  const originalFetch = globalThis.fetch;
  const environmentKeys = [
    "CORE_SERVICE_ADMIN_KEY",
    "OPENAI_API_KEY",
    "NYRA_OPENAI_RESEARCH_ENABLED",
    "NYRA_TENANT_OPENAI_MODEL",
  ];
  const previousEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "host-native-zero-provider-"));
  const poisonKey = "sk-proj-POISON-THIS-KEY-MUST-NEVER-BE-READ";
  const coreAdminKey = "host-native-zero-provider-core-admin";
  const tenantGatewayKey =
    "host-native-zero-provider-tenant-gateway-key";
  const tenantContextSigningSecret =
    "host-native-zero-provider-tenant-context-signing-secret";
  const codexKey = "host-native-zero-provider-codex";
  const appendedToolNames = [];
  let coreServer;
  let mcpServer;

  process.env.CORE_SERVICE_ADMIN_KEY = coreAdminKey;
  process.env.OPENAI_API_KEY = poisonKey;
  process.env.NYRA_OPENAI_RESEARCH_ENABLED = "true";
  process.env.NYRA_TENANT_OPENAI_MODEL = "provider-model-must-not-run";

  try {
    const { app: coreApp } = createUniversalCoreService({
      storageRoot,
      hostNativeGovernanceEnabled: false,
      mcpTenantGatewayKey: tenantGatewayKey,
      tenantContextSigningSecret,
      openAiFetchImpl: (...args) => globalThis.fetch(...args),
    });
    coreServer = http.createServer(coreApp);
    await new Promise((resolve) => coreServer.listen(0, "127.0.0.1", resolve));
    const coreOrigin = `http://127.0.0.1:${coreServer.address().port}`;

    const routedCoreCalls = [];
    const forbiddenProviderCalls = [];
    const guardedFetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      const providerRoute =
        /(^|\.)openai\.com$/i.test(url.hostname) ||
        /\/generic-agents\/providers\/openai(?:\/|$)/i.test(url.pathname) ||
        /provider-status|setup-links|multi-agent-runs|byok/i.test(url.pathname);
      if (providerRoute) {
        forbiddenProviderCalls.push({ url: url.toString(), method: init?.method || "GET" });
        throw new Error(`provider_network_forbidden:${url.origin}${url.pathname}`);
      }
      if (url.origin !== coreOrigin) {
        throw new Error(`unexpected_network_destination:${url.origin}`);
      }
      routedCoreCalls.push({
        method: init?.method || "GET",
        path: url.pathname,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return originalFetch(input, init);
    };
    globalThis.fetch = guardedFetch;

    const generatedCoreKeyResponse = await guardedFetch(
      `${coreOrigin}/v1/keys/generate`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${coreAdminKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tenant_id: "owner-private",
          key_type: "automation",
          allowed_scopes: ["read:decision", "automation:codex"],
        }),
      },
    );
    const generatedCoreKey = await generatedCoreKeyResponse.json();
    assert.equal(generatedCoreKeyResponse.status, 201, JSON.stringify(generatedCoreKey));
    assert.equal(typeof generatedCoreKey.key, "string");

    const config = {
      publicUrl: "https://mcp.zero-provider.test",
      resource: "https://mcp.zero-provider.test/mcp",
      auth0Issuer: "",
      auth0Audience: "",
      jwksUri: "",
      codexKeys: [codexKey],
      codexScopes: ["core:read", "core:govern"],
      defaultTenantId: "owner-private",
      supportedScopes: ["core:read", "core:govern"],
      universalCoreUrl: coreOrigin,
      universalCoreKey: generatedCoreKey.key,
      universalCoreKeys: {},
      tenantGatewayKey,
      tenantContextSigningSecret,
      agentSignatureSecret: "zero-provider-agent-presence-signing-secret",
      dttAgentIdentitySigningSecret:
        "zero-provider-assignment-and-closure-signing-secret",
      godModeEnabled: true,
      godModeCodexEnabled: true,
      godModeTenantIds: ["owner-private"],
      godModeEmergencyStop: false,
      openaiApiKey: poisonKey,
      openaiResearchEnabled: true,
    };
    const pool = new EphemeralContinuityPool();
    const continuity = createWorkContinuityRuntime(config, { pool });
    const coreHandlers = createCoreHandlers(config, { fetchImpl: guardedFetch });

    const requiredTools = new Set([
      "work_continuity_start_or_resume",
      "work_continuity_native_plan",
      "work_continuity_native_bind",
      "work_continuity_native_report",
      "work_continuity_closure_evaluate",
    ]);
    for (const tool of WORK_CONTINUITY_TOOLS) {
      if (!requiredTools.has(tool.name) || TOOLS.some((item) => item.name === tool.name)) continue;
      TOOLS.push(tool);
      appendedToolNames.push(tool.name);
    }
    assert.equal(appendedToolNames.length, requiredTools.size);

    const baseHandlers = {
      core_health: coreHandlers.core_health,
      work_preflight: coreHandlers.work_preflight,
      work_continuity_start_or_resume: async (args, identity) =>
        textResult({
          ok: true,
          result: await continuity.ensure(identity, args, { creationAuthorized: true }),
          dedicated_core_gate: {
            authorized: true,
            authority: "universal_core",
            route: "/v1/action-evaluator",
            server_owned: true,
          },
        }),
      work_continuity_native_plan: async (args, identity) => {
        const intent = await continuity.readIntent(identity, { work_id: args.work_id });
        const corePlanResult = await coreHandlers.host_native_work_plan_create({
          work_id: args.work_id,
          intent_anchor_digest: intent.intent_digest,
          repository: args.repository,
          base_branch: args.base_branch,
          objective: intent.anchor.objective,
          required_checks: args.required_checks,
          agents: args.tasks.map((task) => ({
            agent_id: task.task_id,
            role: task.kind,
            task: task.instruction,
            depends_on: task.dependencies || [],
            capabilities: [],
          })),
          max_parallel: args.max_parallel,
        }, identity);
        return textResult({
          ok: true,
          result: await continuity.planNativeAgents(identity, args, {
            corePlan: corePlanResult.structuredContent.plan,
          }),
        });
      },
      work_continuity_native_bind: async (args, identity) =>
        textResult({
          ok: true,
          result: await continuity.bindNativeAgent(identity, args),
        }),
      work_continuity_native_report: async (args, identity) =>
        textResult({
          ok: true,
          result: await continuity.reportNativeAgent(identity, args),
        }),
      work_continuity_closure_evaluate: async (args, identity) => {
        const evaluation = await continuity.evaluateClosure(identity, args);
        assert.equal(evaluation.closed, true);
        const releaseIntentResult = await coreHandlers.host_native_release_intent_build(
          evaluation.core_join_material.release_intent_request,
          identity,
        );
        return textResult({
          ok: true,
          result: {
            ...evaluation,
            core_release_intent: releaseIntentResult.structuredContent.release_intent,
          },
        });
      },
    };

    const dynamicHandlers = createDynamicCapabilityHandlers({
      tools: TOOLS,
      handlers: baseHandlers,
      semanticSelect: coreHandlers.core_semantic_select,
      gateAction: ({ tool, identity, catalogRevision, idempotencyKey }) =>
        coreHandlers.core_gate_action({
          action_label: `Invoke host-native integration capability ${tool.name}`,
          action_type: internalActionType(tool.name),
          target: tool.name,
          operation_class: "bounded_internal_coordination_write",
          external_side_effect: false,
          contains_customer_data: false,
          contains_secret: false,
          secret_value_transmitted: false,
          cross_tenant: false,
          configuration_changes: false,
          destructive: false,
          bypass_orchestrator: false,
          legal_violation: false,
          provider_execution: false,
          bounded_scope: true,
          low_impact: true,
          idempotent_or_compensable: true,
          rollback_ready: true,
          audit_ready: true,
          target_authority_verified: true,
          actor_authorized_for_target: true,
          catalog_revision: catalogRevision,
          idempotency_key: idempotencyKey,
          owner_confirmed: false,
        }, identity),
    });
    const mcpApp = createApp(config, {
      handlers: { ...baseHandlers, ...dynamicHandlers },
      toolSurface: "compact",
    });
    mcpServer = mcpApp.listen(0, "127.0.0.1");
    await new Promise((resolve) => mcpServer.once("listening", resolve));
    const mcpOrigin = `http://127.0.0.1:${mcpServer.address().port}`;

    const mcpRequest = async ({
      transport,
      name,
      arguments: toolArguments,
      id,
    }) => {
      const response = await originalFetch(`${mcpOrigin}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${codexKey}`,
          "content-type": "application/json",
          "mcp-session-id": transport,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: toolArguments },
        }),
      });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      assert.equal(payload.error, undefined, JSON.stringify(payload));
      assert.notEqual(payload.result?.isError, true, JSON.stringify(payload.result));
      return payload.result?.structuredContent;
    };

    const listedTools = await originalFetch(`${mcpOrigin}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${codexKey}`,
        "content-type": "application/json",
        "mcp-session-id": "coordinator-transport",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    }).then((response) => response.json());
    assert.equal(
      listedTools.result.tools.some((tool) => tool.name.startsWith("tenant_provider_")),
      false,
    );

    const coordinatorPresence = {
      agent_id: "root-coordinator",
      client_type: "codex",
      session_id: "coordinator-logical-session",
    };
    const catalog = await mcpRequest({
      transport: "coordinator-transport",
      name: "core_capability_catalog",
      arguments: {
        ...coordinatorPresence,
        capability_id: "work_continuity_start_or_resume",
        include_schema: true,
      },
      id: 2,
    });
    const catalogRevision = catalog.catalog_revision;
    assert.match(catalogRevision, /^[a-f0-9]{64}$/);

    const invoke = async ({
      transport,
      presence,
      capability,
      arguments: targetArguments,
      idempotencyKey,
      id,
    }) => mcpRequest({
      transport,
      name: "core_capability_invoke",
      arguments: {
        ...presence,
        capability_id: capability,
        catalog_revision: catalogRevision,
        arguments: targetArguments,
        idempotency_key: idempotencyKey,
        owner_confirmed: targetArguments.owner_confirmed === true,
        confirmation_reference: targetArguments.confirmation_reference,
      },
      id,
    });

    const started = await invoke({
      transport: "coordinator-transport",
      presence: coordinatorPresence,
      capability: "work_continuity_start_or_resume",
      arguments: {
        project_id: "zero-provider-integration",
        session_id: "coordinator-logical-session",
        initial_message:
          "Complete this work with native Codex children and independent verification.",
        idea: "Prove host-native execution has no model-provider dependency.",
        objective: "Produce independently verified closure material without provider calls.",
        acceptance_criteria: [
          "Core plan, assignment receipts and closure material are produced.",
        ],
        constraints: ["Provider execution remains disabled."],
        architecture: {
          components: ["mcp", "universal-core", "host-native-continuity"],
        },
        next_action: "Create the bounded native plan.",
        host_type: "codex_native",
        owner_confirmed: true,
        confirmation_reference: "bootstrap the isolated host-native work",
      },
      idempotencyKey: "invoke-start-zero-provider-0001",
      id: 3,
    });
    const work = started.result;
    assert.match(work.work_id, /^[0-9a-f-]{36}$/);

    const plannedPayload = await invoke({
      transport: "coordinator-transport",
      presence: coordinatorPresence,
      capability: "work_continuity_native_plan",
      arguments: {
        work_id: work.work_id,
        repository: "owner/repo",
        base_branch: "main",
        host_type: "codex_native",
        required_checks: ["unit-tests"],
        tasks: [
          {
            task_id: "build",
            kind: "builder",
            instruction: "Implement the bounded change and run unit tests.",
          },
          {
            task_id: "verify",
            kind: "verifier",
            instruction: "Independently verify the builder commit and evidence.",
            dependencies: ["build"],
          },
        ],
        max_parallel: 2,
        closure_requirements: {
          independent_verifier_required: true,
          tests_required: true,
          evidence_required: true,
          live_verification_required: true,
        },
      },
      idempotencyKey: "invoke-plan-zero-provider-0001",
      id: 4,
    });
    const planned = plannedPayload.result;
    assert.equal(planned.plan.provider_execution, false);
    assert.equal(planned.plan.provider_api_key_required, false);
    assert.equal(planned.plan.core_authority.provider_execution, false);
    assert.equal(planned.receipt.provider_execution, false);

    const builderBindingPayload = await invoke({
      transport: "coordinator-transport",
      presence: coordinatorPresence,
      capability: "work_continuity_native_bind",
      arguments: {
        work_id: work.work_id,
        plan_id: planned.plan.plan_id,
        task_id: "build",
        native_agent_id: "native-builder",
        host_type: "codex_native",
        host_task_id: "/root/native-builder",
      },
      idempotencyKey: "invoke-bind-builder-zero-provider-0001",
      id: 5,
    });
    const builderBinding = builderBindingPayload.result;
    assert.match(builderBinding.assignment_capability, /^hnac_[A-Za-z0-9_-]{43}$/);
    assert.equal(builderBinding.receipt.provider_execution, false);

    const targetCommit = "b".repeat(40);
    const builderReportPayload = await invoke({
      transport: "builder-transport",
      presence: {
        agent_id: "native-builder",
        client_type: "codex",
        session_id: "builder-logical-session",
      },
      capability: "work_continuity_native_report",
      arguments: {
        work_id: work.work_id,
        plan_id: planned.plan.plan_id,
        native_agent_id: "native-builder",
        host_task_id: "/root/native-builder",
        assignment_capability: builderBinding.assignment_capability,
        status: "completed",
        report: {
          summary: "Implemented the bounded change and all tests pass.",
          commit_sha: targetCommit,
          tests: [{ name: "node --test", passed: true }],
          evidence_refs: [`commit:${targetCommit}`, "test:node"],
        },
      },
      idempotencyKey: "invoke-report-builder-zero-provider-0001",
      id: 6,
    });
    assert.equal(builderReportPayload.result.receipt.provider_execution, false);

    const verifierBindingPayload = await invoke({
      transport: "coordinator-transport",
      presence: coordinatorPresence,
      capability: "work_continuity_native_bind",
      arguments: {
        work_id: work.work_id,
        plan_id: planned.plan.plan_id,
        task_id: "verify",
        native_agent_id: "native-verifier",
        host_type: "codex_native",
        host_task_id: "/root/native-verifier",
      },
      idempotencyKey: "invoke-bind-verifier-zero-provider-0001",
      id: 7,
    });
    const verifierBinding = verifierBindingPayload.result;
    assert.match(verifierBinding.assignment_capability, /^hnac_[A-Za-z0-9_-]{43}$/);
    assert.equal(verifierBinding.receipt.provider_execution, false);

    const acceptanceEvidence = planned.plan.acceptance_contract.criteria.map((criterion) => ({
      criterion_digest: criterion.criterion_digest,
      passed: true,
      evidence_refs: [`verified:${criterion.criterion_id}`],
    }));
    const verifierReportPayload = await invoke({
      transport: "verifier-transport",
      presence: {
        agent_id: "native-verifier",
        client_type: "codex",
        session_id: "verifier-logical-session",
      },
      capability: "work_continuity_native_report",
      arguments: {
        work_id: work.work_id,
        plan_id: planned.plan.plan_id,
        native_agent_id: "native-verifier",
        host_task_id: "/root/native-verifier",
        assignment_capability: verifierBinding.assignment_capability,
        status: "completed",
        report: {
          summary: "Independently verified the exact builder commit and acceptance contract.",
          verdict: "approved",
          commit_sha: targetCommit,
          tests: [{ name: "independent node --test", passed: true }],
          evidence_refs: [`reviewed-commit:${targetCommit}`, "review:test-output"],
          acceptance_evidence: acceptanceEvidence,
          verifies_task_ids: ["build"],
          live_verified: true,
          correction_required: false,
        },
      },
      idempotencyKey: "invoke-report-verifier-zero-provider-0001",
      id: 8,
    });
    assert.equal(verifierReportPayload.result.receipt.provider_execution, false);

    const baseCommit = "a".repeat(40);
    const closurePayload = await invoke({
      transport: "coordinator-transport",
      presence: coordinatorPresence,
      capability: "work_continuity_closure_evaluate",
      arguments: {
        work_id: work.work_id,
        plan_id: planned.plan.plan_id,
        release: {
          base_branch: "main",
          delivery_branch: "agent/zero-provider",
          base_commit: baseCommit,
          head_commit: targetCommit,
          tree_sha: "c".repeat(40),
          diff_digest: "d".repeat(64),
          changed_files: ["services/skinharmony-core-mcp/src/app.js"],
          delivery: {
            method: "github_branch_push_auto_deploy",
            services: [{
              service_id: "skinharmony-core-mcp",
              environment: "staging",
              expected_previous_commit: baseCommit,
              target_commit: targetCommit,
              target_resolution: "exact_commit",
              health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
            }],
          },
          rollback: {
            mode: "redeploy_previous_commit",
            target_commit: baseCommit,
            health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
            ready: true,
          },
        },
      },
      idempotencyKey: "invoke-closure-zero-provider-0001",
      id: 9,
    });
    const closure = closurePayload.result;
    assert.equal(closure.closed, true);
    assert.deepEqual(closure.missing, []);
    assert.equal(
      closure.core_join_material.schema_version,
      "continuity_core_join_material_v1",
    );
    assert.equal(
      closure.core_join_material.core_join_request.provider_execution,
      false,
    );
    assert.equal(
      closure.core_join_material.core_join_request.closure_attestation
        .provider_execution,
      false,
    );
    assert.equal(closure.core_release_intent.schema_version, "host_release_intent_v1");

    const observedHostNativeState = {
      planned,
      builderBinding,
      builderReport: builderReportPayload.result,
      verifierBinding,
      verifierReport: verifierReportPayload.result,
      closure,
    };
    const providerFlags = collectNamedFlags(
      observedHostNativeState,
      "provider_execution",
    );
    assert(providerFlags.length >= 8);
    assert(providerFlags.every((value) => value === false));
    const providerKeyFlags = collectNamedFlags(
      observedHostNativeState,
      "provider_api_key_required",
    );
    assert(providerKeyFlags.length >= 2);
    assert(providerKeyFlags.every((value) => value === false));
    assert.equal(forbiddenProviderCalls.length, 0);
    assert.equal(JSON.stringify(routedCoreCalls).includes(poisonKey), false);

    const corePaths = routedCoreCalls.map((call) => call.path);
    assert(corePaths.includes("/v1/host-native/work-plans"));
    assert(corePaths.includes("/v1/host-native/release-intents"));
    // Bootstrap uses its server-owned dedicated Core gate; the remaining
    // host-native capabilities continue to use the generic evaluator.
    assert(corePaths.filter((route) => route === "/v1/action-evaluator").length >= 6);
    assert.equal(
      corePaths.some((route) => /providers\/openai|setup-links|multi-agent-runs/i.test(route)),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (mcpServer) {
      await new Promise((resolve) => mcpServer.close(resolve));
    }
    if (coreServer) {
      await new Promise((resolve) => coreServer.close(resolve));
    }
    for (const name of appendedToolNames) {
      const index = TOOLS.findIndex((tool) => tool.name === name);
      if (index >= 0) TOOLS.splice(index, 1);
    }
    for (const key of environmentKeys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});
