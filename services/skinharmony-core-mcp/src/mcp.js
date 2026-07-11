import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createCoreClient, createNyraClient, UpstreamError } from "./upstream.js";

export const SERVER_INSTRUCTIONS = `MANDATORY: Before any write, deploy, publish, merge, deletion, pricing, claim, finance, customer-data, or cross-tenant action, call core_gate_action. Never set or infer owner confirmation. If Core returns BLOCK, CONFIRM, DEFER, SANDBOX, or execution_allowed=false, do not execute the action; explain the verdict and request the required owner step. Use Nyra context before planning material SkinHarmony changes. Read-only inspection may proceed. Universal Core decides; Nyra interprets; the model executes only allowed actions.`;

function textResult(structuredContent) {
  return {
    structuredContent,
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
  };
}

function errorResult(error) {
  const structuredContent = {
    ok: false,
    error: error instanceof UpstreamError ? error.code : "internal_error",
    message: String(error.message || "Unknown error").slice(0, 500),
    retryable: error instanceof UpstreamError ? error.status >= 500 : false,
  };
  return { ...textResult(structuredContent), isError: true };
}

function gateErrorResult(error) {
  const code = error instanceof UpstreamError ? error.code : "internal_error";
  const structuredContent = {
    verdict: "DEFER",
    mediation: "defer",
    execution_allowed: false,
    owner_confirmation_required: false,
    risk_band: "unknown",
    risk_score: null,
    reasons: [code],
    next_step: "restore_core_connection_then_recheck",
    tenant_id: "",
    schema_version: "policy_engine_v1_fail_closed",
  };
  return { ...textResult(structuredContent), isError: true };
}

export function createSkinHarmonyMcpServer(options = {}) {
  const core = options.coreClient || createCoreClient(options.core || {});
  const nyra = options.nyraClient || createNyraClient(options.nyra || {});
  const server = new McpServer(
    { name: "skinharmony-core-nyra", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS, capabilities: { logging: {} } },
  );

  server.registerTool("core_health", {
    title: "Universal Core health",
    description: "Read Universal Core service health before depending on governance decisions.",
    inputSchema: {},
    outputSchema: { ok: z.boolean(), health: z.record(z.string(), z.unknown()).optional(), error: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try {
      return textResult({ ok: true, health: await core.health() });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("core_gate_action", {
    title: "Universal Core action gate",
    description: "Mandatory governance check before any SkinHarmony write, merge, deploy, publish, pricing, claim, finance, customer-data, or cross-tenant action. This tool evaluates only; it never executes the action and never accepts owner confirmation from the model.",
    inputSchema: {
      tenant_id: z.string().min(1).max(120).default("codexai"),
      action_type: z.enum(["read", "code_edit", "test", "write", "update", "merge", "deploy", "publish", "delete", "pricing", "claim_validation", "finance", "customer_data", "cross_tenant", "workflow_decision"]),
      action_label: z.string().min(1).max(240),
      risk_hint: z.number().min(0).max(100).default(35),
      contains_pii: z.boolean().default(false),
      cross_tenant: z.boolean().default(false),
      rollback_ready: z.boolean().default(false),
      sandbox: z.boolean().default(false),
      required_branches: z.array(z.string().max(120)).max(30).default([]),
    },
    outputSchema: {
      verdict: z.enum(["ALLOW", "CONFIRM", "BLOCK", "DEFER", "SANDBOX"]),
      mediation: z.string(),
      execution_allowed: z.boolean(),
      owner_confirmation_required: z.boolean(),
      risk_band: z.string(),
      risk_score: z.number().nullable(),
      reasons: z.array(z.string()),
      next_step: z.string(),
      tenant_id: z.string(),
      schema_version: z.string(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    try {
      return textResult(await core.gateAction(input));
    } catch (error) {
      return gateErrorResult(error);
    }
  });

  server.registerTool("nyra_runtime_context", {
    title: "Nyra runtime context",
    description: "Load Nyra readiness and optional control snapshot before planning material SkinHarmony work.",
    inputSchema: { include_control_snapshot: z.boolean().default(false) },
    outputSchema: {
      ok: z.boolean(),
      readiness: z.record(z.string(), z.unknown()).optional(),
      control: z.record(z.string(), z.unknown()).optional(),
      error: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ include_control_snapshot }) => {
    try {
      const readiness = await nyra.readiness();
      const control = include_control_snapshot ? await nyra.controlSnapshot() : undefined;
      return textResult({ ok: true, readiness, ...(control ? { control } : {}) });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("nyra_interpret_request", {
    title: "Nyra request interpretation",
    description: "Ask Nyra to interpret a SkinHarmony request using its dialogue, memory, and governance context. It does not authorize or execute actions; Core remains final judge.",
    inputSchema: {
      message: z.string().min(1).max(8_000),
      session_id: z.string().min(1).max(160).default("codex-mcp"),
    },
    outputSchema: { ok: z.boolean(), interpretation: z.record(z.string(), z.unknown()).optional(), error: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ message, session_id }) => {
    try {
      return textResult({ ok: true, interpretation: await nyra.interpret(message, session_id) });
    } catch (error) {
      return errorResult(error);
    }
  });

  return server;
}
