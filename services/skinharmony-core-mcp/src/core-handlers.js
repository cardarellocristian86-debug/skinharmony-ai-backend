import crypto from "node:crypto";
import { attachSharedMemoryBootstrap } from "./shared-memory-bootstrap.js";
import { createAgentPresence } from "./agent-presence.js";
import { issueDttAgentContext } from "../../shared/dtt-agent-identity-receipts.js";
import { readCoreCapabilityCatalog } from "./core-capability-catalog.js";
import {
  nyraDeepV2EvidencePackHash,
  signNyraDeepV2McpRequest,
} from "./nyra-deep-v2-mcp-request.js";
import { isCodexGoodModeDelegation } from "./auth.js";

const OWNER_CONTEXT_ASSERTION_VERSION = "owner_context_assertion_v1";
const NYRA_DEEP_V2_PREFLIGHT_OPERATION = Object.freeze({
  preview: "nyra_v2_preview",
  requirements: "nyra_v2_requirements",
  prepare_evidence: "nyra_v2_evidence_prepare",
  evaluate: "nyra_v2_evaluate",
});

function tenantContextHeader(tenantId, signingSecret) {
  if (Buffer.byteLength(String(signingSecret || ""), "utf8") < 32) return "";
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

function dedicatedCoreTextResult(payload, route) {
  return textResult({
    ...payload,
    dedicated_core_gate: {
      authorized: payload?.ok === true,
      authority: "universal_core",
      route,
      provider_execution: false,
      host_policy_override: false,
    },
  });
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
    core_research: preflight.core_research,
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

function coreRuntimeFromBridge(payload) {
  const actual = payload?.result?.core_runtime;
  const route = actual?.router?.route;
  const authority = actual?.selected_authority;
  if (
    !actual ||
    !["active", "shadow", "off"].includes(actual.mode) ||
    !["V0", "V1", "V2"].includes(route) ||
    !["V0", "V1", "V2"].includes(authority) ||
    actual.execution_allowed !== false
  ) {
    throw new Error("core_runtime_binding_mismatch");
  }
  return compactCoreRuntime({ result: actual });
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
    core_runtime: payload?.core_runtime || null,
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

function requireHostNativeOwnerConfirmation(identity, config) {
  if (isCodexGoodModeDelegation(identity, config)) return "codex_good_mode";
  if (identity?.kind !== "oauth" || !String(identity?.subject || "").trim()) {
    throw new Error("owner_required");
  }
  if (
    identity?.oauthOwnerElevated !== true ||
    identity?.ownerConfirmed !== true ||
    !String(identity?.confirmationReference || "").trim()
  ) {
    throw new Error("owner_confirmation_required");
  }
  return "oauth_owner_confirmation";
}

function hostNativeConfirmationReference(identity, ownerMode, purpose, idempotencyKey) {
  if (ownerMode !== "codex_good_mode") {
    return String(identity?.confirmationReference || "").trim().slice(0, 240);
  }
  const requestDigest = crypto.createHash("sha256")
    .update(`${identity.tenantId}\u0000${purpose}\u0000${String(idempotencyKey || "")}`)
    .digest("hex");
  return `god_mode_codex:${requestDigest.slice(0, 40)}`;
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

  function configuredTenantGatewayKey() {
    const value = String(config.tenantGatewayKey || "").trim();
    return Buffer.byteLength(value, "utf8") >= 32 ? value : "";
  }

  function coreKey(tenantId) {
    const selected = String(
      config.universalCoreKeys?.[tenantId] ||
      (tenantId === config.defaultTenantId ? config.universalCoreKey : "") ||
      configuredTenantGatewayKey() ||
      "",
    ).trim();
    if (!selected) throw new Error("core_tenant_key_missing");
    return selected;
  }

  function sanitizeCoreBody(body) {
    return body && typeof body === "object" && !Array.isArray(body)
      ? (({ domain_pack: _domainPack, domain_pack_id: _domainPackId, ...rest }) => rest)(body)
      : body;
  }

  async function coreRequest(path, tenantId, {
    method = "GET",
    body,
    additionalHeaders = {},
    useTenantGateway = false,
  } = {}) {
    const sanitizedBody = sanitizeCoreBody(body);
    const headers = { accept: "application/json" };
    if (sanitizedBody !== undefined) headers["content-type"] = "application/json";
    const gatewayKey = configuredTenantGatewayKey();
    if (useTenantGateway && !gatewayKey) {
      throw new Error("core_tenant_gateway_key_missing");
    }
    const selectedKey = useTenantGateway ? gatewayKey : coreKey(tenantId);
    headers.authorization = `Bearer ${selectedKey}`;
    Object.assign(headers, additionalHeaders);
    if (gatewayKey && selectedKey === gatewayKey) {
      // The gateway key has a synthetic tenant. Core therefore needs the
      // requested tenant alongside the signed context even for body-less GET
      // requests. The header is not trusted by itself: Core accepts it only
      // when the HMAC context below is valid for the exact same tenant.
      headers["x-sh-tenant-id"] = tenantId;
      const context = tenantContextHeader(
        tenantId,
        config.tenantContextSigningSecret,
      );
      if (!context) {
        throw new Error("core_tenant_context_signing_unavailable");
      }
      headers["x-sh-tenant-context"] = context;
    }
    const response = await fetchImpl(`${config.universalCoreUrl}${path}`, {
      method,
      headers,
      body: sanitizedBody === undefined ? undefined : JSON.stringify(sanitizedBody)
    });
    const payload = await response.json().catch(() => ({ ok: false, error: "invalid_core_response" }));
    if (!response.ok) {
      const upstreamCode = typeof payload.error === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(payload.error)
        ? payload.error
        : "unknown";
      const error = new Error(`core_request_failed:${response.status}:${upstreamCode}`);
      error.code = upstreamCode === "unknown" ? "core_request_failed" : upstreamCode;
      error.statusCode = response.status;
      throw error;
    }
    return payload;
  }

  function ownerContext(identity, options = {}) {
    const optionObject = options && typeof options === "object" && !Array.isArray(options);
    const requestBinding = optionObject ? options.requestBinding : options;
    const hostNativeOwner = optionObject && options.hostNativeOwner === true;

    // Generic owner assertions are signed with the tenant Core key and bind
    // the exact request body. Host-native delegation operations use the
    // dedicated owner-context key. OAuth and Codex-Good-Mode fingerprints use
    // distinct domains, so neither can be replayed as the other or as a
    // generic Core owner assertion.
    if (hostNativeOwner) {
      const codexGoodMode = isCodexGoodModeDelegation(identity, config);
      const oauthOwner =
        identity.kind === "oauth" &&
        identity.oauthOwnerElevated === true &&
        identity.ownerConfirmed === true &&
        Boolean(String(identity.subject || "").trim());
      if (
        !codexGoodMode &&
        !oauthOwner
      ) {
        return { access_mode: "standard", role: identity.role || "standard", owner_verified: false };
      }
      if (
        Buffer.byteLength(
          String(config.ownerContextSigningSecret || ""),
          "utf8",
        ) < 32
      ) {
        throw new Error("host_native_owner_context_signing_unavailable");
      }
    } else if (identity.godMode !== true) {
      return { access_mode: "standard", role: identity.role || "standard", owner_verified: false };
    }
    const signingKey = hostNativeOwner
      ? config.ownerContextSigningSecret
      : (configuredTenantGatewayKey() || coreKey(identity.tenantId));
    const hostNativeCodexGoodMode = hostNativeOwner && isCodexGoodModeDelegation(identity, config);
    const context = {
      assertion_version: OWNER_CONTEXT_ASSERTION_VERSION,
      audience: "nira_core_bridge",
      tenant_id: identity.tenantId,
      access_mode: (isVerifiedOwnerRoot(identity) && !hostNativeOwner) || hostNativeCodexGoodMode
        ? "god_mode"
        : "tenant_owner",
      role: (isVerifiedOwnerRoot(identity) && !hostNativeOwner) || hostNativeCodexGoodMode
        ? "owner_root"
        : "tenant_owner",
      delegated_actor: identity.kind || "unknown",
      owner_verified: true,
      issued_at: new Date().toISOString(),
      ...(requestBinding === undefined ? {} : {
        binding_version: "owner_request_binding_v1",
        binding_hash: crypto.createHash("sha256").update(String(requestBinding)).digest("hex"),
      }),
      ...(hostNativeOwner
        ? {
          owner_subject_fingerprint: `osf_${crypto.createHmac("sha256", signingKey)
            .update(`${hostNativeCodexGoodMode ? "host-native-codex-owner" : "host-native-owner"}\u0000${String(identity.subject).trim()}`)
            .digest("hex")}`,
        }
        : {}),
    };
    const digest = crypto.createHmac("sha256", signingKey)
      .update(`owner-context\u0000${ownerContextCanonical(context)}`)
      .digest("hex");
    return { ...context, assertion: `ocs_${digest}` };
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

  async function nyraDeepV2Request(args, identity, operation) {
    const operationType = NYRA_DEEP_V2_PREFLIGHT_OPERATION[operation];
    if (!operationType) throw new Error("nyra_deep_v2_mcp_operation_invalid");
    const requestId = String(
      args.request_id || `mcp-nyra-v2-${crypto.randomUUID()}`,
    ).slice(0, 160);
    const branchId = operation === "preview" ? null : String(args.branch_id || "");
    const subbranchId = operation === "preview" ? null : String(args.subbranch_id || "");
    const evidenceRefs = operation === "evaluate"
      ? [...(Array.isArray(args.evidence_refs) ? args.evidence_refs : [])]
      : [];
    const evidencePackHash = operation === "prepare_evidence"
      ? nyraDeepV2EvidencePackHash(args.evidence_pack, args.requirement_bindings)
      : null;
    const requestAttestation = signNyraDeepV2McpRequest({
      secret: config.nyraDeepV2McpRequestSigningSecret,
      tenantId: identity.tenantId,
      requestId,
      operation,
      branchId,
      subbranchId,
      evidenceRefs,
      evidencePackHash,
    });
    const sharedContext = await memoryContext({
      query: args.message,
      project_id: args.project_id,
      session_id: args.session_id,
      agent_id: args.agent_id || "nyra",
    }, identity);
    const deepBranchV2 = {
      operation,
      ...(branchId ? { branch_id: branchId, subbranch_id: subbranchId } : {}),
      evidence_refs: evidenceRefs,
      ...(operation === "prepare_evidence"
        ? {
          evidence_pack: args.evidence_pack,
          requirement_bindings: args.requirement_bindings,
          evidence_pack_hash: evidencePackHash,
        }
        : {}),
      request_attestation: requestAttestation,
    };
    const payload = await coreRequest("/v1/nira/core-bridge", identity.tenantId, {
      method: "POST",
      body: {
        text: args.message,
        request_id: requestId,
        source_tool: operationType,
        operation_type: operationType,
        nyra_branches: branchId
          ? [branchId]
          : [...(Array.isArray(args.nyra_branches) ? args.nyra_branches : [])],
        ...(sharedContext ? { memory_context: sharedContext } : {}),
        deep_branch_v2: deepBranchV2,
        tenant_id: identity.tenantId,
      },
    });
    const runtime = payload?.result?.deep_branch_v2;
    if (
      !runtime
      || typeof runtime !== "object"
      || runtime.execution_authorized !== false
      || runtime.core_final_authority !== true
    ) {
      throw new Error("nyra_deep_v2_core_authority_binding_mismatch");
    }
    return {
      ok: payload?.ok === true,
      tenant_id: identity.tenantId,
      request_id: requestId,
      operation,
      core_runtime: coreRuntimeFromBridge(payload),
      work_preflight: compactWorkPreflight(
        payload?.result?.work_preflight || payload?.work_preflight,
      ),
      deep_branch_v2: runtime,
    };
  }

  function hostNativeSessionFingerprint(identity) {
    const fingerprint = String(identity?.agentPresence?.session_fingerprint || "").trim();
    if (!/^[a-f0-9]{16,64}$/i.test(fingerprint)) {
      throw new Error("host_native_session_presence_required");
    }
    return fingerprint.toLowerCase();
  }

  function hostNativeKind(identity) {
    const clientType = String(identity?.agentPresence?.client_type || "").toLowerCase();
    if (clientType === "codex") return "codex_native";
    if (clientType === "chatgpt") return "chatgpt_native";
    throw new Error("host_native_client_type_required");
  }

  async function trustedHostNativeTicketRecord(ticketId, identity) {
    const payload = await coreRequest(
      `/v1/host-native/actions/${encodeURIComponent(ticketId)}`,
      identity.tenantId,
    );
    const record = payload?.action_ticket;
    if (
      payload?.ok !== true ||
      payload.tenant_id !== identity.tenantId ||
      record?.schema_version !== "host_native_action_ticket_record_v1" ||
      record.tenant_id !== identity.tenantId ||
      record.ticket?.tenant_id !== identity.tenantId ||
      record.ticket?.ticket_id !== ticketId
    ) {
      throw new Error("host_native_ticket_readback_invalid");
    }
    return record;
  }

  function attachTrustedHostNativeTicket(error, record) {
    if (!error || !record) return error;
    Object.defineProperties(error, {
      hostNativeTicketTrusted: { value: true, enumerable: false },
      hostNativeTicketRecord: { value: record, enumerable: false },
    });
    return error;
  }

  const handlers = {
    core_health: async (_args, identity) => textResult({
      ...(await coreRequest("/healthz", identity.tenantId)),
      tenant_id: identity.tenantId,
      mcp_identity: ownerBindingStatus(config, identity),
    }),
    host_native_status: async (_args, identity) => textResult(
      await coreRequest("/v1/host-native/status", identity.tenantId),
    ),
    host_native_work_plan_create: async (args, identity) => textResult(
      await coreRequest("/v1/host-native/work-plans", identity.tenantId, {
        method: "POST",
        body: {
          work_id: args.work_id,
          intent_anchor_digest: args.intent_anchor_digest,
          repository: args.repository,
          base_branch: args.base_branch,
          objective: args.objective,
          required_checks: args.required_checks,
          agents: args.agents,
          ...(args.max_parallel === undefined ? {} : { max_parallel: args.max_parallel }),
        },
      }),
    ),
    host_native_release_intent_build: async (args, identity) => {
      const route = "/v1/host-native/release-intents";
      return dedicatedCoreTextResult(await coreRequest(route, identity.tenantId, {
        method: "POST",
        body: {
          work_id: args.work_id,
          intent_anchor_digest: args.intent_anchor_digest,
          repository: args.repository,
          base_branch: args.base_branch,
          delivery_branch: args.delivery_branch,
          base_commit: args.base_commit,
          head_commit: args.head_commit,
          tree_sha: args.tree_sha,
          diff_digest: args.diff_digest,
          changed_files: args.changed_files,
          verification: args.verification,
          delivery: args.delivery,
          rollback: args.rollback,
        },
      }), route);
    },
    host_native_core_join_issue: async (args, identity) => {
      const route = "/v1/host-native/core-join-verdicts";
      return dedicatedCoreTextResult(await coreRequest(route, identity.tenantId, {
        method: "POST",
        useTenantGateway: true,
        body: {
          work_id: args.work_id,
          intent_anchor_digest: args.intent_anchor_digest,
          repository: args.repository,
          core_plan_id: args.core_plan_id,
          core_plan_digest: args.core_plan_digest,
          local_plan_id: args.local_plan_id,
          local_plan_digest: args.local_plan_digest,
          evaluation_digest: args.evaluation_digest,
          acceptance_criteria: args.acceptance_criteria,
          builder_report: args.builder_report,
          verifier_reports: args.verifier_reports,
          checks: args.checks,
          closure_attestation: args.closure_attestation,
          release_intent: args.release_intent,
          ...(args.required_checks_policy_digest
            ? { required_checks_policy_digest: args.required_checks_policy_digest }
            : {}),
          provider_execution: false,
          idempotency_key: args.idempotency_key,
        },
      }), route);
    },
    host_native_delegation_issue: async (args, identity) => {
      const ownerMode = requireHostNativeOwnerConfirmation(identity, config);
      const ttlSeconds = Number(args.ttl_seconds);
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 43_200) {
        throw new Error("host_native_delegation_ttl_invalid");
      }
      const requestBody = {
        work_id: args.work_id,
        intent_anchor_digest: args.intent_anchor_digest,
        repository: args.repository,
        audience: args.audience,
        allowed_branches: args.allowed_branches,
        protected_branches: args.protected_branches || [],
        allowed_path_prefixes: args.allowed_path_prefixes,
        allowed_actions: args.allowed_actions,
        ...(args.budget ? { budget: args.budget } : {}),
        ...(args.release_policy ? { release_policy: args.release_policy } : {}),
        idempotency_key: args.idempotency_key,
        expires_at: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
        owner_confirmed: true,
        confirmation_reference: hostNativeConfirmationReference(
          identity,
          ownerMode,
          "host_native_delegation_issue",
          args.idempotency_key,
        ),
      };
      const payload = await coreRequest("/v1/host-native/delegations", identity.tenantId, {
        method: "POST",
        body: {
          ...requestBody,
          owner_context: ownerContext(identity, {
            hostNativeOwner: true,
            requestBinding: ownerRequestBinding("host_native_delegation_issue", requestBody),
          }),
        },
      });
      return dedicatedCoreTextResult(payload, "/v1/host-native/delegations");
    },
    host_native_delegation_read: async (args, identity) => textResult(
      await coreRequest(
        `/v1/host-native/delegations/${encodeURIComponent(args.delegation_id)}`,
        identity.tenantId,
      ),
    ),
    host_native_delegation_revoke: async (args, identity) => {
      const ownerMode = requireHostNativeOwnerConfirmation(identity, config);
      const requestBody = {
        idempotency_key: args.idempotency_key,
        owner_confirmed: true,
        confirmation_reference: hostNativeConfirmationReference(
          identity,
          ownerMode,
          "host_native_delegation_revoke",
          args.idempotency_key,
        ),
      };
      const route = `/v1/host-native/delegations/${encodeURIComponent(args.delegation_id)}/revoke`;
      const payload = await coreRequest(route, identity.tenantId, {
        method: "POST",
        body: {
          ...requestBody,
          owner_context: ownerContext(identity, {
            hostNativeOwner: true,
            requestBinding: ownerRequestBinding("host_native_delegation_revoke", requestBody),
          }),
        },
      });
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_action_authorize: async (args, identity) => {
      const route = "/v1/host-native/actions/authorize";
      const payload = await coreRequest(route, identity.tenantId, {
        method: "POST",
        body: {
          delegation_id: args.delegation_id,
          work_id: args.work_id,
          intent_anchor_digest: args.intent_anchor_digest,
          repository: args.repository,
          host_kind: hostNativeKind(identity),
          host_session_fingerprint: hostNativeSessionFingerprint(identity),
          action: args.action,
          evidence_digest: args.evidence_digest,
          idempotency_key: args.idempotency_key,
          ...(args.predecessor_ticket_id
            ? { predecessor_ticket_id: args.predecessor_ticket_id }
            : {}),
          ...(args.release_manifest ? { release_manifest: args.release_manifest } : {}),
        },
      });
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_action_read: async (args, identity) => textResult(
      await coreRequest(
        `/v1/host-native/actions/${encodeURIComponent(args.ticket_id)}`,
        identity.tenantId,
      ),
    ),
    host_native_action_reserve: async (args, identity) => {
      const route = `/v1/host-native/actions/${encodeURIComponent(args.ticket_id)}/reserve`;
      return dedicatedCoreTextResult(await coreRequest(route, identity.tenantId, {
        method: "POST",
        body: {
          host_session_fingerprint: hostNativeSessionFingerprint(identity),
          idempotency_key: args.idempotency_key,
        },
      }), route);
    },
    host_native_action_complete: async (args, identity) => {
      const route = `/v1/host-native/actions/${encodeURIComponent(args.ticket_id)}/complete`;
      const ticketRecord = await trustedHostNativeTicketRecord(args.ticket_id, identity);
      try {
        return dedicatedCoreTextResult(await coreRequest(route, identity.tenantId, {
          method: "POST",
          body: {
            reservation_id: args.reservation_id,
            host_session_fingerprint: hostNativeSessionFingerprint(identity),
            outcome: args.outcome,
            result_digest: args.result_digest,
            idempotency_key: args.idempotency_key,
            ...(args.result_commit ? { result_commit: args.result_commit } : {}),
            ...(args.readback_digest ? { readback_digest: args.readback_digest } : {}),
          },
        }), route);
      } catch (error) {
        throw attachTrustedHostNativeTicket(error, ticketRecord);
      }
    },
    host_native_action_reconcile: async (args, identity) => {
      const route = `/v1/host-native/actions/${encodeURIComponent(args.ticket_id)}/reconcile`;
      const ticketRecord = await trustedHostNativeTicketRecord(args.ticket_id, identity);
      try {
        return dedicatedCoreTextResult(await coreRequest(route, identity.tenantId, {
          method: "POST",
          body: {
            reservation_id: args.reservation_id,
            host_session_fingerprint: hostNativeSessionFingerprint(identity),
            idempotency_key: args.idempotency_key,
            observed_outcome: args.observed_outcome,
            readback_digest: args.readback_digest,
            ...(args.observed_commit ? { observed_commit: args.observed_commit } : {}),
          },
        }), route);
      } catch (error) {
        throw attachTrustedHostNativeTicket(error, ticketRecord);
      }
    },
    host_native_action_closure_receipt: async (args, identity) => {
      const route =
        `/v1/host-native/actions/${encodeURIComponent(args.ticket_id)}/authorize-finalize`;
      return textResult(await coreRequest(route, identity.tenantId, {
        method: "POST",
        body: {
          host_session_fingerprint: hostNativeSessionFingerprint(identity),
        },
      }));
    },
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
          ...(args.work_id ? { work_id: args.work_id } : {}),
          ...(args.parent_work_id ? { parent_work_id: args.parent_work_id } : {}),
          ...(args.project_id ? { project_id: args.project_id } : {}),
          ...(Array.isArray(args.acceptance_criteria)
            ? { acceptance_criteria: args.acceptance_criteria }
            : {}),
          ...(Array.isArray(args.constraints) ? { constraints: args.constraints } : {}),
          host_native: {
            requested: args.host_type === "chatgpt_native" || args.host_type === "codex_native",
            host_type: args.host_type || (
              agentPresence.client_type === "codex" ? "codex_native" : "chatgpt_native"
            ),
            provider_execution: false,
            provider_api_key_required: false,
            server_model_calls: 0,
            host_spawn_required: true,
            host_policy_override: false,
            host_policy_must_allow: true,
          },
          ...(args.evidence_state && typeof args.evidence_state === "object"
            ? { evidence_state: args.evidence_state }
            : {}),
          ...(Array.isArray(args.research_allowed_domains)
            ? { research_allowed_domains: args.research_allowed_domains }
            : {}),
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
    core_capability_catalog: async (args, identity) => textResult({
      ...readCoreCapabilityCatalog(args),
      tenant_id: identity.tenantId,
    }),
    core_branch_registry: async (args, identity) => {
      const paths = {
        registry: "/v1/branches",
        taxonomy: "/v1/branches/taxonomy",
        maturity: "/v1/branches/maturity",
        authorized: "/v1/branches/authorized",
      };
      const view = args.view || "registry";
      const query = view === "authorized" && Array.isArray(args.branches) && args.branches.length
        ? `?${new URLSearchParams({ branches: args.branches.join(",") }).toString()}`
        : "";
      return textResult(await coreRequest(`${paths[view]}${query}`, identity.tenantId));
    },
    core_branch_analyze: async (args, identity) => textResult(await coreRequest(
      `/v1/branches/${encodeURIComponent(args.branch)}/analyze`,
      identity.tenantId,
      {
        method: "POST",
        body: {
          request: args.request,
          ...(args.signals ? { signals: args.signals } : {}),
          ...(args.context ? { context: args.context } : {}),
        },
      },
    )),
    core_control_plane_read: async (args, identity) => {
      const paths = {
        tenant_status: "/v1/tenant/status",
        entitlements: "/v1/entitlements/current",
        domain_pack: "/v1/domain-packs/current",
        overview: "/v1/control-plane/overview",
        dashboard: "/v1/control-plane/dashboard",
        ecosystem_pulse: "/v1/ecosystem-pulse",
        connector_manifest: "/v1/connectors/sdk/manifest",
        customer_intelligence_contract: "/v1/customer-intelligence/contract",
      };
      return textResult(await coreRequest(paths[args.view], identity.tenantId));
    },
    core_evidence_recent: async (args, identity) => {
      const query = new URLSearchParams({ limit: String(args.limit || 50) });
      return textResult(await coreRequest(`/v1/evidence/recent?${query.toString()}`, identity.tenantId));
    },
    core_semantic_select: async (args, identity) => textResult(await coreRequest("/v1/semantic-selection", identity.tenantId, {
      method: "POST",
      body: {
        candidates: args.candidates,
        target_language: args.target_language,
        adapter: args.adapter,
        intent: args.intent,
        limit: args.limit,
      },
    })),
    core_software_language_evaluate: async (args, identity) => textResult(await coreRequest("/v1/software-language-gate/evaluate", identity.tenantId, {
      method: "POST",
      body: { app: args.app, target_lang: args.target_lang, entries: args.entries },
    })),
    core_content_guard_check: async (args, identity) => textResult(await coreRequest("/v1/content-guard/check", identity.tenantId, {
      method: "POST",
      body: { text: args.text, locale: args.locale, context: args.context },
    })),
    core_claim_guard_check: async (args, identity) => textResult(await coreRequest("/v1/claim-guard/check", identity.tenantId, {
      method: "POST",
      body: { text: args.text, forbidden_terms: args.forbidden_terms },
    })),
    core_pricing_guard_check: async (args, identity) => textResult(await coreRequest("/v1/pricing-guard/check", identity.tenantId, {
      method: "POST",
      body: { official_prices: args.official_prices, observed_prices: args.observed_prices },
    })),
    core_policy_check: async (args, identity) => textResult(await coreRequest("/v1/policy/check", identity.tenantId, {
      method: "POST",
      body: { action: args.action, policy: args.policy, context: args.context },
    })),
    core_action_mediation_evaluate: async (args, identity) => textResult(await coreRequest("/v1/action-mediation/evaluate", identity.tenantId, {
      method: "POST",
      body: { action: args.action, policy: args.policy, context: args.context },
    })),
    core_release_manifest_check: async (args, identity) => textResult(await coreRequest("/v1/releases/manifest/check", identity.tenantId, {
      method: "POST",
      body: { manifest: args.manifest },
    })),
    core_translator_extractor_status: async (_args, identity) => textResult(
      await coreRequest("/v1/translator/extractor/status", identity.tenantId),
    ),
    core_software_intelligence_components: async (_args, identity) => textResult(
      await coreRequest("/v1/software-intelligence/components", identity.tenantId),
    ),
    core_software_intelligence_analyze: async (args, identity) => textResult(await coreRequest("/v1/software-intelligence/analyze", identity.tenantId, {
      method: "POST",
      body: { artifact: args.artifact, authorization: args.authorization, options: args.options },
    })),
    core_software_intelligence_jobs: async (args, identity) => {
      const suffix = args.job_id ? `/${encodeURIComponent(args.job_id)}` : "";
      return textResult(await coreRequest(`/v1/software-intelligence/jobs${suffix}`, identity.tenantId));
    },
    core_entity_graph_read: async (_args, identity) => textResult(await coreRequest("/v1/entity-graph", identity.tenantId)),
    core_entity_graph_upsert: async (args, identity) => {
      if (!hasExplicitVerifiedOwnerConfirmation(identity)) throw new Error("owner_confirmation_required");
      return textResult(await coreRequest("/v1/entity-graph/upsert", identity.tenantId, {
        method: "POST",
        body: {
          entities: args.entities || [],
          relations: args.relations || [],
          owner_context: ownerContext(identity),
          confirmation_reference: verifiedConfirmationReference(identity),
        },
      }));
    },
    core_review_pending: async (_args, identity) => textResult(await coreRequest("/v1/review/pending", identity.tenantId)),
    core_review_action: async (args, identity) => {
      if (!hasExplicitVerifiedOwnerConfirmation(identity)) throw new Error("owner_confirmation_required");
      return textResult(await coreRequest("/v1/review/action", identity.tenantId, {
        method: "POST",
        body: {
          review_id: args.review_id,
          action: args.action,
          note: args.note,
          owner_context: ownerContext(identity),
          confirmation_reference: verifiedConfirmationReference(identity),
        },
      }));
    },
    orchestration_capability_catalog: async (args, identity) => {
      const query = new URLSearchParams({
        branch: args.branch,
        view: args.view || "capabilities",
        cursor: args.cursor || "0",
        limit: String(args.limit || (args.view === "virtual" ? 20 : 25)),
      });
      return textResult(await coreRequest(`/v1/orchestration/capabilities?${query.toString()}`, identity.tenantId));
    },
    lexical_semantic_catalog: async (args, identity) => {
      const query = new URLSearchParams({
        view: args.view || "capabilities",
        cursor: args.cursor || "0",
        limit: String(args.limit || (args.view === "virtual" ? 20 : 25)),
      });
      return textResult(await coreRequest(`/v1/lexical-semantics/catalog?${query.toString()}`, identity.tenantId));
    },
    lexical_semantic_analyze: async (args, identity) => textResult(await coreRequest(
      "/v1/lexical-semantics/analyze",
      identity.tenantId,
      {
        method: "POST",
        body: {
          text: args.text,
          locale: args.locale,
          source_context: args.source_context,
        },
      },
    )),
    orchestration_relational_evaluate: async (args, identity) => textResult(await coreRequest(
      "/v1/orchestration/relational/evaluate",
      identity.tenantId,
      {
        method: "POST",
        body: {
          objective: args.objective,
          actors: args.actors,
          relations: args.relations,
          unresolved_conflicts: args.unresolved_conflicts,
        },
      },
    )),
    orchestration_dtt_plan: async (args, identity) => textResult(await coreRequest(
      "/v1/orchestration/dtt/plan",
      identity.tenantId,
      {
        method: "POST",
        body: {
          objective: args.objective,
          nodes: args.nodes,
          limits: args.limits,
        },
      },
    )),
    orchestration_dtt_read: async (args, identity) => textResult(await coreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}`,
      identity.tenantId,
    )),
    orchestration_dtt_expansion_propose: async (args, identity) => textResult(await coreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/expansion-proposals`,
      identity.tenantId,
      {
        method: "POST",
        body: {
          parent_node_id: args.parent_node_id,
          nodes: args.nodes,
        },
      },
    )),
    orchestration_dtt_replan_propose: async (args, identity) => textResult(await coreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/replan-proposals`,
      identity.tenantId,
      {
        method: "POST",
        body: {
          prune_node_ids: args.prune_node_ids,
          replacement_nodes: args.replacement_nodes,
          reason: args.reason,
        },
      },
    )),
    orchestration_dtt_outcome_record: async (args, identity) => textResult(await coreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/nodes/${encodeURIComponent(args.node_id)}/outcomes`,
      identity.tenantId,
      {
        method: "POST",
        body: {
          outcome: args.outcome,
          evidence: args.evidence,
          evidence_draft: args.evidence_draft,
          votes: args.votes,
        },
      },
    )),
    orchestration_dtt_evidence_prepare: async (args, identity) => textResult(await coreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/nodes/${encodeURIComponent(args.node_id)}/evidence-drafts`,
      identity.tenantId,
      {
        method: "POST",
        body: {
          claim: args.claim,
          artifacts: args.artifacts,
          provenance: args.provenance,
          required_approvals: args.required_approvals,
        },
      },
    )),
    orchestration_dtt_agent_attest: async (args, identity) => {
      if (!config.dttAgentIdentitySigningSecret) throw new Error("dtt_agent_identity_not_ready");
      if (!identity.agentPresence) throw new Error("agent_presence_session_required");
      const context = issueDttAgentContext({
        secret: config.dttAgentIdentitySigningSecret,
        tenant_id: identity.tenantId,
        agent_presence: identity.agentPresence,
      });
      return textResult(await coreRequest(
        `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/nodes/${encodeURIComponent(args.node_id)}/attestations`,
        identity.tenantId,
        {
          method: "POST",
          body: {
            evidence_digest: args.evidence_digest,
            decision: args.decision,
            rationale: args.rationale,
            assignment_id: args.assignment_id,
          },
          additionalHeaders: { "x-sh-dtt-agent-context": context },
        },
      ));
    },
    orchestration_dtt_verifier_assign_self: async (args, identity) => {
      if (!config.dttAgentIdentitySigningSecret) throw new Error("dtt_agent_identity_not_ready");
      if (!identity.agentPresence) throw new Error("agent_presence_session_required");
      const context = issueDttAgentContext({
        secret: config.dttAgentIdentitySigningSecret,
        tenant_id: identity.tenantId,
        agent_presence: identity.agentPresence,
      });
      return textResult(await coreRequest(
        `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/nodes/${encodeURIComponent(args.node_id)}/verifier-assignments`,
        identity.tenantId,
        { method: "POST", body: {}, additionalHeaders: { "x-sh-dtt-agent-context": context } },
      ));
    },
    orchestration_dtt_artifact_register: async (args, identity) => textResult(await coreRequest(
      "/v1/orchestration/evidence/artifacts",
      identity.tenantId,
      {
        method: "POST",
        body: {
          artifact_id: args.artifact_id,
          content: args.content,
          source_reference: args.source_reference,
          registry_reference: args.registry_reference,
        },
      },
    )),
    orchestration_dtt_cancel: async (args, identity) => textResult(await coreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/cancel`,
      identity.tenantId,
      {
        method: "POST",
        body: { reason: args.reason },
      },
    )),
    orchestration_dtt_retry_fallback_read: async (args, identity) => textResult(await coreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/retry-fallback`,
      identity.tenantId,
    )),
    orchestration_dtt_core_join: async (args, identity) => textResult(await coreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/core-join`,
      identity.tenantId,
      {
        method: "POST",
        body: {},
      },
    )),
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
    nyra_research_distillation_status: async (_args, identity) => textResult(
      await coreRequest("/v1/research/status", identity.tenantId),
    ),
    nyra_research_source_registry: async (_args, identity) => textResult(
      await coreRequest("/v1/research/source-registry", identity.tenantId),
    ),
    nyra_research_learning_pack: async (args, identity) => {
      const query = new URLSearchParams();
      if (args.branch_id) query.set("branch_id", String(args.branch_id));
      const suffix = query.size ? `?${query.toString()}` : "";
      return textResult(await coreRequest(`/v1/research/learning-packs${suffix}`, identity.tenantId));
    },
    nyra_research_envelope_authorize: async (args, identity) => textResult(
      await coreRequest("/v1/research/envelope/authorize", identity.tenantId, {
        method: "POST",
        body: {
          request_id: args.request_id,
          question: args.question,
          branch_ids: args.branch_ids,
          allowed_source_ids: args.allowed_source_ids,
          max_documents: args.max_documents,
          max_bytes: args.max_bytes,
          max_duration_ms: args.max_duration_ms,
          max_cost: args.max_cost,
          retention_mode: args.retention_mode,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_workspace_open: async (args, identity) => textResult(
      await coreRequest("/v1/research/workspaces/open", identity.tenantId, {
        method: "POST",
        body: {
          envelope_id: args.envelope_id,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_workspace_attach: async (args, identity) => textResult(
      await coreRequest("/v1/research/workspaces/attach", identity.tenantId, {
        method: "POST",
        body: {
          workspace_id: args.workspace_id,
          evidence: args.evidence,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_distill: async (args, identity) => textResult(
      await coreRequest("/v1/research/distill", identity.tenantId, {
        method: "POST",
        body: {
          workspace_id: args.workspace_id,
          evidence: args.evidence,
          lesson: args.lesson,
          learning: args.learning,
          scope: args.scope,
          confidence: args.confidence,
          limitations: args.limitations,
          outcome_refs: args.outcome_refs,
          // The MCP bridge is deliberately candidate-only. Even if a direct
          // caller bypasses its JSON schema, Core never receives a persistence
          // request from this path.
          persist_verified: false,
          audit_reference: args.audit_reference,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_workspace_close: async (args, identity) => textResult(
      await coreRequest("/v1/research/workspaces/close", identity.tenantId, {
        method: "POST",
        body: {
          workspace_id: args.workspace_id,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_cleanup: async (_args, identity) => textResult(
      await coreRequest("/v1/research/cleanup", identity.tenantId, {
        method: "POST",
        body: { tenant_id: identity.tenantId },
      }),
    ),
    nyra_v2_preview: async (args, identity) => textResult(
      await nyraDeepV2Request(args, identity, "preview"),
    ),
    nyra_v2_requirements: async (args, identity) => textResult(
      await nyraDeepV2Request(args, identity, "requirements"),
    ),
    nyra_v2_evidence_prepare: async (args, identity) => textResult(
      await nyraDeepV2Request(args, identity, "prepare_evidence"),
    ),
    nyra_v2_evaluate: async (args, identity) => textResult(
      await nyraDeepV2Request(args, identity, "evaluate"),
    ),
    nyra_interpret_request: async (args, identity) => {
      // The Core bridge evaluates the runtime hierarchy internally. Keeping
      // that decision server-side avoids duplicate routing and ensures that
      // callers and Nyra cannot nominate V0/V1/V2 or become the authority.
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
      const coreRuntime = coreRuntimeFromBridge(payload);
      const governedPayload = { ...payload, core_runtime: coreRuntime };
      const analysisId = cacheAnalysis(identity.tenantId, governedPayload);
      if (args.response_mode === "full") {
        return compactTextResult({ ...governedPayload, analysis_id: analysisId, response_mode: "full" }, {
          ok: governedPayload.ok === true,
          analysis_id: analysisId,
          response_mode: "full",
          core_route: coreRuntime.route,
          core_authority: coreRuntime.selected_authority,
          execution_allowed: false,
        });
      }
      const detail = args.response_mode === "deep" ? "deep" : "fast";
      const compact = compactNyraPayload(governedPayload, { analysisId, detail });
      return compactTextResult(compact, {
        ok: compact.ok,
        analysis_id: analysisId,
        response_mode: detail,
        core_route: coreRuntime.route,
        core_authority: coreRuntime.selected_authority,
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
      const boundedInternalCoordination =
        args.operation_class === "bounded_internal_coordination_write";
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
        memory_context: _untrustedMemoryContext,
        ...safeArgs
      } = args;
      const requestBody = sanitizeCoreBody({
        ...safeArgs,
        ...(sharedContext ? { memory_context: sharedContext } : {}),
        tenant_id: identity.tenantId,
        owner_confirmed: boundedInternalCoordination ? false : confirmed,
        ...(!boundedInternalCoordination && confirmationReference
          ? { confirmation_reference: confirmationReference }
          : {}),
      });
      return textResult(await coreRequest("/v1/action-evaluator", identity.tenantId, {
        method: "POST",
        useTenantGateway: true,
        body: {
          ...requestBody,
          ...(!boundedInternalCoordination ? {
            owner_context: ownerContext(
              identity,
              ownerRequestBinding("core_action_evaluator", requestBody),
            ),
          } : {}),
        }
      }));
    }
  };
  return handlers;
}

export function createCoreWriteGuard(config, options = {}) {
  const handlers = createCoreHandlers(config, options);
  return async function governWrite(action, identity) {
    const autonomousInternalActionTypes = new Set([
      "agent.heartbeat",
      "task.claim",
      "task.update",
      "message.acknowledge",
      "work.participant.join",
      "work.participant.heartbeat",
      "work.branch.open",
      "work.lease.acquire",
      "work.lease.renew",
      "work.lease.release",
      "work.message.post",
    ]);
    const ownerConfirmedInternalActionTypes = new Set([
      "workspace.create_folder",
      "workspace.write_document",
      "task.create",
      "message.post",
      "memory.append",
      "memory.checkpoint",
      "memory.handoff",
      "memory.handoff_acknowledge",
      "research.plan_issued",
      "research.ingest",
      "research.feedback",
    ]);
    const actionType = String(action.action_type || "").toLowerCase();
    const operationClass = action.operation_class ||
      (autonomousInternalActionTypes.has(actionType)
        ? "bounded_internal_coordination_write"
        : "owner_confirmed_governed_action");
    if (!action.operation_class &&
      !autonomousInternalActionTypes.has(actionType) &&
      !ownerConfirmedInternalActionTypes.has(actionType)) {
      return {
        allowed: false,
        decision: "not_authorized",
        mediation: "defer",
        owner_confirmation_required: true,
        confirmation_satisfied: false,
      };
    }
    const result = await handlers.core_gate_action({
      action_label: action.action_label,
      action_type: action.action_type,
      target: action.target,
      operation_class: operationClass,
      external_side_effect: action.external_side_effect === true,
      contains_customer_data: action.contains_customer_data === true,
      contains_secret: action.contains_secret === true,
      secret_value_transmitted: action.secret_value_transmitted === true,
      cross_tenant: action.cross_tenant === true,
      configuration_changes: action.configuration_changes === true,
      destructive: action.destructive === true,
      bypass_orchestrator: action.bypass_orchestrator === true,
      provider_execution: action.provider_execution === true,
      bounded_scope: action.bounded_scope === true,
      low_impact: action.low_impact === true,
      idempotent_or_compensable: action.idempotent_or_compensable === true,
      deploy: action.deploy === true,
      production_deploy: action.production_deploy === true,
      merge: action.merge === true,
      delete: action.delete === true,
      execution_enabled: action.execution_enabled === true,
      force: action.force === true,
      admin_bypass: action.admin_bypass === true,
      rollback_ready: action.rollback_ready === undefined ? action.external_side_effect !== true : action.rollback_ready === true,
      audit_ready: action.audit_ready === true,
      target_authority_verified: action.target_authority_verified === true,
      actor_authorized_for_target: action.actor_authorized_for_target === true,
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
