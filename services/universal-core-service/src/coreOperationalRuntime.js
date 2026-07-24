import crypto from "node:crypto";
import { evaluateCoreRuntimeHierarchy } from "./coreRuntimeHierarchy.js";
import { routeNyraBranches, nyraBranchCatalog } from "./nyraBranchNetwork.js";
import { createGovernedDynamicThoughtTreeRuntime } from "./dtt/governedDynamicThoughtTree.js";

export const CORE_DECISION_ENVELOPE_VERSION = "core_decision_envelope_v1";
export const CORE_CAPABILITY_VERSION = "core_execution_capability_v1";
export const CORE_UTILIZATION_VERSION = "core_utilization_v1";

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function cleanText(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sign(value, secret) {
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(JSON.stringify(value)).digest("hex");
}

function deterministicBucket(requestId) {
  return Number.parseInt(stableHash(requestId).slice(0, 8), 16) % 100;
}

function emptyCounters() {
  return {
    requests: 0,
    hierarchy_covered: 0,
    routes: { V0: 0, V1: 0, V2: 0 },
    authorities: { V0: 0, V1: 0, V2: 0 },
    states: {},
    controls: {},
    parity: { attempted: 0, matched: 0, mismatched: 0, fallback: 0 },
    canary: { eligible: 0, selected: 0 },
    capabilities: { issued: 0, denied: 0 },
    outcomes: { recorded: 0, linked: 0 },
    last_decision_at: null,
  };
}

function increment(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function percentage(value, total) {
  return total ? Math.min(100, Number(((value / total) * 100).toFixed(2))) : 0;
}

function utilization(counters) {
  const coverage = percentage(counters.hierarchy_covered, counters.requests);
  const parity = percentage(counters.parity.matched, counters.parity.attempted);
  const canary = percentage(counters.canary.selected, counters.canary.eligible);
  const outcomes = percentage(counters.outcomes.linked, counters.requests);
  const branchProxy = Object.keys(counters.states).length && Object.keys(counters.controls).length ? 100 : 0;
  const score = Number((coverage * 0.30 + parity * 0.20 + canary * 0.15 + outcomes * 0.25 + branchProxy * 0.10).toFixed(2));
  return {
    schema_version: CORE_UTILIZATION_VERSION,
    score,
    components: {
      hierarchy_coverage_percent: coverage,
      v2_parity_percent: parity,
      v2_canary_selection_percent: canary,
      verified_outcome_closure_percent: outcomes,
      decision_surface_coverage_percent: branchProxy,
    },
    interpretation: score >= 80 ? "high" : score >= 55 ? "medium" : "low",
  };
}

function buildEnvelope({ tenantId, input, verdict, hierarchy, configuredMode, effectiveMode, signatureSecret }) {
  const issuedAt = new Date().toISOString();
  const payload = {
    schema_version: CORE_DECISION_ENVELOPE_VERSION,
    decision_id: `decision_${crypto.randomUUID()}`,
    request_id: input.request_id,
    tenant_id: tenantId,
    issued_at: issuedAt,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    runtime: {
      configured_mode: configuredMode,
      effective_mode: effectiveMode,
      hierarchy_version: hierarchy.hierarchy_version,
      route: hierarchy.router.route,
      selected_authority: hierarchy.selected_authority,
      parity: hierarchy.parity,
    },
    decision: {
      state: verdict.decision_state,
      action: verdict.decision,
      control_level: verdict.decision_contract?.control_level,
      risk_band: verdict.risk?.band,
      risk_score: verdict.risk?.score,
      confidence: verdict.confidence,
      execution_allowed: verdict.executionAllowed === true,
      confirmation_required: verdict.requiresOwnerConfirmation === true,
      blocked_reasons: verdict.decision_contract?.blocked_reasons || [],
      mediation: verdict.action_mediation?.state || null,
    },
    evidence: {
      audit_id: verdict.audit_id,
      core_version: verdict.core_output?.diagnostics?.core_version || null,
      contract_version: verdict.core_output?.diagnostics?.contract_version || null,
    },
  };
  return { ...payload, decision_hash: stableHash(JSON.stringify(payload)), signature: sign(payload, signatureSecret) };
}

function issueCapability({ tenantId, payload, verdict, envelope, signatureSecret }) {
  const requested = payload.issue_capability === true;
  if (!requested) return { requested: false, issued: false, reason: "not_requested" };
  if (!signatureSecret) return { requested: true, issued: false, reason: "signing_secret_unavailable" };
  if (payload.owner_confirmed !== true) return { requested: true, issued: false, reason: "owner_confirmation_required" };
  if (verdict.executionAllowed !== true) return { requested: true, issued: false, reason: "execution_not_allowed" };
  if (["block", "hard_block", "confirm", "defer", "rollback_required"].includes(verdict.action_mediation?.state)) {
    return { requested: true, issued: false, reason: "mediation_not_executable" };
  }
  const ttlSeconds = Math.max(30, Math.min(300, Number(payload.capability_ttl_seconds) || 120));
  const capability = {
    schema_version: CORE_CAPABILITY_VERSION,
    capability_id: `cap_${crypto.randomUUID()}`,
    tenant_id: tenantId,
    decision_id: envelope.decision_id,
    request_id: envelope.request_id,
    action_type: cleanText(payload.requested_action?.type || payload.action_type || "execution", 120),
    resource: cleanText(payload.requested_action?.resource || payload.resource || "tenant_scoped_action", 200),
    single_use: true,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
  return { requested: true, issued: true, capability: { ...capability, signature: sign(capability, signatureSecret) } };
}

export function createCoreOperationalRuntime(options = {}) {
  const worker = options.worker;
  const configuredMode = ["shadow", "active", "disabled"].includes(options.mode) ? options.mode : "shadow";
  const canaryPercent = clamp(options.canaryPercent ?? 0);
  const signatureSecret = cleanText(options.signatureSecret, 4096);
  const dttRuntime = options.dttRuntime || createGovernedDynamicThoughtTreeRuntime({
    env: options.env || process.env,
    now: options.now || (() => Date.now()),
  });
  const tenants = new Map();
  const decisions = new Map();
  const capabilities = new Map();

  function countersFor(tenantId) {
    if (!tenants.has(tenantId)) tenants.set(tenantId, emptyCounters());
    return tenants.get(tenantId);
  }

  async function evaluate({ tenantId, input, payload, verdict, routing, ownerMode = "normal", v0Result = null }) {
    const counters = countersFor(tenantId);
    const canaryEligible = configuredMode === "active" && deterministicBucket(input.request_id) < canaryPercent;
    const effectiveMode = configuredMode === "active" && !canaryEligible ? "shadow" : configuredMode;
    const hierarchy = await evaluateCoreRuntimeHierarchy(input, { worker, mode: effectiveMode, routing, ownerMode, v0Result });
    const packId = String(input?.domain_pack_id || input?.context?.domain_pack_id || input?.context?.metadata?.domain_pack_id || "generic");
    const requestText = cleanText([
      input?.request_text,
      input?.message,
      input?.prompt,
      input?.context?.metadata?.intent,
      input?.context?.metadata?.request_label,
      input?.domain,
      verdict?.decision,
    ].filter(Boolean).join(" "), 500);
    const branchRoute = routeNyraBranches({
      text: requestText,
      requestedBranches: Array.isArray(input?.requested_branches) ? input.requested_branches : [],
      domainPackId: packId,
    });
    const dttResult = dttRuntime.evaluate({
      tenant_id: tenantId,
      request_id: input.request_id,
      request_fingerprint: stableHash(JSON.stringify({
        request_id: input.request_id,
        tenant_id: tenantId,
        requestText,
        domain: input?.domain || "",
        signals: Array.isArray(input?.signals) ? input.signals.map((signal) => signal?.id || signal?.label || signal?.category || "") : [],
      })),
      text: requestText,
      intent: cleanText(input?.intent || input?.context?.metadata?.intent || verdict?.decision || input?.domain || "request", 120),
      fixed_branch_ids: branchRoute.opened_branches.map((branch) => branch.id),
      branch_catalog: nyraBranchCatalog(packId).branches,
      supporting_evidence_refs: Array.isArray(input?.supporting_evidence_refs) ? input.supporting_evidence_refs : [],
      contradicting_evidence_refs: Array.isArray(input?.contradicting_evidence_refs) ? input.contradicting_evidence_refs : [],
      provenance_refs: Array.isArray(input?.provenance_refs) ? input.provenance_refs : [],
      confidence: Number(verdict?.confidence ?? 0.6) / 100,
      signal_strength: Number(routing?.data_quality ?? input?.data_quality?.score ?? 0.5) / 100,
      risk: Number(verdict?.risk?.score ?? routing?.risk ?? 0) / 100,
      ambiguity: Number(routing?.ambiguity ?? 0.4),
      reversibility: Number(input?.reversibility_hint ?? 0.6),
      uncertainty: Number(1 - (Number(verdict?.confidence ?? 0.6) / 100)),
      source_reliability: Number(input?.source_reliability ?? 0.7),
      reuse_score: Number(input?.reuse_score ?? 0.5),
      tenant_safe: true,
      policy_match: true,
      budget: {
        max_nodes: Number(input?.dtt_budget?.max_nodes ?? 64),
        beam_width: Number(input?.dtt_budget?.beam_width ?? 3),
        max_children: Number(input?.dtt_budget?.max_children ?? 3),
        max_workers: Number(input?.dtt_budget?.max_workers ?? 8),
        max_retries: Number(input?.dtt_budget?.max_retries ?? 2),
        deadline_ms: Number(input?.dtt_budget?.deadline_ms ?? 0),
      },
      core_decision_reference: {
        state: hierarchy.selected_authority,
        authority: "universal_core",
        route_trace: [hierarchy.router.route, hierarchy.selected_authority],
      },
      catalog_version: "nyra_neural_branch_network_v1",
      policy_version: dttRuntime.config.schema_version,
      allowed_depth_override: input?.dtt_depth_override ?? null,
    });
    counters.requests += 1;
    counters.hierarchy_covered += 1;
    increment(counters.routes, hierarchy.router.route);
    increment(counters.authorities, hierarchy.selected_authority);
    increment(counters.states, verdict.decision_state || "unknown");
    increment(counters.controls, verdict.decision_contract?.control_level || "unknown");
    if (hierarchy.parity.attempted) counters.parity.attempted += 1;
    if (hierarchy.parity.matched === true) counters.parity.matched += 1;
    if (hierarchy.parity.matched === false) counters.parity.mismatched += 1;
    if (hierarchy.parity.fallback) counters.parity.fallback += 1;
    if (configuredMode === "active" && hierarchy.router.route === "V2") counters.canary.eligible += 1;
    if (hierarchy.selected_authority === "V2") counters.canary.selected += 1;
    counters.last_decision_at = new Date().toISOString();

    const envelope = buildEnvelope({ tenantId, input, verdict, hierarchy, configuredMode, effectiveMode, signatureSecret });
    const capability = issueCapability({ tenantId, payload, verdict, envelope, signatureSecret });
    if (capability.requested) counters.capabilities[capability.issued ? "issued" : "denied"] += 1;
    if (capability.issued) capabilities.set(capability.capability.capability_id, { ...capability.capability, consumed_at: null });
    decisions.set(envelope.decision_id, { tenant_id: tenantId, request_id: input.request_id, issued_at: envelope.issued_at });
    if (decisions.size > 20_000) decisions.delete(decisions.keys().next().value);
    return { hierarchy, envelope, capability, dtt: dttResult, utilization: utilization(counters) };
  }

  function consumeCapability(tenantId, candidate = {}) {
    const id = cleanText(candidate.capability_id, 120);
    const stored = capabilities.get(id);
    if (!stored || stored.tenant_id !== tenantId) return { valid: false, consumed: false, reason: "capability_not_found" };
    if (stored.consumed_at) return { valid: false, consumed: false, reason: "capability_already_consumed" };
    if (Date.parse(stored.expires_at) <= Date.now()) return { valid: false, consumed: false, reason: "capability_expired" };
    const { signature, consumed_at: _consumedAt, ...unsigned } = stored;
    const expected = sign(unsigned, signatureSecret);
    const supplied = cleanText(candidate.signature, 256);
    const signatureValid = Boolean(expected && supplied && expected.length === supplied.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)));
    if (!signatureValid) return { valid: false, consumed: false, reason: "capability_signature_invalid" };
    if (candidate.action_type && cleanText(candidate.action_type, 120) !== stored.action_type) return { valid: false, consumed: false, reason: "capability_action_mismatch" };
    stored.consumed_at = new Date().toISOString();
    return { valid: true, consumed: true, capability_id: id, decision_id: stored.decision_id, action_type: stored.action_type, resource: stored.resource, consumed_at: stored.consumed_at };
  }

  function recordOutcome(tenantId, decisionId) {
    const counters = countersFor(tenantId);
    counters.outcomes.recorded += 1;
    const linked = Boolean(decisionId && decisions.get(decisionId)?.tenant_id === tenantId);
    if (linked) counters.outcomes.linked += 1;
    return { linked, utilization: utilization(counters) };
  }

  function status(tenantId) {
    const counters = countersFor(tenantId);
    return {
      schema_version: CORE_UTILIZATION_VERSION,
      tenant_id: tenantId,
      configured_mode: configuredMode,
      canary_percent: canaryPercent,
      signing_ready: Boolean(signatureSecret),
      dtt: dttRuntime.status(tenantId),
      counters: structuredClone(counters),
      utilization: utilization(counters),
    };
  }

  return { evaluate, recordOutcome, consumeCapability, status };
}
