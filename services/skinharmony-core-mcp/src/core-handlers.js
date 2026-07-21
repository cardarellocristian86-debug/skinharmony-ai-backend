import crypto from "node:crypto";
import { attachSharedMemoryBootstrap } from "./shared-memory-bootstrap.js";
import { createAgentPresence } from "./agent-presence.js";
import { issueOpenAiProviderSetupLink } from "./provider-setup-link-client.js";
import {
  PROVIDER_SETUP_LINK_BINDING_OPERATION_CLASS,
  buildProviderSetupLinkBindingEnvelope,
  providerSetupLinkBindingApprovalDigest,
} from "../../universal-core-service/src/providerSetupLinkBinding.js";

const OWNER_CONTEXT_ASSERTION_VERSION = "owner_context_assertion_v1";

function tenantContextHeader(tenantId, signingSecret) {
  if (!signingSecret || signingSecret.length < 32) return "";
  const context = { version: "mcp_tenant_context_v1", tenant_id: tenantId, issued_at: new Date().toISOString() };
  const canonical = JSON.stringify(context);
  const assertion = `mtc_${crypto.createHmac("sha256", signingSecret).update(`mcp-tenant-context\u0000${canonical}`).digest("hex")}`;
  return Buffer.from(JSON.stringify({ ...context, assertion })).toString("base64url");
}

function ownerContextCanonical(context) {
  return JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
    owner_subject_fingerprint: context.owner_subject_fingerprint,
    issued_at: context.issued_at,
    binding_version: context.binding_version,
    binding_hash: context.binding_hash,
    approval_digest: context.approval_digest,
  });
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function ownerRequestBinding(purpose, body = {}) {
  const { owner_context: _ownerContext, ...payload } = body;
  return `${purpose}\u0000${JSON.stringify(stableCanonical(payload))}`;
}

function textResult(payload) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }]
  };
}

function compactTextResult(payload, narration = {}) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(narration) }],
  };
}

function compactMemoryContext(memory) {
  if (!memory || typeof memory !== "object") return null;
  return {
    schema_version: memory.schema_version,
    tenant_id: memory.tenant_id,
    revision: Number(memory.revision || 0),
    relevant_count: Array.isArray(memory.relevant_memories) ? memory.relevant_memories.length : 0,
    handoff_count: Array.isArray(memory.pending_handoffs) ? memory.pending_handoffs.length : 0,
    recent_activity_count: Array.isArray(memory.recent_activity) ? memory.recent_activity.length : 0,
  };
}

function compactBootstrap(bootstrap) {
  if (!bootstrap || typeof bootstrap !== "object") return undefined;
  return {
    loaded: bootstrap.loaded === true,
    tenant_id: bootstrap.tenant_id,
    generated_at: bootstrap.generated_at,
    active_task_count: Number(bootstrap.active_task_count || 0),
    active_lock_count: Number(bootstrap.active_lock_count || 0),
    artifact_count: Number(bootstrap.artifact_count || 0),
    latest_handoff: bootstrap.latest_handoff,
    recent_tasks: Array.isArray(bootstrap.recent_tasks) ? bootstrap.recent_tasks.slice(0, 5) : [],
    recent_artifacts: Array.isArray(bootstrap.recent_artifacts) ? bootstrap.recent_artifacts.slice(0, 5) : [],
    ...(bootstrap.loaded === false ? { missing_files: bootstrap.missing_files || [] } : {}),
  };
}

function compactWorkPreflight(preflight) {
  if (!preflight || typeof preflight !== "object") return null;
  return {
    schema_version: preflight.schema_version,
    preflight_id: preflight.preflight_id,
    tenant_id: preflight.tenant_id,
    state: preflight.state,
    mandatory: preflight.mandatory === true,
    governance: preflight.governance,
    gate: preflight.gate,
    tool_routing: preflight.tool_routing?.preferred_route
      ? { preferred_route: preflight.tool_routing.preferred_route }
      : preflight.tool_routing,
    shared_memory_bootstrap: compactBootstrap(preflight.shared_memory_bootstrap),
  };
}

function compactCoreRuntime(payload) {
  const result = payload?.result || payload || {};
  const router = result.router || {};
  return {
    hierarchy_version: result.hierarchy_version || "core_runtime_hierarchy_v1",
    mode: result.mode || "shadow",
    route: router.route || null,
    selected_authority: result.selected_authority || "V1",
    parity: {
      attempted: result.parity?.attempted === true,
      matched: result.parity?.matched ?? null,
      fallback: result.parity?.fallback || null,
      ...(result.parity?.error ? { error: "v2_unavailable_or_mismatch" } : {}),
    },
    execution_allowed: false,
    latency_ms: Number.isFinite(Number(payload?.latency_ms)) ? Number(payload.latency_ms) : null,
  };
}

function compactNyraNetwork(network) {
  if (!network || typeof network !== "object") return null;
  return {
    schema_version: network.schema_version,
    domain_pack_id: network.domain_pack_id,
    opened_by: network.opened_by,
    opened_branches: Array.isArray(network.opened_branches)
      ? network.opened_branches.map((branch) => ({ id: branch.id, work_phase: branch.work_phase }))
      : [],
    denied_branches: network.denied_branches || [],
    parallel_analysis: {
      enabled: network.parallel_analysis?.enabled === true,
      wave_count: Array.isArray(network.parallel_analysis?.waves) ? network.parallel_analysis.waves.length : 0,
      join_authority: network.parallel_analysis?.join_authority,
    },
    governed_learning: network.governed_learning,
    execution_authorized: false,
  };
}

function compactDeepRuntime(runtime, detail = "fast") {
  if (!runtime || typeof runtime !== "object") return null;
  if (detail === "deep") return runtime;
  return {
    schema_version: runtime.schema_version,
    mode: runtime.mode,
    enabled: runtime.enabled,
    owner_protection: runtime.owner_protection,
    dialogue: runtime.dialogue,
    cognition: {
      opened_branch_count: runtime.cognition?.opened_branch_count,
      parallel_waves: runtime.cognition?.parallel_waves,
      hypothesis_count: Array.isArray(runtime.cognition?.hypothesis_ranking)
        ? runtime.cognition.hypothesis_ranking.length
        : 0,
      counterfactual_screening: runtime.cognition?.counterfactual_screening === true,
      verification_gate: runtime.cognition?.verification_gate === true,
    },
    memory: runtime.memory,
    execution_allowed: false,
    core_final_authority: runtime.core_final_authority === true,
  };
}

function compactNyraPayload(payload, { analysisId, detail = "fast" } = {}) {
  const result = payload?.result || {};
  const selected = result.selected_by_core || {};
  const compactResult = {
    version: result.version,
    mode: result.mode,
    god_mode_active: result.god_mode_active === true,
    selected_by_core: selected,
    automation_plan: result.automation_plan,
    deep_nyra_runtime: compactDeepRuntime(result.deep_nyra_runtime, detail),
    nyra_neural_network: compactNyraNetwork(result.nyra_neural_network),
    memory_context: compactMemoryContext(result.memory_context || payload?.memory_context),
    work_preflight: compactWorkPreflight(result.work_preflight || payload?.work_preflight),
    ...(detail === "deep" ? {
      prepared_by_nira: result.prepared_by_nira,
      efficiency: result.efficiency,
      core_branch_diagnostics: result.core_branch_diagnostics,
    } : {}),
  };
  return {
    ok: payload?.ok === true,
    tenant_id: payload?.tenant_id,
    received_memory: compactMemoryContext(payload?.received_memory || result.memory_context || payload?.memory_context),
    analysis_id: analysisId,
    response_mode: detail,
    result: compactResult,
    branch_context: payload?.branch_context,
    guardrail: payload?.guardrail,
    details_available: true,
    details_tool: "nyra_fetch_analysis",
  };
}

function ownerBindingStatus(config, identity) {
  const tenantIds = config.godModeTenantIds || [config.godModeTenantId].filter(Boolean);
  return {
    kind: identity.kind || "unknown",
    role: identity.role || "standard",
    god_mode: identity.godMode === true,
    owner_confirmation_satisfied: isVerifiedOwnerRoot(identity),
    binding_checks: {
      enabled: config.godModeEnabled === true,
      emergency_stop: config.godModeEmergencyStop === true,
      tenant_allowed: tenantIds.includes(identity.tenantId),
      subject_allowed: (config.godModeSubjects || []).includes(identity.subject),
      codex_delegate_allowed: identity.kind === "codex" && config.godModeCodexEnabled === true,
    },
  };
}

function isVerifiedOwnerRoot(identity) {
  return identity?.godMode === true && identity?.role === "owner_root";
}

function requireProviderSetupOwner(identity) {
  // A provider setup link ultimately accepts a credential. A generic Codex
  // bearer or a client-ID-only OAuth elevation can coordinate work but cannot
  // authorize this subject-allowlisted owner-only flow.
  if (
    identity?.kind !== "oauth" ||
    identity?.providerSetupOwner !== true ||
    !String(identity?.subject || "").trim()
  ) {
    throw new Error("owner_required");
  }
}

function requireProviderExecutionOwner(identity) {
  requireProviderSetupOwner(identity);
  // This is intentionally separate from god-mode confirmation. A normal
  // tenant OAuth owner may explicitly approve their own bounded provider
  // spend, while generic Core writes remain owner-root-only.
  if (identity?.providerExecutionConfirmed !== true) throw new Error("owner_confirmation_required");
}

function hasExplicitVerifiedOwnerConfirmation(identity) {
  return isVerifiedOwnerRoot(identity) && identity?.ownerConfirmed === true;
}

function verifiedConfirmationReference(identity) {
  if (!hasExplicitVerifiedOwnerConfirmation(identity)) return "";
  return String(identity?.confirmationReference || "").slice(0, 240);
}

function applyVerifiedOwnerConfirmation(payload, identity) {
  if (!hasExplicitVerifiedOwnerConfirmation(identity)) return payload;
  const verifiedGovernance = (governance) => ({
    ...(governance || {}),
    owner_confirmation_satisfied: true,
    owner_identity_verified: true,
  });
  const nestedPreflight = payload?.work_preflight;
  return {
    ...payload,
    governance: verifiedGovernance(payload?.governance),
    ...(nestedPreflight && typeof nestedPreflight === "object" && !Array.isArray(nestedPreflight)
      ? {
        work_preflight: {
          ...nestedPreflight,
          governance: verifiedGovernance(nestedPreflight.governance),
        },
      }
      : {}),
  };
}

export function createCoreHandlers(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const contextProvider = options.contextProvider;
  const sharedMemoryBootstrap = options.sharedMemoryBootstrap;
  const analysisCache = new Map();
  const analysisCacheTtlMs = Math.min(Math.max(Number(options.analysisCacheTtlMs || 300_000), 30_000), 300_000);

  function cacheAnalysis(tenantId, payload) {
    const now = Date.now();
    for (const [key, value] of analysisCache) if (value.expires_at <= now) analysisCache.delete(key);
    while (analysisCache.size >= 500) analysisCache.delete(analysisCache.keys().next().value);
    const analysisId = `nyra_${crypto.randomBytes(12).toString("hex")}`;
    analysisCache.set(`${tenantId}:${analysisId}`, { payload, expires_at: now + analysisCacheTtlMs });
    return analysisId;
  }

  function fetchAnalysis(tenantId, analysisId) {
    const key = `${tenantId}:${analysisId}`;
    const entry = analysisCache.get(key);
    if (!entry || entry.expires_at <= Date.now()) {
      analysisCache.delete(key);
      throw new Error("nyra_analysis_not_found_or_expired");
    }
    return entry.payload;
  }

  function coreKey(tenantId) {
    const selected = String(config.universalCoreKeys?.[tenantId] || (tenantId === config.defaultTenantId ? config.universalCoreKey : "") || config.tenantGatewayKey || "").trim();
    if (!selected) throw new Error("core_tenant_key_missing");
    return selected;
  }

  function sanitizeCoreBody(body) {
    return body && typeof body === "object" && !Array.isArray(body)
      ? (({ domain_pack: _domainPack, domain_pack_id: _domainPackId, ...rest }) => rest)(body)
      : body;
  }

  async function coreRequest(path, tenantId, { method = "GET", body } = {}) {
    const sanitizedBody = sanitizeCoreBody(body);
    const headers = { accept: "application/json" };
    if (sanitizedBody !== undefined) headers["content-type"] = "application/json";
    headers.authorization = `Bearer ${coreKey(tenantId)}`;
    if (config.tenantGatewayKey && coreKey(tenantId) === config.tenantGatewayKey) {
      const context = tenantContextHeader(tenantId, config.ownerContextSigningSecret);
      if (context) headers["x-sh-tenant-context"] = context;
    }
    const response = await fetchImpl(`${config.universalCoreUrl}${path}`, {
      method,
      headers,
      body: sanitizedBody === undefined ? undefined : JSON.stringify(sanitizedBody)
    });
    const payload = await response.json().catch(() => ({ ok: false, error: "invalid_core_response" }));
    if (!response.ok) throw new Error(`core_request_failed:${response.status}:${payload.error || "unknown"}`);
    return payload;
  }

  function ownerContext(identity, options = {}) {
    const optionObject = options && typeof options === "object" && !Array.isArray(options);
    const requestBinding = optionObject ? options.requestBinding : options;
    const approvalEnvelope = optionObject ? options.approvalEnvelope : undefined;
    const providerSetup = optionObject && options.providerSetup === true;

    // Generic owner assertions are signed with the tenant Core key and bind
    // the exact request body. Provider setup uses a separate signing key and
    // an OAuth-subject fingerprint, so it cannot be replayed as a generic
    // Core owner assertion (or vice versa).
    if (providerSetup) {
      if (
        identity.kind !== "oauth" ||
        identity.providerSetupOwner !== true ||
        !String(identity.subject || "").trim() ||
        String(config.ownerContextSigningSecret || "").length < 32
      ) {
        return { access_mode: "standard", role: identity.role || "standard", owner_verified: false };
      }
    } else if (identity.godMode !== true) {
      return { access_mode: "standard", role: identity.role || "standard", owner_verified: false };
    }
    const approvalDigest = approvalEnvelope
      ? providerSetupLinkBindingApprovalDigest(approvalEnvelope, identity.tenantId)
      : "";
    const signingKey = providerSetup ? config.ownerContextSigningSecret : coreKey(identity.tenantId);
    const context = {
      assertion_version: OWNER_CONTEXT_ASSERTION_VERSION,
      audience: "nira_core_bridge",
      tenant_id: identity.tenantId,
      access_mode: isVerifiedOwnerRoot(identity) ? "god_mode" : "tenant_owner",
      role: isVerifiedOwnerRoot(identity) ? "owner_root" : "tenant_owner",
      delegated_actor: identity.kind || "unknown",
      owner_verified: true,
      issued_at: new Date().toISOString(),
      ...(requestBinding === undefined ? {} : {
        binding_version: "owner_request_binding_v1",
        binding_hash: crypto.createHash("sha256").update(String(requestBinding)).digest("hex"),
      }),
      ...(providerSetup
        ? {
          owner_subject_fingerprint: `osf_${crypto.createHmac("sha256", signingKey)
            .update(`provider-setup-owner\u0000${String(identity.subject).trim()}`)
            .digest("hex")}`,
        }
        : {}),
      ...(approvalDigest ? { approval_digest: approvalDigest } : {}),
    };
    const digest = crypto.createHmac("sha256", signingKey)
      .update(`owner-context\u0000${ownerContextCanonical(context)}`)
      .digest("hex");
    return { ...context, assertion: `ocs_${digest}` };
  }

  async function issueOwnerOpenAiSetupLink(identity, ttlMinutes = 10) {
    requireProviderSetupOwner(identity);
    const signedOwnerContext = ownerContext(identity, { providerSetup: true });
    if (
      !/^ocs_[a-f0-9]{64}$/.test(String(signedOwnerContext.assertion || "")) ||
      !/^osf_[a-f0-9]{64}$/.test(String(signedOwnerContext.owner_subject_fingerprint || ""))
    ) {
      throw new Error("provider_setup_link_owner_context_unavailable");
    }
    return issueOpenAiProviderSetupLink({
      config,
      fetchImpl,
      tenantId: identity.tenantId,
      ttlMinutes,
      ownerContext: signedOwnerContext,
    });
  }

  function providerSetupPortalUrl() {
    const portal = new URL("/connect/openai", config.publicUrl);
    portal.search = "";
    portal.hash = "";
    return portal.toString();
  }

  async function memoryContext(input, identity) {
    if (typeof contextProvider !== "function") return undefined;
    return contextProvider(input, identity);
  }

  function hierarchyInput(args = {}, identity, operation = "advisory_work") {
    const supplied = args.core_input && typeof args.core_input === "object" && !Array.isArray(args.core_input) ? args.core_input : {};
    const request = String(args.request || args.message || args.question || args.decision || operation).slice(0, 12_000);
    const signals = Array.isArray(supplied.signals) && supplied.signals.length
      ? supplied.signals
      : [{ id: "mcp_runtime_request", label: operation, severity: 20, reversibility_hint: 80, risk_hint: 20 }];
    return { ...supplied, request, signals, context: { ...(supplied.context || {}), tenant_id: identity.tenantId } };
  }

  async function runtimeHierarchyEvaluate(args, identity, operation) {
    const started = Date.now();
    const payload = await coreRequest("/v1/runtime/hierarchy/evaluate", identity.tenantId, {
      method: "POST",
      body: { core_input: hierarchyInput(args, identity, operation) },
    });
    return compactCoreRuntime({ ...payload, latency_ms: Date.now() - started });
  }

  async function intelligenceRequest(path, args, identity, options = {}) {
    const sharedContext = options.memory === false ? undefined : await memoryContext({
      query: args.request || args.question || args.decision || args.outcome_id || "Nyra Core intelligence analysis",
      project_id: args.project_id,
      session_id: args.session_id,
      agent_id: args.agent_id || "nyra",
    }, identity);
    const requestBody = { ...args, ...(sharedContext ? { memory_context: sharedContext } : {}), tenant_id: identity.tenantId };
    const requestBinding = options.ownerBindingPurpose
      ? ownerRequestBinding(options.ownerBindingPurpose, requestBody)
      : undefined;
    const coreAnalysis = await coreRequest(path, identity.tenantId, {
      method: "POST",
      body: { ...requestBody, owner_context: ownerContext(identity, requestBinding) },
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
          owner_context: ownerContext(identity),
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

  const handlers = {
    core_health: async (_args, identity) => textResult({
      ...(await coreRequest("/healthz", identity.tenantId)),
      tenant_id: identity.tenantId,
      mcp_identity: ownerBindingStatus(config, identity),
    }),
    work_preflight: async (args, identity) => {
      const coreRuntime = await runtimeHierarchyEvaluate(args, identity, args.operation_type || "work_preflight");
      const agentPresence = identity.agentPresence || createAgentPresence(config, identity, args);
      const bootstrap = sharedMemoryBootstrap
        ? await sharedMemoryBootstrap.load(identity)
        : { loaded: false, tenant_id: identity.tenantId, missing_files: [], reason: "shared_memory_bootstrap_unavailable" };
      const sharedContext = await memoryContext({
        query: args.request,
        project_id: args.project_id,
        session_id: args.session_id,
        agent_id: args.agent_id || "connected_ai",
      }, identity);
      const payload = await coreRequest("/v1/work/preflight", identity.tenantId, {
        method: "POST",
        body: {
          request: args.request,
          target_system: args.target_system || "universal_core",
          operation_type: args.operation_type || "advisory_work",
          source_tool: args.tool_name,
          ...(Array.isArray(args.nyra_branches) ? { nyra_branches: args.nyra_branches } : {}),
          ...(Array.isArray(args.available_capabilities) ? { available_capabilities: args.available_capabilities } : {}),
          owner_confirmed: hasExplicitVerifiedOwnerConfirmation(identity),
          owner_context: ownerContext(identity),
          ...(verifiedConfirmationReference(identity)
            ? { confirmation_reference: verifiedConfirmationReference(identity) }
            : {}),
          ...(sharedContext ? { memory_context: sharedContext } : {}),
          agent_presence: agentPresence,
          tenant_id: identity.tenantId,
        },
      });
      const complete = { ...attachSharedMemoryBootstrap(applyVerifiedOwnerConfirmation(payload, identity), bootstrap), agent_presence: agentPresence, core_runtime: coreRuntime };
      if (args.response_mode === "full") return textResult(complete);
      const compact = {
        ok: complete.ok !== false,
        tenant_id: identity.tenantId,
        received_memory: compactMemoryContext(complete.received_memory),
        work_preflight: compactWorkPreflight(complete.work_preflight || complete),
        governance: complete.governance,
        core_runtime: coreRuntime,
        shared_memory_bootstrap: compactBootstrap(complete.shared_memory_bootstrap || complete.work_preflight?.shared_memory_bootstrap),
        agent_presence: agentPresence,
        details_available: true,
        full_mode: "work_preflight.response_mode=full",
      };
      return compactTextResult(compact, {
        preflight_id: compact.work_preflight?.preflight_id,
        state: compact.work_preflight?.state,
        tenant_id: compact.tenant_id,
        shared_memory_bootstrap_loaded: compact.shared_memory_bootstrap?.loaded === true,
      });
    },
    core_runtime_hierarchy_status: async (_args, identity) => textResult({
      ...(await coreRequest("/v1/runtime/hierarchy/status", identity.tenantId)),
      tenant_id: identity.tenantId,
    }),
    core_runtime_hierarchy_evaluate: async (args, identity) => textResult({
      ok: true,
      tenant_id: identity.tenantId,
      core_runtime: await runtimeHierarchyEvaluate(args, identity, args.operation_type || "runtime_hierarchy_evaluate"),
    }),
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
      const payload = await coreRequest("/v1/nira/core-bridge", identity.tenantId, {
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
      });
      const analysisId = cacheAnalysis(identity.tenantId, payload);
      if (args.response_mode === "full") {
        return compactTextResult({ ...payload, analysis_id: analysisId, response_mode: "full" }, {
          ok: payload.ok === true,
          analysis_id: analysisId,
          response_mode: "full",
        });
      }
      const detail = args.response_mode === "deep" ? "deep" : "fast";
      const compact = compactNyraPayload(payload, { analysisId, detail });
      return compactTextResult(compact, {
        ok: compact.ok,
        analysis_id: analysisId,
        response_mode: detail,
        selected_action: compact.result?.selected_by_core?.primary_action_label,
        risk_band: compact.result?.selected_by_core?.risk_band,
        preferred_reply: compact.result?.deep_nyra_runtime?.dialogue?.preferred_reply,
        execution_allowed: false,
      });
    },
    nyra_fetch_analysis: async (args, identity) => {
      const payload = fetchAnalysis(identity.tenantId, args.analysis_id);
      if (args.response_mode === "full") {
        return compactTextResult({ ...payload, analysis_id: args.analysis_id, response_mode: "full" }, {
          ok: payload.ok === true,
          analysis_id: args.analysis_id,
          response_mode: "full",
          execution_allowed: false,
        });
      }
      const compact = compactNyraPayload(payload, { analysisId: args.analysis_id, detail: "deep" });
      return compactTextResult(compact, {
        ok: compact.ok,
        analysis_id: args.analysis_id,
        response_mode: "deep",
        execution_allowed: false,
      });
    },
    intelligence_workflow: async (args, identity) => intelligenceRequest("/v1/intelligence/workflow", args, identity, { nyraInterpretation: true }),
    scenario_analysis: async (args, identity) => intelligenceRequest("/v1/intelligence/scenarios", args, identity),
    hypothesis_rank: async (args, identity) => intelligenceRequest("/v1/intelligence/hypotheses/rank", args, identity),
    event_probability: async (args, identity) => intelligenceRequest("/v1/intelligence/events/evaluate", args, identity),
    counterfactual_analysis: async (args, identity) => intelligenceRequest("/v1/intelligence/counterfactuals/evaluate", args, identity),
    decision_select: async (args, identity) => intelligenceRequest("/v1/intelligence/decisions/select", args, identity),
    outcome_verify: async (args, identity) => intelligenceRequest("/v1/intelligence/outcomes/verify", args, identity),
    outcome_record: async (args, identity) => intelligenceRequest("/v1/intelligence/outcomes/record", args, identity, { ownerBindingPurpose: "intelligence_outcome_record" }),
    calibration_status: async (args, identity) => textResult(await coreRequest(`/v1/intelligence/calibration?limit=${Number(args.limit || 20)}`, identity.tenantId)),
    skin_analyzer: async (args, identity) => textResult(await coreRequest("/v1/branches/skinharmony_analyzer/analyze", identity.tenantId, { method: "POST", body: { data: { scores: args.scores, products: args.products || [], protocols: args.protocols || [], report_text: args.report_text, data_quality_score: args.data_quality_score, acquisition: args.acquisition, previous_scores: args.previous_scores, previous_acquisition: args.previous_acquisition, learning_context: args.learning_context }, tenant_id: identity.tenantId } })),
    tenant_provider_openai_status: async (_args, identity) => textResult(await coreRequest("/v1/generic-agents/providers/openai", identity.tenantId)),
    tenant_provider_openai_setup_link: async (_args, identity) => {
      requireProviderSetupOwner(identity);
      // The MCP response contains only the fixed owner portal. The actual
      // one-time Core capability and its fragment-only proof are minted after
      // a fresh OAuth owner session inside that portal, never in chat.
      return textResult({
        ok: true,
        tenant_id: identity.tenantId,
        setup_url: providerSetupPortalUrl(),
        execution_enabled: false,
      });
    },
    tenant_provider_openai_multi_agent_smoke_run: async (args, identity) => {
      requireProviderExecutionOwner(identity);
      const confirmationReference = String(identity.providerExecutionConfirmationReference || "").trim().slice(0, 240);
      const requestBody = {
        tenant_id: identity.tenantId,
        task: String(args.task || "").trim(),
        owner_confirmed: true,
        ...(confirmationReference ? { confirmation_reference: confirmationReference } : {}),
      };
      return textResult(await coreRequest("/v1/generic-agents/providers/openai/multi-agent-runs", identity.tenantId, {
        method: "POST",
        body: {
          ...requestBody,
          owner_context: ownerContext(identity, {
            providerSetup: true,
            requestBinding: ownerRequestBinding("tenant_openai_multiagent_run", requestBody),
          }),
        },
      }));
    },
    tenant_provider_openai_multi_agent_run_read: async (args, identity) => {
      // Model output can contain the owner's own work. It is never exposed to
      // an arbitrary same-tenant read key: an authenticated provider owner is
      // required and the Core request is signed and bound to this run id.
      requireProviderSetupOwner(identity);
      const requestBody = { tenant_id: identity.tenantId, run_id: String(args.run_id || "").trim() };
      return textResult(await coreRequest(
        `/v1/generic-agents/providers/openai/multi-agent-runs/${encodeURIComponent(requestBody.run_id)}/result`,
        identity.tenantId,
        {
          method: "POST",
          body: {
            ...requestBody,
            owner_context: ownerContext(identity, {
              providerSetup: true,
              requestBinding: ownerRequestBinding("tenant_openai_multiagent_read", requestBody),
            }),
          },
        },
      ));
    },
    tenant_provider_openai_multi_agent_run_cancel: async (args, identity) => {
      requireProviderSetupOwner(identity);
      const requestBody = { tenant_id: identity.tenantId, run_id: String(args.run_id || "").trim() };
      return textResult(await coreRequest(
        `/v1/generic-agents/providers/openai/multi-agent-runs/${encodeURIComponent(requestBody.run_id)}/cancel`,
        identity.tenantId,
        {
          method: "POST",
          body: {
            ...requestBody,
            owner_context: ownerContext(identity, {
              providerSetup: true,
              requestBinding: ownerRequestBinding("tenant_openai_multiagent_cancel", requestBody),
            }),
          },
        },
      ));
    },
    generic_agent_orchestration_create: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/runs/${encodeURIComponent(args.run_id)}/orchestration`, identity.tenantId, {
      method: "POST",
      body: { workers: args.workers, tenant_id: identity.tenantId },
    })),
    generic_agent_orchestration_claim: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/orchestration/${encodeURIComponent(args.plan_id)}/claim`, identity.tenantId, {
      method: "POST",
      body: { tenant_id: identity.tenantId },
    })),
    generic_agent_orchestration_complete: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/orchestration/${encodeURIComponent(args.plan_id)}/workers/${encodeURIComponent(args.worker_id)}/complete`, identity.tenantId, {
      method: "POST",
      body: { result: args.result, tenant_id: identity.tenantId },
    })),
    generic_agent_orchestration_cancel: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/orchestration/${encodeURIComponent(args.plan_id)}/cancel`, identity.tenantId, {
      method: "POST",
      body: { tenant_id: identity.tenantId },
    })),
    generic_agent_orchestration_join: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/orchestration/${encodeURIComponent(args.plan_id)}/join`, identity.tenantId, {
      method: "POST",
      body: { tenant_id: identity.tenantId },
    })),
    generic_agent_start: async (args, identity) => textResult(await coreRequest("/v1/generic-agents/runs", identity.tenantId, {
      method: "POST",
      body: { ...args, tenant_id: identity.tenantId },
    })),
    generic_agent_checkpoint: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/runs/${encodeURIComponent(args.run_id)}/checkpoint`, identity.tenantId, {
      method: "POST",
      body: { checkpoint: args.checkpoint, ...(args.expected_revision === undefined ? {} : { expected_revision: args.expected_revision }), tenant_id: identity.tenantId },
    })),
    generic_agent_run_read: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/runs/${encodeURIComponent(args.run_id)}`, identity.tenantId)),
    generic_agent_evaluate: async (args, identity) => textResult(await coreRequest("/v1/generic-agents/evaluate", identity.tenantId, {
      method: "POST",
      body: { cases: args.cases, tenant_id: identity.tenantId },
    })),
    core_gate_action: async (args, identity) => {
      const confirmed = hasExplicitVerifiedOwnerConfirmation(identity);
      const confirmationReference = verifiedConfirmationReference(identity);
      if (args.operation_class === PROVIDER_SETUP_LINK_BINDING_OPERATION_CLASS) {
        requireProviderSetupOwner(identity);
        // The caller never selects the commit for this binding. It is bound to
        // the full SHA of the MCP process currently running on Render; if that
        // identity is absent, the rule fails closed rather than minting an
        // authorization for an arbitrary commit.
        if (!/^[a-f0-9]{40}$/i.test(String(config.runtimeBuildCommit || ""))) {
          throw new Error("provider_setup_link_build_identity_unavailable");
        }
        const binding = buildProviderSetupLinkBindingEnvelope({
          tenantId: identity.tenantId,
          targetCommit: config.runtimeBuildCommit,
          confirmationReference,
        });
        const approvedBinding = { ...binding, owner_confirmed: confirmed };
        return textResult(await coreRequest("/v1/action-evaluator", identity.tenantId, {
          method: "POST",
          body: {
            ...approvedBinding,
            owner_context: ownerContext(identity, {
              providerSetup: true,
              approvalEnvelope: approvedBinding,
              requestBinding: ownerRequestBinding("core_action_evaluator", approvedBinding),
            }),
          },
        }));
      }
      const sharedContext = await memoryContext({
        query: `${args.action_label || ""} ${args.action_type || ""}`.trim(),
        project_id: args.project_id,
        session_id: args.session_id,
        agent_id: args.agent_id || "connected_ai",
      }, identity);
      const {
        owner_confirmed: _untrustedOwnerConfirmation,
        confirmation_reference: _untrustedConfirmationReference,
        tenant_id: _untrustedTenantId,
        authenticated_tenant_id: _untrustedAuthenticatedTenantId,
        owner_context: _untrustedOwnerContext,
        ...safeArgs
      } = args;
      const requestBody = sanitizeCoreBody({
        ...safeArgs,
        ...(sharedContext ? { memory_context: sharedContext } : {}),
        tenant_id: identity.tenantId,
        owner_confirmed: confirmed,
        ...(confirmationReference ? { confirmation_reference: confirmationReference } : {}),
      });
      return textResult(await coreRequest("/v1/action-evaluator", identity.tenantId, {
        method: "POST",
        body: {
          ...requestBody,
          owner_context: ownerContext(identity, ownerRequestBinding("core_action_evaluator", requestBody)),
        }
      }));
    }
  };
  // The browser portal is part of this MCP process, but it is not an MCP tool.
  // Keep its raw link/proof issuance helper out of the enumerable tool map so
  // it cannot be discovered or invoked through the connector protocol.
  Object.defineProperty(handlers, "issueOwnerOpenAiSetupLink", {
    value: issueOwnerOpenAiSetupLink,
    enumerable: false,
  });
  return handlers;
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
      owner_confirmed: hasExplicitVerifiedOwnerConfirmation(identity),
      ...(verifiedConfirmationReference(identity) ? { confirmation_reference: verifiedConfirmationReference(identity) } : {})
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
