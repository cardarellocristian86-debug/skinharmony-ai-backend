function textResult(payload) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }]
  };
}

export function createCoreHandlers(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const contextProvider = options.contextProvider;

  function coreKey(tenantId) {
    const selected = String(config.universalCoreKeys?.[tenantId] || (tenantId === config.defaultTenantId ? config.universalCoreKey : "")).trim();
    if (!selected) throw new Error("core_tenant_key_missing");
    return selected;
  }

  async function coreRequest(path, tenantId, { method = "GET", body } = {}) {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    headers.authorization = `Bearer ${coreKey(tenantId)}`;
    const response = await fetchImpl(`${config.universalCoreUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({ ok: false, error: "invalid_core_response" }));
    if (!response.ok) throw new Error(`core_request_failed:${response.status}:${payload.error || "unknown"}`);
    return payload;
  }

  async function memoryContext(input, identity) {
    if (typeof contextProvider !== "function") return undefined;
    return contextProvider(input, identity);
  }

  async function intelligenceRequest(path, args, identity, options = {}) {
    const sharedContext = options.memory === false ? undefined : await memoryContext({
      query: args.request || args.question || args.decision || args.outcome_id || "Nyra Core intelligence analysis",
      project_id: args.project_id,
      session_id: args.session_id,
      agent_id: args.agent_id || "nyra",
    }, identity);
    return textResult(await coreRequest(path, identity.tenantId, {
      method: "POST",
      body: { ...args, ...(sharedContext ? { memory_context: sharedContext } : {}), tenant_id: identity.tenantId },
    }));
  }

  return {
    core_health: async (_args, identity) => textResult({ ...(await coreRequest("/healthz", identity.tenantId)), tenant_id: identity.tenantId }),
    work_preflight: async (args, identity) => {
      const sharedContext = await memoryContext({
        query: args.request,
        project_id: args.project_id,
        session_id: args.session_id,
        agent_id: args.agent_id || "connected_ai",
      }, identity);
      return textResult(await coreRequest("/v1/work/preflight", identity.tenantId, {
        method: "POST",
        body: {
          request: args.request,
          target_system: args.target_system || "universal_core",
          operation_type: args.operation_type || "advisory_work",
          source_tool: args.tool_name,
          ...(args.domain_pack ? { domain_pack: args.domain_pack } : {}),
          ...(Array.isArray(args.nyra_branches) ? { nyra_branches: args.nyra_branches } : {}),
          ...(Array.isArray(args.available_capabilities) ? { available_capabilities: args.available_capabilities } : {}),
          ...(sharedContext ? { memory_context: sharedContext } : {}),
          tenant_id: identity.tenantId,
        },
      }));
    },
    nyra_runtime_context: async (args, identity) => {
      const sharedContext = await memoryContext({
        query: args.query || "Nyra Core current work decisions and pending handoffs",
        project_id: args.project_id,
        session_id: args.session_id,
        agent_id: args.agent_id || "nyra",
      }, identity);
      return textResult(await coreRequest("/v1/codex/context", identity.tenantId, {
        method: "POST",
        body: {
        task: "ChatGPT requests Nyra runtime context",
        user_input: args.include_control_snapshot ? "Include control snapshot" : "Read readiness context",
        locale: "it",
        ...(args.domain_pack ? { domain_pack: args.domain_pack } : {}),
        ...(sharedContext ? { memory_context: sharedContext } : {}),
        tenant_id: identity.tenantId
        }
      }));
    },
    nyra_branch_catalog: async (_args, identity) => textResult(await coreRequest("/v1/nira/branches", identity.tenantId)),
    nyra_interpret_request: async (args, identity) => {
      const sharedContext = await memoryContext({
        query: args.message,
        project_id: args.project_id,
        session_id: args.session_id,
        agent_id: args.agent_id || "nyra",
      }, identity);
      return textResult(await coreRequest("/v1/nira/core-bridge", identity.tenantId, {
        method: "POST",
        body: {
        text: args.message,
        request_id: args.session_id,
        locale: "it",
        mode: "standard",
        ...(args.domain_pack ? { domain_pack: args.domain_pack } : {}),
        ...(Array.isArray(args.nyra_branches) ? { nyra_branches: args.nyra_branches } : {}),
        ...(Array.isArray(args.available_capabilities) ? { available_capabilities: args.available_capabilities } : {}),
        ...(sharedContext ? { memory_context: sharedContext } : {}),
        tenant_id: identity.tenantId
        }
      }));
    },
    intelligence_workflow: async (args, identity) => intelligenceRequest("/v1/intelligence/workflow", args, identity),
    scenario_analysis: async (args, identity) => intelligenceRequest("/v1/intelligence/scenarios", args, identity),
    hypothesis_rank: async (args, identity) => intelligenceRequest("/v1/intelligence/hypotheses/rank", args, identity),
    event_probability: async (args, identity) => intelligenceRequest("/v1/intelligence/events/evaluate", args, identity),
    counterfactual_analysis: async (args, identity) => intelligenceRequest("/v1/intelligence/counterfactuals/evaluate", args, identity),
    decision_select: async (args, identity) => intelligenceRequest("/v1/intelligence/decisions/select", args, identity),
    outcome_verify: async (args, identity) => intelligenceRequest("/v1/intelligence/outcomes/verify", args, identity),
    outcome_record: async (args, identity) => intelligenceRequest("/v1/intelligence/outcomes/record", args, identity),
    calibration_status: async (args, identity) => textResult(await coreRequest(`/v1/intelligence/calibration?limit=${Number(args.limit || 20)}`, identity.tenantId)),
    core_gate_action: async (args, identity) => {
      const sharedContext = await memoryContext({
        query: `${args.action_label || ""} ${args.action_type || ""}`.trim(),
        project_id: args.project_id,
        session_id: args.session_id,
        agent_id: args.agent_id || "connected_ai",
      }, identity);
      return textResult(await coreRequest("/v1/action-evaluator", identity.tenantId, {
        method: "POST",
        body: { ...args, ...(sharedContext ? { memory_context: sharedContext } : {}), tenant_id: identity.tenantId }
      }));
    }
  };
}

export function createCoreWriteGuard(config, options = {}) {
  const handlers = createCoreHandlers(config, options);
  return async function governWrite(action, identity) {
    const result = await handlers.core_gate_action({
      action_label: action.action_label,
      action_type: action.action_type,
      target: action.target,
      operation_class: "reversible_internal_collaboration_write",
      external_side_effect: false,
      contains_customer_data: false
    }, identity);
    const payload = result.structuredContent || {};
    const verdict = payload.verdict || payload;
    const decision = String(verdict.decision || verdict.decision_state || "unknown");
    const mediation = String(verdict.action_mediation?.state || verdict.mediation || "unknown");
    const blocked = decision === "block" || decision === "blocked" || mediation === "hard_block";
    return { allowed: !blocked, decision, mediation };
  };
}
