const ROUTES = Object.freeze([
  ["post", "/v1/entity-360/resolve", "entity_360_resolve", "read"],
  ["post", "/v1/entity-360/snapshots/assemble", "entity_360_snapshot_assemble", "write"],
  ["post", "/v1/entity-360/snapshots/latest", "entity_360_snapshot_latest", "read"],
  ["post", "/v1/entity-360/snapshots/read", "entity_360_snapshot_read", "read"],
  ["post", "/v1/entity-360/snapshots/verify", "entity_360_snapshot_verify", "read"],
  ["post", "/v1/entity-360/shadow/compare", "entity_360_shadow_compare", "write"],
  ["post", "/v1/entity-360/policy", "entity_360_policy_read", "read"],
  ["post", "/v1/entity-360/admin/feature-flag", "entity_360_feature_flag_write", "configure"],
  ["post", "/v1/entity-360/metrics", "entity_360_metrics_read", "read"],
]);

function statusFor(error) {
  if (Number.isInteger(error?.status)) return error.status;
  const code = String(error?.code || error?.message || "");
  if (/tenant|identity|forbidden|scope/i.test(code)) return 403;
  if (/not_found/i.test(code)) return 404;
  if (/stale|conflict|replay|mismatch/i.test(code)) return 409;
  if (/not_ready|unavailable|initialization/i.test(code)) return 503;
  return 422;
}

async function identityFrom(req, res, resolveAgentContext, access) {
  if (access === "configure") {
    const operator = res.locals?.entity360OperatorIdentity;
    if (!operator || operator.tenant_id !== req.tenantId
      || !operator.actor_id || operator.actor_role !== "universal_core_operator"
      || !operator.provenance?.session_fingerprint
      || operator.provenance?.actor_provenance !== "universal_core_platform_auth"
      || !Array.isArray(operator.authority_scope)) {
      const error = new Error("entity360_operator_identity_required");
      error.status = 403;
      throw error;
    }
    return operator;
  }
  const authenticated = req.coreIdentity || req.auth || req.identity
    || res.locals?.coreIdentity || res.locals?.identity || {};
  const tenantId = req.tenantId || authenticated.tenant_id;
  if (!tenantId) {
    const error = new Error("entity360_authenticated_tenant_required");
    error.status = 401;
    throw error;
  }
  const token = String(req.get?.("x-sh-dtt-agent-context")
    || req.headers?.["x-sh-dtt-agent-context"] || "").trim();
  if (!token) {
    const error = new Error("entity360_dtt_agent_context_required");
    error.status = 401;
    throw error;
  }
  let receipt;
  try { receipt = await resolveAgentContext(token, tenantId, req); }
  catch {
    const error = new Error("entity360_dtt_agent_context_invalid");
    error.status = 401;
    throw error;
  }
  if (!receipt || receipt.tenant_id && receipt.tenant_id !== tenantId
    || !receipt.agent_id || !receipt.session_fingerprint || !receipt.actor_provenance) {
    const error = new Error("entity360_dtt_agent_context_invalid");
    error.status = 401;
    throw error;
  }
  return {
    tenant_id: tenantId,
    work_id: receipt.work_id,
    actor_id: receipt.agent_id,
    actor_role: receipt.actor_role || "dtt_agent",
    // DTT proves the agent/session/tenant/Work binding but never contributes
    // configuration authority. The configure path uses the separate operator
    // identity branch above.
    authority_scope: [],
    provenance: {
      session_fingerprint: receipt.session_fingerprint,
      actor_provenance: receipt.actor_provenance,
      client_type: receipt.client_type,
    },
  };
}

export function registerEntity360Routes({ app, authFor, runtime, resolveAgentContext, audit } = {}) {
  if (!app || typeof app.post !== "function") throw new Error("entity360_app_required");
  if (typeof authFor !== "function") throw new Error("entity360_auth_required");
  if (!runtime || typeof runtime.invoke !== "function") throw new Error("entity360_runtime_required");
  if (typeof resolveAgentContext !== "function") throw new Error("entity360_identity_resolver_required");
  for (const [method, routePath, capability, access] of ROUTES) {
    app[method](routePath, authFor(access), async (req, res) => {
      const startedAt = Date.now();
      try {
        const identity = await identityFrom(req, res, resolveAgentContext, access);
        const raw = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
        const { tenant_id: _ignoredTenant, tenantId: _ignoredAlias,
          execution_authorized: _ignoredAuthority, authority: _ignoredAuthorityName, ...input } = raw;
        const result = await runtime.invoke(capability, identity, input);
        await audit?.({ capability, tenant_id: identity.tenant_id, actor_id: identity.actor_id,
          ok: true, duration_ms: Date.now() - startedAt, execution_authorized: false });
        res.status(access === "read" ? 200 : 201).json({ ok: true, result });
      } catch (error) {
        const candidateCode = String(error?.code || error?.message || "");
        const code = /^entity360_[a-z0-9_]{1,148}$/u.test(candidateCode)
          ? candidateCode : "entity360_request_failed";
        try { await audit?.({ capability, ok: false, error_code: code,
          duration_ms: Date.now() - startedAt, execution_authorized: false }); }
        catch { /* audit cannot alter the fail-closed response */ }
        res.status(statusFor(error)).json({ ok: false, error: { code,
          message: "The tenant-scoped Entity 360 request was rejected." } });
      }
    });
  }
  return Object.freeze({ schema_version: "entity_360_routes_v1",
    routes: ROUTES.map(([method, routePath, capability, access]) => ({
      method: method.toUpperCase(), path: routePath, capability, access,
    })) });
}

export const ENTITY_360_ROUTES = ROUTES;
