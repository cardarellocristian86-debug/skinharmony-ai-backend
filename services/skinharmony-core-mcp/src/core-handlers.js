function textResult(payload) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }]
  };
}

export function createCoreHandlers(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;

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

  return {
    core_health: async (_args, identity) => textResult({ ...(await coreRequest("/healthz", identity.tenantId)), tenant_id: identity.tenantId }),
    nyra_runtime_context: async (args, identity) => textResult(await coreRequest("/v1/codex/context", identity.tenantId, {
      method: "POST",
      body: {
        task: "ChatGPT requests Nyra runtime context",
        user_input: args.include_control_snapshot ? "Include control snapshot" : "Read readiness context",
        locale: "it",
        ...(args.domain_pack ? { domain_pack: args.domain_pack } : {}),
        tenant_id: identity.tenantId
      }
    })),
    nyra_branch_catalog: async (_args, identity) => textResult(await coreRequest("/v1/nira/branches", identity.tenantId)),
    nyra_interpret_request: async (args, identity) => textResult(await coreRequest("/v1/nira/core-bridge", identity.tenantId, {
      method: "POST",
      body: {
        text: args.message,
        request_id: args.session_id,
        locale: "it",
        mode: "standard",
        ...(args.domain_pack ? { domain_pack: args.domain_pack } : {}),
        ...(Array.isArray(args.nyra_branches) ? { nyra_branches: args.nyra_branches } : {}),
        tenant_id: identity.tenantId
      }
    })),
    core_gate_action: async (args, identity) => textResult(await coreRequest("/v1/action-evaluator", identity.tenantId, {
      method: "POST",
      body: { ...args, tenant_id: identity.tenantId }
    }))
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
