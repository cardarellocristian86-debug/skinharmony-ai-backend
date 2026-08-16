const ROUTES = Object.freeze([
  ["post", "/v1/software-cognition/graphs/upsert", "software_cognition_graph_upsert", "write"],
  ["post", "/v1/software-cognition/graphs/index-diff", "software_cognition_index_diff", "write"],
  ["post", "/v1/software-cognition/graphs/select", "software_cognition_graph_select", "read"],
  ["post", "/v1/software-cognition/traceability/build", "software_cognition_traceability_build", "write"],
  ["post", "/v1/software-cognition/architecture/recover", "software_cognition_architecture_recover", "write"],
  ["post", "/v1/software-cognition/events/route", "software_cognition_event_route", "write"],
  ["post", "/v1/software-cognition/calibration/update", "software_cognition_calibration_update", "write"],
  ["post", "/v1/software-cognition/impacts/predict", "software_cognition_impact_predict", "write"],
  ["post", "/v1/software-cognition/impacts/reconcile", "software_cognition_impact_reconcile", "write"],
  ["post", "/v1/software-cognition/obligations/expand", "software_cognition_obligation_expand", "read"],
  ["post", "/v1/software-cognition/obligations/coverage", "software_cognition_obligation_coverage", "write"],
  ["post", "/v1/software-cognition/plans", "software_cognition_plan_record", "read"],
  ["post", "/v1/software-cognition/supervision", "software_cognition_supervise", "write"],
  ["post", "/v1/software-cognition/challenges/read", "software_cognition_challenge_read", "read"],
  ["post", "/v1/software-cognition/challenges/resolve", "software_cognition_challenge_resolve", "write"],
  ["post", "/v1/software-cognition/runtime-observations", "software_cognition_runtime_observe", "write"],
  ["post", "/v1/software-cognition/learning/promote", "software_cognition_learning_promote", "write"],
  ["post", "/v1/software-cognition/closure/evaluate", "software_cognition_closure_evaluate", "write"],
]);

function statusFor(error) {
  if (Number.isInteger(error?.status)) return error.status;
  if (/tenant|identity|forged|foreign/i.test(String(error?.code || error?.message))) return 403;
  if (/stale|conflict|replay|rewrite/i.test(String(error?.code || error?.message))) return 409;
  if (/not_found/i.test(String(error?.code || error?.message))) return 404;
  return 422;
}

async function identityFrom(req, res, resolveAgentContext) {
  const identity = req.coreIdentity || req.auth || req.identity || res.locals?.coreIdentity || res.locals?.identity || {};
  const tenantId = req.tenantId || identity.tenant_id;
  if (!tenantId) throw new Error("software_authenticated_tenant_required");
  const token = String(req.get?.("x-sh-dtt-agent-context") || req.headers?.["x-sh-dtt-agent-context"] || "").trim();
  if (!token) throw new Error("software_dtt_agent_context_required");
  const receipt = await resolveAgentContext(token, tenantId, req);
  if (!receipt || receipt.tenant_id && receipt.tenant_id !== tenantId) throw new Error("software_dtt_agent_context_invalid");
  if (!receipt.agent_id || !receipt.session_fingerprint || !receipt.actor_provenance) throw new Error("software_dtt_agent_context_invalid");
  return {
    tenant_id: tenantId,
    actor_id: receipt.agent_id,
    actor_role: receipt.actor_role || "dtt_agent",
    authority_scope: Array.isArray(receipt.authority_scope) ? receipt.authority_scope : [],
    provenance: {
      session_fingerprint: receipt.session_fingerprint,
      actor_provenance: receipt.actor_provenance,
      client_type: receipt.client_type,
    },
  };
}

export function registerSoftwareCognitionRoutes({ app, authFor, runtime, resolveAgentContext, audit } = {}) {
  if (!app || typeof app.post !== "function") throw new Error("software_cognition_app_required");
  if (typeof authFor !== "function") throw new Error("software_cognition_auth_required");
  if (!runtime || typeof runtime.invoke !== "function") throw new Error("software_cognition_runtime_required");
  if (typeof resolveAgentContext !== "function") throw new Error("software_cognition_identity_resolver_required");
  for (const [method, path, capability, access] of ROUTES) {
    app[method](path, authFor(access), async (req, res) => {
      const startedAt = Date.now();
      try {
        const identity = await identityFrom(req, res, resolveAgentContext);
        const raw = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
        const { tenant_id: ignoredTenant, tenantId: ignoredAlias, ...input } = raw;
        const result = await runtime.invoke(capability, identity, input);
        await audit?.({ capability, tenant_id: identity.tenant_id, actor_id: identity.actor_id, ok: true, duration_ms: Date.now() - startedAt });
        res.status(access === "read" ? 200 : 201).json({ ok: true, result });
      } catch (error) {
        const code = String(error?.code || error?.message || "software_cognition_failed").slice(0, 160);
        try { await audit?.({ capability, ok: false, error_code: code, duration_ms: Date.now() - startedAt }); } catch { /* audit cannot alter verdict */ }
        res.status(statusFor(error)).json({ ok: false, error: { code, message: "The governed software cognition request was rejected." } });
      }
    });
  }
  return { schema_version: "software_cognition_routes_v1", routes: ROUTES.map(([method, path, capability, access]) => ({ method: method.toUpperCase(), path, capability, access })) };
}

export const SOFTWARE_COGNITION_ROUTES = ROUTES;
