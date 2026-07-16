const MAX_RESPONSE_BYTES = 1_000_000;
const TENANT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;
const RESOURCE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/;

function safeErrorCode(value, fallback = "suite_control_plane_error") {
  const code = String(value || "").trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(code) ? code : fallback;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export class SuiteClientError extends Error {
  constructor(code, status = 500, options = {}) {
    super(safeErrorCode(code));
    this.name = "SuiteClientError";
    this.code = safeErrorCode(code);
    this.status = Number(status) || 500;
    this.retryable = options.retryable === true;
  }
}

function identityTenant(identity) {
  const tenantId = String(identity?.tenantId || "").trim();
  if (!TENANT_PATTERN.test(tenantId)) throw new SuiteClientError("suite_identity_tenant_invalid", 403);
  return tenantId;
}

function resourceId(value, name) {
  const id = String(value || "").trim();
  if (!id || !RESOURCE_ID_PATTERN.test(id)) throw new SuiteClientError(`suite_${name}_invalid`, 400);
  return id;
}

function tenantCandidates(payload) {
  const values = [
    payload?.tenant_id,
    payload?.scope?.tenant_id,
    payload?.dashboard?.tenant_id,
    payload?.cockpit?.scope?.tenant_id,
    payload?.preview?.tenant_id,
  ];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function createSuiteClient(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const cache = new Map();
  const baseUrl = String(config.suiteControlPlaneUrl || "").replace(/\/+$/, "");
  const keys = config.suiteControlPlaneKeys && typeof config.suiteControlPlaneKeys === "object"
    ? config.suiteControlPlaneKeys
    : {};
  const tenantMap = config.suiteControlPlaneTenantMap && typeof config.suiteControlPlaneTenantMap === "object"
    ? config.suiteControlPlaneTenantMap
    : {};
  const timeoutMs = Number(config.suiteControlPlaneTimeoutMs || 8_000);
  const cacheTtlMs = Math.max(0, Number(config.suiteControlPlaneCacheTtlMs || 5_000));

  function binding(identity) {
    const identityTenantId = identityTenant(identity);
    if (!baseUrl) throw new SuiteClientError("suite_control_plane_not_configured", 503, { retryable: true });
    const apiKey = String(keys[identityTenantId] || "").trim();
    if (!apiKey) throw new SuiteClientError("suite_tenant_binding_missing", 403);
    const tenantId = String(tenantMap[identityTenantId] || identityTenantId).trim();
    if (!TENANT_PATTERN.test(tenantId)) throw new SuiteClientError("suite_upstream_tenant_invalid", 500);
    return { identityTenantId, tenantId, apiKey };
  }

  function assertTenant(payload, tenantId) {
    const candidates = tenantCandidates(payload);
    if (candidates.some((candidate) => candidate !== tenantId)) {
      throw new SuiteClientError("suite_upstream_tenant_mismatch", 502);
    }
  }

  async function request(method, route, identity, body, requestOptions = {}) {
    const { identityTenantId, tenantId, apiKey } = binding(identity);
    const url = new URL(route, `${baseUrl}/`);
    const cacheKey = `${identityTenantId}:${tenantId}:${method}:${url.pathname}${url.search}`;
    const cached = method === "GET" ? cache.get(cacheKey) : null;
    if (cached && cached.expiresAt > Date.now()) return clone(cached.payload);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let text;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: "error",
        headers: {
          accept: "application/json",
          "x-sh-suite-key": apiKey,
          "x-sh-tenant-id": tenantId,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      if (error?.name === "AbortError") throw new SuiteClientError("suite_control_plane_timeout", 504, { retryable: true });
      throw new SuiteClientError("suite_control_plane_unreachable", 503, { retryable: true });
    } finally {
      clearTimeout(timer);
    }
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new SuiteClientError("suite_control_plane_response_too_large", 502);
    }
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new SuiteClientError("suite_control_plane_response_invalid", 502, { retryable: true });
    }
    if (!response.ok || payload?.ok === false) {
      throw new SuiteClientError(payload?.error || `suite_control_plane_http_${response.status}`, response.status, {
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    assertTenant(payload, tenantId);
    if (method === "GET" && (requestOptions.cache ?? true) && cacheTtlMs > 0) {
      cache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, payload: clone(payload) });
    }
    return payload;
  }

  async function requestFirst(routes, identity) {
    let lastError;
    for (const route of routes) {
      try {
        return await request("GET", route, identity);
      } catch (error) {
        lastError = error;
        if (!(error instanceof SuiteClientError) || error.status !== 404) throw error;
      }
    }
    throw lastError || new SuiteClientError("suite_control_plane_route_unavailable", 404);
  }

  return {
    status: () => ({
      configured: Boolean(baseUrl && Object.keys(keys).length),
      tenant_bindings: Object.keys(keys).length,
      cache_ttl_ms: cacheTtlMs,
      timeout_ms: timeoutMs,
      execution_allowed: false,
    }),
    isConfiguredForTenant: (tenantId) => Boolean(baseUrl && keys[String(tenantId || "")]),
    cockpit360: (identity, nodeId = "") => {
      const query = nodeId ? `?node_id=${encodeURIComponent(resourceId(nodeId, "node_id"))}` : "";
      return request("GET", `/api/suite/cockpit-360${query}`, identity);
    },
    branchCatalog: (identity) => requestFirst([
      "/api/suite/branch-map",
      "/api/suite/nyra/branch-map",
    ], identity),
    decisionPreview: (identity, input = {}) => request("POST", "/api/suite/nyra/decision-preview", identity, {
      text: String(input.question || "").slice(0, 1_200),
      ...(input.node_id ? { node_id: resourceId(input.node_id, "node_id") } : {}),
      ...(Array.isArray(input.branch_keys) && input.branch_keys.length ? { branches: input.branch_keys.map(String).slice(0, 14) } : {}),
    }),
    runbookCatalog: (identity) => requestFirst([
      "/api/suite/runbooks/catalog-spec",
      "/api/suite/runbooks",
    ], identity),
    runbookPreview: (identity, input = {}) => request("POST", "/api/suite/runbooks/preview", identity, {
      runbook_id: resourceId(input.runbook_id, "runbook_id"),
      ...(input.node_id ? { node_id: resourceId(input.node_id, "node_id") } : {}),
    }),
  };
}

export const suiteClientInternals = Object.freeze({ identityTenant, resourceId, safeErrorCode, tenantCandidates });
