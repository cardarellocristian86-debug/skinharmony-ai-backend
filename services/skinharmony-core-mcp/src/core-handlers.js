function textResult(payload) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }]
  };
}

function ownerBindingStatus(config, identity) {
  const tenantIds = config.godModeTenantIds || [config.godModeTenantId].filter(Boolean);
  return {
    kind: identity.kind || "unknown",
    role: identity.role || "standard",
    god_mode: identity.godMode === true,
    owner_confirmation_satisfied: identity.godMode === true,
    binding_checks: {
      enabled: config.godModeEnabled === true,
      emergency_stop: config.godModeEmergencyStop === true,
      tenant_allowed: tenantIds.includes(identity.tenantId),
      subject_allowed: (config.godModeSubjects || []).includes(identity.subject),
      client_allowed: (config.godModeClientIds || []).includes(identity.clientId),
      codex_delegate_allowed: identity.kind === "codex" && config.godModeCodexEnabled === true,
    },
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
    const sanitizedBody = body && typeof body === "object" && !Array.isArray(body)
      ? (({ domain_pack: _domainPack, domain_pack_id: _domainPackId, ...rest }) => rest)(body)
      : body;
    const headers = { accept: "application/json" };
    if (sanitizedBody !== undefined) headers["content-type"] = "application/json";
    headers.authorization = `Bearer ${coreKey(tenantId)}`;
    const response = await fetchImpl(`${config.universalCoreUrl}${path}`, {
      method,
      headers,
      body: sanitizedBody === undefined ? undefined : JSON.stringify(sanitizedBody)
    });
    const payload = await response.json().catch(() => ({ ok: false, error: "invalid_core_response" }));
    if (!response.ok) throw new Error(`core_request_failed:${response.status}:${payload.error || "unknown"}`);
    return payload;
  }

  function ownerContext(identity) {
    return identity.godMode === true
      ? { access_mode: "god_mode", role: "owner_root", delegated_actor: identity.kind, owner_verified: true }
      : { access_mode: "standard", role: identity.role || "standard", owner_verified: false };
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
    const coreAnalysis = await coreRequest(path, identity.tenantId, {
      method: "POST",
      body: { ...args, ...(sharedContext ? { memory_context: sharedContext } : {}), owner_context: ownerContext(identity), tenant_id: identity.tenantId },
    });
    if (options.nyraInterpretation !== true) return textResult(coreAnalysis);

    const interpretationInput = JSON.stringify({
      request: args.request || args.question || args.decision || "",
      workflow_id: coreAnalysis.result?.workflow_id,
      scenarios: coreAnalysis.result?.scenarios?.selected_scenario || null,
      leading_hypothesis: coreAnalysis.result?.hypotheses?.leading_hypothesis || null,
      highest_priority_event: coreAnalysis.result?.events?.highest_priority_event || null,
      preferred_counterfactual: coreAnalysis.result?.counterfactuals?.preferred_counterfactual || null,
      selected_option: coreAnalysis.result?.decision?.selected_option || null,
      requires_more_evidence: coreAnalysis.result?.decision?.requires_more_evidence,
    }).slice(0, 12_000);
    try {
      const nyraInterpretation = await coreRequest("/v1/nira/core-bridge", identity.tenantId, {
        method: "POST",
        body: {
          text: `Interpreta e spiega questo risultato Core senza autorizzare esecuzioni: ${interpretationInput}`,
          request_id: args.workflow_id || args.session_id,
          locale: args.locale || "it",
          mode: "standard",
          ...(sharedContext ? { memory_context: sharedContext } : {}),
          tenant_id: identity.tenantId,
        },
      });
      return textResult({
        ...coreAnalysis,
        nyra_interpretation: nyraInterpretation,
        intelligence_path: { core_analyzed: true, nyra_interpreted: true, execution_allowed: false },
      });
    } catch {
      return textResult({
        ...coreAnalysis,
        nyra_interpretation: { ok: false, error: "nyra_interpretation_unavailable" },
        intelligence_path: { core_analyzed: true, nyra_interpreted: false, execution_allowed: false },
      });
    }
  }

  return {
    core_health: async (_args, identity) => textResult({
      ...(await coreRequest("/healthz", identity.tenantId)),
      tenant_id: identity.tenantId,
      mcp_identity: ownerBindingStatus(config, identity),
    }),
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
          ...(Array.isArray(args.nyra_branches) ? { nyra_branches: args.nyra_branches } : {}),
          ...(Array.isArray(args.available_capabilities) ? { available_capabilities: args.available_capabilities } : {}),
          owner_confirmed: args.owner_confirmed === true || identity.ownerConfirmed === true,
          owner_context: ownerContext(identity),
          ...(args.confirmation_reference || identity.confirmationReference
            ? { confirmation_reference: args.confirmation_reference || identity.confirmationReference }
            : {}),
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
        ...(sharedContext ? { memory_context: sharedContext } : {}),
        tenant_id: identity.tenantId
        }
      }));
    },
    nyra_branch_catalog: async (_args, identity) => textResult(await coreRequest("/v1/nira/branches", identity.tenantId)),
    research_plan: async (args, identity) => textResult(await coreRequest("/v1/research/plan", identity.tenantId, {
      method: "POST",
      body: {
        question: args.question || args.query,
        decision_context: args.decision_context,
        allowed_domains: args.allowed_domains,
        ...(args.domain_pack ? { domain_pack: args.domain_pack } : {}),
        tenant_id: identity.tenantId,
      },
    })),
    research_validate: async (args, identity) => textResult(await coreRequest("/v1/research/validate", identity.tenantId, {
      method: "POST",
      body: {
        evidence_pack: args.evidence_pack || args,
        ...(args.domain_pack ? { domain_pack: args.domain_pack } : {}),
        tenant_id: identity.tenantId,
      },
    })),
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
        owner_context: ownerContext(identity),
        ...(Array.isArray(args.nyra_branches) ? { nyra_branches: args.nyra_branches } : {}),
        ...(Array.isArray(args.available_capabilities) ? { available_capabilities: args.available_capabilities } : {}),
        ...(sharedContext ? { memory_context: sharedContext } : {}),
        tenant_id: identity.tenantId
        }
      }));
    },
    intelligence_workflow: async (args, identity) => intelligenceRequest("/v1/intelligence/workflow", args, identity, { nyraInterpretation: true }),
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
      operation_class: action.operation_class || "reversible_internal_collaboration_write",
      external_side_effect: action.external_side_effect === true,
      contains_customer_data: action.contains_customer_data === true,
      rollback_ready: action.rollback_ready === undefined ? action.external_side_effect !== true : action.rollback_ready === true,
      owner_confirmed: identity.ownerConfirmed === true,
      ...(identity.confirmationReference ? { confirmation_reference: identity.confirmationReference } : {})
    }, identity);
    const payload = result.structuredContent || {};
    const authorization = payload.authorization || {};
    const contract = payload.decision_contract || payload.verdict?.decision_contract || payload.verdict || payload;
    const output = payload.output || {};
    const decision = String(authorization.state || contract.state || contract.decision || "unknown");
    const mediation = String(authorization.mediation || contract.action_mediation?.state || contract.mediation || "unknown");
    const blocked = decision === "block" || decision === "blocked" || mediation === "hard_block" ||
      output.recommended_actions?.some?.((item) => item.blocked === true) === true;
    const confirmationRequired = authorization.confirmation_required === true ||
      (!payload.authorization && (contract.control_level === "confirm" || output.execution_profile?.requires_user_confirmation === true));
    const confirmationSatisfied = authorization.confirmation_satisfied === true ||
      (identity.ownerConfirmed === true && confirmationRequired);
    const legacyExplicitlyAllowed = ["allow", "allowed", "allow_controlled", "allow_advisory"].includes(decision)
      || mediation === "allow";
    const allowed = payload.authorization
      ? authorization.allowed === true && !blocked
      : legacyExplicitlyAllowed && !blocked && (!confirmationRequired || confirmationSatisfied);
    return {
      allowed,
      decision,
      mediation,
      owner_confirmation_required: confirmationRequired,
      confirmation_satisfied: confirmationSatisfied,
    };
  };
}
