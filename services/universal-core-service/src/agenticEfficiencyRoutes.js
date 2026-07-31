import {
  AGENTIC_BUDGET_DEFAULT_MODE,
  AGENTIC_EFFICIENCY_CAPABILITY_MANIFEST,
  AGENTIC_EFFICIENCY_DEFAULT_MODE,
  assertNoUntrustedIdentity,
  buildAgenticEfficiencyPlan,
  compareAgenticSavings,
  evaluateAgenticBudgetGuard,
  digestAgenticArtifact,
} from "./agenticEfficiencyRuntime.js";

const CANONICAL_CLIENT_AUDIENCE = Object.freeze({
  chatgpt: "chatgpt_connector",
  codex: "codex_internal",
  api_agent: "api_agent",
  smartdesk: "smartdesk_runtime",
  analyzer: "analyzer_runtime",
  tricocamera: "analyzer_runtime",
  suite: "suite_runtime",
  waas: "suite_runtime",
  admin: "admin_control_room",
});

function text(value, field, max = 160) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function trustedRequestContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("trusted_context_missing");
  const context = {
    tenantId: text(value.tenantId, "trusted_context_tenant_id", 120),
    clientType: text(value.clientType, "trusted_context_client_type", 80),
    audience: text(value.audience, "trusted_context_audience", 160),
    actorId: text(value.actorId, "trusted_context_actor_id", 160),
    entitlements: Array.isArray(value.entitlements) ? value.entitlements.map((item) => text(item, "trusted_context_entitlement", 160)) : [],
    scopes: Array.isArray(value.scopes) ? value.scopes.map((item) => text(item, "trusted_context_scope", 160)) : [],
  };
  return Object.freeze(context);
}

function capabilityById(capabilityId) {
  const capability = AGENTIC_EFFICIENCY_CAPABILITY_MANIFEST.find((item) => item.capability_id === capabilityId);
  if (!capability) throw new Error("agentic_capability_unknown");
  return capability;
}

function authorizeCapability(context, capabilityId) {
  const capability = capabilityById(capabilityId);
  if (CANONICAL_CLIENT_AUDIENCE[context.clientType] !== context.audience) {
    throw new Error("agentic_client_audience_pair_not_allowed");
  }
  if (!capability.allowed_client_types.includes(context.clientType)) throw new Error("agentic_client_not_allowed");
  if (!capability.allowed_audiences.includes(context.audience)) throw new Error("agentic_audience_not_allowed");
  if (!capability.required_entitlements.every((entitlement) => context.entitlements.includes(entitlement))) {
    throw new Error("agentic_entitlement_missing");
  }
  if (!capability.required_scopes.every((scope) => context.scopes.includes(scope) || context.entitlements.includes(scope))) {
    throw new Error("agentic_scope_missing");
  }
  return capability;
}

function rejectQueryIdentity(req) {
  assertNoUntrustedIdentity(req?.query || {}, "query");
}

function statusFor(error) {
  const code = String(error?.message || "agentic_request_failed");
  if (code.includes("not_allowed") || code.includes("scope_missing") || code.includes("entitlement_missing")) return 403;
  if (code.includes("not_found")) return 404;
  if (code.includes("duplicate_execution") || code.includes("receipt_replayed")) return 409;
  return 400;
}

function safeError(error) {
  const code = String(error?.message || "agentic_request_failed").split(":")[0];
  return /^[a-z0-9_]+$/i.test(code) ? code : "agentic_request_failed";
}

function canonicalVerifiedUsage(verification, declaredUsage, {
  context,
  slot,
  receiptBindings,
} = {}) {
  if (verification?.verified !== true) {
    return { usage: declaredUsage, verified: false, receiptDigest: null };
  }
  const canonicalUsage = verification.canonicalUsage;
  if (!canonicalUsage || typeof canonicalUsage !== "object" || Array.isArray(canonicalUsage)) {
    throw new Error("agentic_provider_usage_attestation_invalid");
  }
  assertNoUntrustedIdentity(canonicalUsage, "provider_usage_attestation");
  const receiptDigest = String(
    verification.receiptDigest || canonicalUsage.provider_receipt_digest || "",
  ).trim();
  if (
    canonicalUsage.usage_kind !== "actual"
    || !/^sha256:[a-f0-9]{64}$/.test(receiptDigest)
    || canonicalUsage.provider_receipt_digest !== receiptDigest
  ) {
    throw new Error("agentic_provider_usage_attestation_invalid");
  }
  const runId = String(verification.runId || canonicalUsage.run_id || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(runId)) {
    throw new Error("agentic_provider_usage_attestation_invalid");
  }
  for (const field of ["input_tokens", "cached_input_tokens", "output_tokens"]) {
    const value = Number(canonicalUsage[field] || 0);
    if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) {
      throw new Error("agentic_provider_usage_attestation_invalid");
    }
  }
  const bindingDigest = digestAgenticArtifact({
    tenant_id: context.tenantId,
    slot,
    usage: canonicalUsage,
  });
  const previous = receiptBindings.get(receiptDigest);
  if (previous && previous !== bindingDigest) {
    throw new Error("agentic_provider_receipt_replayed");
  }
  receiptBindings.set(receiptDigest, bindingDigest);
  return {
    usage: Object.freeze({ ...canonicalUsage }),
    verified: true,
    receiptDigest,
    runId,
  };
}

export function mountAgenticEfficiencyRoutes({
  app,
  store,
  resolveRequestContext,
  readAuth = null,
  governAuth = null,
  verifyProviderUsage = async () => ({ verified: false }),
  verifyAcceptanceEvidence = async () => ({}),
  verifyGovernanceEvidence = async () => ({}),
  verifySavingsEvidence = async () => ({}),
  resolveRateCard = async () => ({ verified: false, rateCard: null }),
  audit = null,
  efficiencyMode = AGENTIC_EFFICIENCY_DEFAULT_MODE,
  budgetMode = AGENTIC_BUDGET_DEFAULT_MODE,
  hardBudgetStopStatus = null,
} = {}) {
  if (!app || typeof app.get !== "function" || typeof app.post !== "function") throw new Error("agentic_route_app_invalid");
  if (!store || typeof store.status !== "function") throw new Error("agentic_route_store_invalid");
  if (typeof resolveRequestContext !== "function") throw new Error("agentic_route_context_resolver_required");
  if (typeof verifyProviderUsage !== "function") throw new Error("agentic_route_usage_verifier_invalid");
  if (typeof verifyAcceptanceEvidence !== "function") throw new Error("agentic_route_acceptance_verifier_invalid");
  if (typeof verifyGovernanceEvidence !== "function") throw new Error("agentic_route_governance_verifier_invalid");
  if (typeof verifySavingsEvidence !== "function") throw new Error("agentic_route_savings_verifier_invalid");
  if (typeof resolveRateCard !== "function") throw new Error("agentic_route_rate_card_resolver_invalid");
  const hardBudgetStop = Object.freeze({
    active: false,
    state: String(hardBudgetStopStatus?.state || "disabled"),
    advisory_only: hardBudgetStopStatus?.advisory_only === true,
    reason: String(hardBudgetStopStatus?.reason || "hard_budget_stop_disabled"),
  });
  const receiptBindings = new Map();
  const register = (method, path, capabilityId, handler) => {
    const middleware = capabilityById(capabilityId).required_scopes.includes("core:govern")
      ? governAuth
      : readAuth;
    if (middleware !== null && typeof middleware !== "function") {
      throw new Error("agentic_route_auth_invalid");
    }
    const mounted = route(capabilityId, handler);
    if (middleware) app[method](path, middleware, mounted);
    else app[method](path, mounted);
  };

  const route = (capabilityId, handler) => async (req, res) => {
    try {
      rejectQueryIdentity(req);
      assertNoUntrustedIdentity(req?.body || {});
      const context = trustedRequestContext(await resolveRequestContext(req));
      const capability = authorizeCapability(context, capabilityId);
      const result = await handler({ req, context, capability });
      if (typeof audit === "function") {
        await audit({
          event: "agentic_efficiency_capability_read",
          tenant_id: context.tenantId,
          actor_id: context.actorId,
          capability_id: capabilityId,
          outcome: "ok",
          execution_authorized: false,
        });
      }
      return res.status(200).json({
        ok: true,
        capability_id: capabilityId,
        execution_authorized: false,
        arbitrary_route_invocation: false,
        data: result,
      });
    } catch (error) {
      const code = safeError(error);
      if (typeof audit === "function") {
        await audit({
          event: "agentic_efficiency_capability_rejected",
          capability_id: capabilityId,
          outcome: code,
          execution_authorized: false,
        });
      }
      return res.status(statusFor(error)).json({
        ok: false,
        error: code,
        execution_authorized: false,
      });
    }
  };

  register("post", "/v1/agentic-efficiency/plan", "agentic_efficiency_plan", async ({ req, context }) => {
    const verification = await verifyAcceptanceEvidence({ req, context, task: req.body });
    return buildAgenticEfficiencyPlan({
      trustedContext: context,
      trustedVerification: verification || {},
      request: req.body,
      mode: efficiencyMode,
    });
  });

  register("get", "/v1/agentic-efficiency/status", "agentic_efficiency_status", async ({ context }) => ({
    mode: efficiencyMode,
    budget_mode: budgetMode,
    hard_budget_stop: hardBudgetStop.active,
    hard_budget_stop_state: hardBudgetStop.state,
    hard_budget_stop_advisory_only: hardBudgetStop.advisory_only,
    hard_budget_stop_reason: hardBudgetStop.reason,
    ...(await store.status({ tenant_id: context.tenantId })),
  }));

  register("get", "/v1/agentic-efficiency/report", "agentic_efficiency_report", async ({ context }) => ({
    mode: efficiencyMode,
    ...(await store.report({ tenant_id: context.tenantId })),
  }));

  register("post", "/v1/agentic-efficiency/budget/preview", "agentic_budget_preview", async ({ req, context }) => {
    const verification = req.body?.usage
      ? await verifyProviderUsage({ req, context, usage: req.body.usage, slot: "candidate" })
      : { verified: false };
    const verifiedUsage = req.body?.usage
      ? canonicalVerifiedUsage(verification, req.body.usage, {
        context,
        slot: "candidate",
        receiptBindings,
      })
      : { usage: null, verified: false };
    const boundedPlan = buildAgenticEfficiencyPlan({
      trustedContext: context,
      request: req.body?.task,
      mode: efficiencyMode,
    });
    const governanceVerification = await verifyGovernanceEvidence({
      req,
      context,
      task: req.body?.task,
      policy: req.body?.policy,
      plan: boundedPlan,
    });
    const rateCardResolution = await resolveRateCard({
      req,
      context,
      declaredRateCard: req.body?.rate_card || null,
      usage: verifiedUsage.usage,
    });
    const canonicalRateCard = rateCardResolution?.verified === true
      ? rateCardResolution.rateCard
      : req.body?.rate_card || null;
    return evaluateAgenticBudgetGuard({
      trustedContext: context,
      plan: boundedPlan,
      policy: req.body?.policy,
      usage: verifiedUsage.usage,
      rateCard: canonicalRateCard,
      providerUsageVerified: verifiedUsage.verified,
      rateCardVerified: rateCardResolution?.verified === true,
      auditReceiptVerified: governanceVerification?.auditOverrideVerified === true,
      trustedVerifications: {
        ...(governanceVerification || {}),
        rateCardVerified: rateCardResolution?.verified === true,
      },
      mode: budgetMode,
    });
  });

  register("get", "/v1/agentic-efficiency/budget/status", "agentic_budget_status", async ({ context }) => ({
    tenant_id: context.tenantId,
    mode: budgetMode,
    hard_budget_stop: hardBudgetStop.active,
    hard_budget_stop_state: hardBudgetStop.state,
    hard_budget_stop_advisory_only: hardBudgetStop.advisory_only,
    hard_budget_stop_reason: hardBudgetStop.reason,
    critical_task_behavior: "escalate_or_safe_degraded_mode",
    execution_authorized: false,
  }));

  register("get", "/v1/agentic-efficiency/work-capsules/:capsule_id", "agentic_work_capsule_read", async ({ req, context }) => {
    const capsule = await store.getWorkCapsule({
      tenant_id: context.tenantId,
      capsule_id: text(req.params?.capsule_id, "capsule_id", 160),
    });
    if (!capsule) throw new Error("work_capsule_not_found");
    return capsule;
  });

  register("post", "/v1/agentic-efficiency/savings/compare", "agentic_savings_compare", async ({ req, context }) => {
    const baselineVerification = await verifyProviderUsage({
      req,
      context,
      usage: req.body?.baseline,
      slot: "baseline",
    });
    const optimizedVerification = await verifyProviderUsage({
      req,
      context,
      usage: req.body?.optimized,
      slot: "optimized",
    });
    const verifiedBaseline = canonicalVerifiedUsage(baselineVerification, req.body?.baseline, {
      context,
      slot: "baseline",
      receiptBindings,
    });
    const verifiedOptimized = canonicalVerifiedUsage(optimizedVerification, req.body?.optimized, {
      context,
      slot: "optimized",
      receiptBindings,
    });
    const savingsVerification = await verifySavingsEvidence({
      req,
      context,
      baseline: req.body?.baseline,
      optimized: req.body?.optimized,
    });
    const rateCardResolution = await resolveRateCard({
      req,
      context,
      declaredRateCard: req.body?.rate_card || null,
      baseline: verifiedBaseline.usage,
      optimized: verifiedOptimized.usage,
    });
    const canonicalRateCard = rateCardResolution?.verified === true
      ? rateCardResolution.rateCard
      : req.body?.rate_card;
    const comparison = compareAgenticSavings({
      trustedContext: context,
      baseline: verifiedBaseline.usage,
      optimized: verifiedOptimized.usage,
      rateCard: canonicalRateCard,
      baselineProviderUsageVerified: verifiedBaseline.verified,
      optimizedProviderUsageVerified: verifiedOptimized.verified,
      rateCardVerified: rateCardResolution?.verified === true,
      baselineQuality: req.body?.baseline_quality,
      optimizedQuality: req.body?.optimized_quality,
      securityPreserved: req.body?.security_preserved === true,
      qualitySafetyAttestationVerified: savingsVerification?.qualitySafetyAttestationVerified === true,
      qualitySafetyAttestationDigest: savingsVerification?.receiptDigest || null,
      attestedBaselineQuality: savingsVerification?.baselineQuality,
      attestedOptimizedQuality: savingsVerification?.optimizedQuality,
      attestedSecurityPreserved: savingsVerification?.securityPreserved === true,
    });
    // This capability is deliberately read-only in v0.16 shadow mode. Even
    // verified receipts are compared in memory and never create ledger rows.
    return comparison;
  });

  register("post", "/v1/agentic-efficiency/artifacts/reuse-check", "agentic_artifact_reuse_check", async ({ req, context }) => (
    store.checkArtifactReuse({
      tenant_id: context.tenantId,
      artifact_hash: text(req.body?.artifact_hash, "artifact_hash", 80),
      artifact_version: text(req.body?.artifact_version, "artifact_version", 160),
    })
  ));

  return Object.freeze({
    mounted: true,
    base_path: "/v1/agentic-efficiency",
    capability_count: AGENTIC_EFFICIENCY_CAPABILITY_MANIFEST.length,
    top_level_mcp_tools_added: 0,
    hard_budget_stop: hardBudgetStop,
    execution_authorized: false,
  });
}
