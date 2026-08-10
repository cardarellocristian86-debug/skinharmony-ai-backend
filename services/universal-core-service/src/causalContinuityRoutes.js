import { CausalContinuityError, publicError } from "./causalContinuityCanonical.js";

const ROUTES = Object.freeze([
  ["get", "/v1/causal/projects/resolve", "project_identity_resolve", "causal:read"],
  ["post", "/v1/causal/projects", "project_identity_create", "causal:write"],
  ["get", "/v1/causal/projects/scope", "project_scope_read", "causal:read"],
  ["post", "/v1/causal/projects/scope", "project_scope_bind", "causal:write"],
  ["post", "/v1/causal/projects/state/snapshot", "project_state_snapshot", "causal:write"],
  ["get", "/v1/causal/projects/state/verify", "project_state_verify", "causal:read"],
  ["get", "/v1/causal/intents/genesis", "genesis_intent_read", "causal:read"],
  ["post", "/v1/causal/intents/genesis", "genesis_intent_create", "causal:write"],
  ["post", "/v1/causal/intents/revisions", "intent_revision_propose", "causal:write"],
  ["post", "/v1/causal/intents/revisions/approve", "intent_revision_approve", "causal:approve"],
  ["get", "/v1/causal/intents/revisions/impact", "intent_revision_impact", "causal:read"],
  ["get", "/v1/causal/projects/decision-path", "project_decision_path_read", "causal:read"],
  ["post", "/v1/causal/works/bind", "work_bind_intent", "causal:write"],
  ["post", "/v1/causal/changes", "change_create", "causal:write"],
  ["get", "/v1/causal/changes/read", "change_read", "causal:read"],
  ["post", "/v1/causal/changes/transition", "change_transition", "causal:write"],
  ["post", "/v1/causal/contexts/issue", "causal_context_issue", "causal:authorize"],
  ["post", "/v1/causal/contexts/validate", "causal_context_validate", "causal:read"],
  ["post", "/v1/causal/obligations", "causal_obligation_create", "causal:write"],
  ["get", "/v1/causal/obligations/read", "causal_obligation_read", "causal:read"],
  ["post", "/v1/causal/obligations/transition", "causal_obligation_transition", "causal:write"],
  ["post", "/v1/causal/observations", "causal_observation_record", "causal:evidence"],
  ["post", "/v1/causal/reconciliations", "causal_reconcile", "causal:reconcile"],
  ["post", "/v1/causal/closures", "causal_close", "causal:close"],
  ["post", "/v1/causal/closures/reopen", "causal_reopen", "causal:reopen"],
  ["post", "/v1/causal/continuity/capsules", "continuity_capsule_build", "causal:write"],
  ["get", "/v1/causal/continuity/resume", "continuity_capsule_resume", "causal:read"],
  ["get", "/v1/causal/projects/timeline", "project_timeline_read", "causal:read"],
  ["post", "/v1/causal/gallery/bindings/project", "gallery_binding_project", "causal:write"],
  ["post", "/v1/causal/gallery/projections/claim", "gallery_projection_claim", "causal:write"],
  ["post", "/v1/causal/gallery/projections/complete", "gallery_projection_complete", "causal:write"],
  ["post", "/v1/causal/gallery/projections/fail", "gallery_projection_fail", "causal:write"],
  ["get", "/v1/causal/gallery/views", "gallery_causal_view_read", "causal:read"],
  ["get", "/v1/causal/metrics", "causal_metrics_snapshot", "causal:read"],
  ["get", "/v1/causal/gallery/bindings/verify", "gallery_binding_verify", "causal:read"],
  ["get", "/v1/causal/projects/rollout", "causal_rollout_read", "causal:read"],
  ["post", "/v1/causal/projects/rollout", "causal_rollout_set", "causal:approve"],
]);

async function identityFrom(req, res, resolveAgentContext) {
  const identity = req.coreIdentity || req.auth || req.identity || res.locals?.coreIdentity || res.locals?.identity || {};
  const tenantId = req.tenantId || identity.tenant_id;
  if (!tenantId) throw new CausalContinuityError("AUTHENTICATED_TENANT_REQUIRED");
  const token = String(req.get?.("x-sh-dtt-agent-context") || req.headers?.["x-sh-dtt-agent-context"] || "").trim();
  if (!token) throw new CausalContinuityError("AGENT_CONTEXT_REQUIRED");
  let receipt;
  try {
    receipt = await resolveAgentContext(token, tenantId, req);
  } catch {
    throw new CausalContinuityError("AGENT_CONTEXT_INVALID");
  }
  if (!receipt || typeof receipt !== "object") throw new CausalContinuityError("AGENT_CONTEXT_INVALID");
  if (receipt.tenant_id && receipt.tenant_id !== tenantId) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
  const actorId = String(receipt.agent_id || "").trim();
  const sessionFingerprint = String(receipt.session_fingerprint || "").trim();
  const actorProvenance = String(receipt.actor_provenance || "").trim();
  const clientType = String(receipt.client_type || "").trim();
  if (!actorId || !sessionFingerprint || !actorProvenance || !clientType) throw new CausalContinuityError("AGENT_CONTEXT_INVALID");
  const authenticatedScopes = Array.isArray(req.coreKey?.scopes)
    ? req.coreKey.scopes.map(String)
    : [];
  const receiptScopes = Array.isArray(receipt.authority_scope) ? new Set(receipt.authority_scope.map(String)) : null;
  const effectiveScopes = receiptScopes
    ? [...new Set(authenticatedScopes.filter((scope) => receiptScopes.has(scope)))].sort()
    : [...new Set(authenticatedScopes)].sort();
  return {
    tenant_id: tenantId,
    actor_id: actorId,
    actor_role: receipt.actor_role || "dtt_agent",
    // Authorization comes from Core's authenticated key record; actor/session
    // identity still comes exclusively from the verified DTT receipt above.
    authority_scope: effectiveScopes,
    owner_confirmed: req.coreKey?.owner_confirmed === true && receipt.owner_confirmed === true,
    provenance: {
      session_fingerprint: sessionFingerprint,
      actor_provenance: actorProvenance,
      client_type: clientType,
    },
  };
}

function scopeMiddleware(scopes, required) {
  if (!scopes) return [];
  if (typeof scopes === "function") return [scopes(required)];
  if (typeof scopes.require === "function") return [scopes.require(required)];
  if (typeof scopes[required] === "function") return [scopes[required]];
  const family = required === "causal:read" ? scopes.read : scopes.write;
  return typeof family === "function" ? [family] : [];
}

export function registerCausalContinuityRoutes({ app, coreAuth, authFor, scopes, runtime, resolveAgentContext, audit } = {}) {
  if (!app || typeof app.get !== "function" || typeof app.post !== "function") throw new CausalContinuityError("CAUSAL_APP_REQUIRED");
  const authFactory = authFor || coreAuth;
  if (typeof authFactory !== "function") throw new CausalContinuityError("CAUSAL_AUTH_MIDDLEWARE_REQUIRED");
  if (!runtime || typeof runtime.invoke !== "function") throw new CausalContinuityError("CAUSAL_RUNTIME_REQUIRED");
  if (typeof resolveAgentContext !== "function") throw new CausalContinuityError("AGENT_CONTEXT_RESOLVER_REQUIRED");

  for (const [method, path, capability, requiredScope] of ROUTES) {
    const authMiddleware = authFactory(requiredScope);
    if (typeof authMiddleware !== "function") throw new CausalContinuityError("CAUSAL_AUTH_MIDDLEWARE_REQUIRED");
    app[method](path, authMiddleware, ...scopeMiddleware(scopes, requiredScope), async (req, res) => {
      const startedAt = Date.now();
      try {
        const identity = await identityFrom(req, res, resolveAgentContext);
        const rawInput = method === "get" ? req.query || {} : req.body || {};
        const { tenant_id: ignoredTenantId, tenantId: ignoredTenantAlias, ...input } = rawInput;
        const result = await runtime.invoke(capability, identity, input);
        if (typeof audit === "function") {
          await audit({ capability, tenant_id: identity.tenant_id, actor_id: identity.actor_id, ok: true, duration_ms: Date.now() - startedAt });
        }
        res.status(method === "post" ? 201 : 200).json({ ok: true, result });
      } catch (error) {
        const status = error instanceof CausalContinuityError ? error.status : 500;
        if (typeof audit === "function") {
          try { await audit({ capability, ok: false, error_code: publicError(error).code, duration_ms: Date.now() - startedAt }); } catch { /* audit cannot change the primary verdict */ }
        }
        res.status(status).json({ ok: false, error: publicError(error) });
      }
    });
  }
  return { schema_version: "causal_continuity_routes_v1", routes: ROUTES.map(([method, path, capability, scope]) => ({ method: method.toUpperCase(), path, capability, scope })) };
}
