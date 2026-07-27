import {
  AGENTIC_BUDGET_DEFAULT_MODE,
  AGENTIC_EFFICIENCY_CAPABILITY_MANIFEST,
  AGENTIC_EFFICIENCY_DEFAULT_MODE,
  assertNoUntrustedIdentity,
  buildAgenticEfficiencyPlan,
  compareAgenticSavings,
  evaluateAgenticBudgetGuard,
} from "./agenticEfficiencyRuntime.js";

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
  if (code.includes("duplicate_execution")) return 409;
  return 400;
}

function safeError(error) {
  const code = String(error?.message || "agentic_request_failed").split(":")[0];
  return /^[a-z0-9_]+$/i.test(code) ? code : "agentic_request_failed";
}

export function mountAgenticEfficiencyRoutes({
  app,
  store,
  resolveRequestContext,
  verifyProviderUsage = async () => ({ verified: false }),
  verifyAcceptanceEvidence = async () => ({}),
  verifyGovernanceEvidence = async () => ({}),
  verifySavingsEvidence = async () => ({}),
  resolveRateCard = async () => ({ verified: false, rateCard: null }),
  audit = null,
  efficiencyMode = AGENTIC_EFFICIENCY_DEFAULT_MODE,
  budgetMode = AGENTIC_BUDGET_DEFAULT_MODE,
} = {}) {
  if (!app || typeof app.get !== "function" || typeof app.post !== "function") throw new Error("agentic_route_app_invalid");
  if (!store || typeof store.status !== "function") throw new Error("agentic_route_store_invalid");
  if (typeof resolveRequestContext !== "function") throw new Error("agentic_route_context_resolver_required");
  if (typeof verifyProviderUsage !== "function") throw new Error("agentic_route_usage_verifier_invalid");
  if (typeof verifyAcceptanceEvidence !== "function") throw new Error("agentic_route_acceptance_verifier_invalid");
  if (typeof verifyGovernanceEvidence !== "function") throw new Error("agentic_route_governance_verifier_invalid");
  if (typeof verifySavingsEvidence !== "function") throw new Error("agentic_route_savings_verifier_invalid");
  if (typeof resolveRateCard !== "function") throw new Error("agentic_route_rate_card_resolver_invalid");

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

  app.post("/v1/agentic-efficiency/plan", route("agentic_efficiency_plan", async ({ req, context }) => {
    const verification = await verifyAcceptanceEvidence({ req, context, task: req.body });
    return buildAgenticEfficiencyPlan({
      trustedContext: context,
      trustedVerification: verification || {},
      request: req.body,
      mode: efficiencyMode,
    });
  }));

  app.get("/v1/agentic-efficiency/status", route("agentic_efficiency_status", async ({ context }) => ({
    mode: efficiencyMode,
    budget_mode: budgetMode,
    hard_budget_stop: false,
    ...(await store.status({ tenant_id: context.tenantId })),
  })));

  app.get("/v1/agentic-efficiency/report", route("agentic_efficiency_report", async ({ context }) => ({
    mode: efficiencyMode,
    ...(await store.report({ tenant_id: context.tenantId })),
  })));

  app.post("/v1/agentic-efficiency/budget/preview", route("agentic_budget_preview", async ({ req, context }) => {
    const verification = req.body?.usage
      ? await verifyProviderUsage({ req, context, usage: req.body.usage, slot: "candidate" })
      : { verified: false };
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
      usage: req.body?.usage || null,
    });
    const canonicalRateCard = rateCardResolution?.verified === true
      ? rateCardResolution.rateCard
      : req.body?.rate_card || null;
    return evaluateAgenticBudgetGuard({
      trustedContext: context,
      plan: boundedPlan,
      policy: req.body?.policy,
      usage: req.body?.usage || null,
      rateCard: canonicalRateCard,
      providerUsageVerified: verification?.verified === true,
      rateCardVerified: rateCardResolution?.verified === true,
      auditReceiptVerified: governanceVerification?.auditOverrideVerified === true,
      trustedVerifications: {
        ...(governanceVerification || {}),
        rateCardVerified: rateCardResolution?.verified === true,
      },
      mode: budgetMode,
    });
  }));

  app.get("/v1/agentic-efficiency/budget/status", route("agentic_budget_status", async ({ context }) => ({
    tenant_id: context.tenantId,
    mode: budgetMode,
    hard_budget_stop: false,
    critical_task_behavior: "escalate_or_safe_degraded_mode",
    execution_authorized: false,
  })));

  app.get("/v1/agentic-efficiency/work-capsules/:capsule_id", route("agentic_work_capsule_read", async ({ req, context }) => {
    const capsule = await store.getWorkCapsule({
      tenant_id: context.tenantId,
      capsule_id: text(req.params?.capsule_id, "capsule_id", 160),
    });
    if (!capsule) throw new Error("work_capsule_not_found");
    return capsule;
  }));

  app.post("/v1/agentic-efficiency/savings/compare", route("agentic_savings_compare", async ({ req, context }) => {
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
      baseline: req.body?.baseline,
      optimized: req.body?.optimized,
    });
    const canonicalRateCard = rateCardResolution?.verified === true
      ? rateCardResolution.rateCard
      : req.body?.rate_card;
    return compareAgenticSavings({
      trustedContext: context,
      baseline: req.body?.baseline,
      optimized: req.body?.optimized,
      rateCard: canonicalRateCard,
      baselineProviderUsageVerified: baselineVerification?.verified === true,
      optimizedProviderUsageVerified: optimizedVerification?.verified === true,
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
  }));

  app.post("/v1/agentic-efficiency/artifacts/reuse-check", route("agentic_artifact_reuse_check", async ({ req, context }) => (
    store.checkArtifactReuse({
      tenant_id: context.tenantId,
      artifact_hash: text(req.body?.artifact_hash, "artifact_hash", 80),
      artifact_version: text(req.body?.artifact_version, "artifact_version", 160),
    })
  )));

  return Object.freeze({
    mounted: true,
    base_path: "/v1/agentic-efficiency",
    capability_count: AGENTIC_EFFICIENCY_CAPABILITY_MANIFEST.length,
    top_level_mcp_tools_added: 0,
    execution_authorized: false,
  });
}
