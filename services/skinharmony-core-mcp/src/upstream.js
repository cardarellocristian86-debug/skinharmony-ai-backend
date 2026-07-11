const DEFAULT_TIMEOUT_MS = 12_000;

export class UpstreamError extends Error {
  constructor(message, { status = 502, code = "upstream_error", detail = null } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function trimBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

export function sanitizeForModel(value, options = {}, depth = 0) {
  const maxDepth = options.maxDepth ?? 6;
  const maxArray = options.maxArray ?? 50;
  const maxString = options.maxString ?? 2_000;
  if (depth > maxDepth) return "[depth-truncated]";
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, maxString);
  if (Array.isArray(value)) return value.slice(0, maxArray).map((item) => sanitizeForModel(item, options, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, maxString);

  const blocked = /(?:secret|password|authorization|api[_-]?key|token|cookie|email|phone|image|raw|body)/i;
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (blocked.test(key)) continue;
    output[key] = sanitizeForModel(item, options, depth + 1);
  }
  return output;
}

async function requestJson(url, { method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new UpstreamError(`Upstream unavailable: ${error.message}`, { code: "upstream_unavailable" });
  }

  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new UpstreamError("Upstream returned invalid JSON", { status: response.status, code: "upstream_invalid_json" });
  }
  if (!response.ok) {
    throw new UpstreamError(`Upstream rejected request (${response.status})`, {
      status: response.status,
      code: String(json.error || "upstream_rejected"),
      detail: sanitizeForModel(json),
    });
  }
  return json;
}

function coreHeaders(key, tenantId) {
  if (!key) throw new UpstreamError("CORE_MCP_KEY is not configured", { status: 503, code: "core_key_missing" });
  return {
    authorization: `Bearer ${key}`,
    "x-sh-tenant-id": tenantId,
  };
}

export function normalizeCoreGateResponse(json = {}) {
  const policyEngine = json.result?.policy_engine || json.policy_engine || {};
  const mediation = String(policyEngine.action_mediation?.state || "defer");
  const riskBand = String(policyEngine.risk?.band || "unknown");
  const riskScore = Number.isFinite(Number(policyEngine.risk?.score)) ? Number(policyEngine.risk.score) : null;
  const blocked = mediation === "block" || policyEngine.action_mediation?.blocked === true;
  const ownerConfirmationRequired =
    mediation === "confirm" ||
    mediation === "rollback_required" ||
    policyEngine.action_mediation?.owner_confirmation_required === true;
  const executionAllowed = ["allow", "rewrite"].includes(mediation) && !blocked;
  const verdict = blocked
    ? "BLOCK"
    : ownerConfirmationRequired
      ? "CONFIRM"
      : mediation === "sandbox"
        ? "SANDBOX"
        : mediation === "defer"
          ? "DEFER"
          : executionAllowed
            ? "ALLOW"
            : "DEFER";

  return {
    verdict,
    mediation,
    execution_allowed: executionAllowed,
    owner_confirmation_required: ownerConfirmationRequired,
    risk_band: riskBand,
    risk_score: riskScore,
    reasons: Array.isArray(policyEngine.risk?.reasons) ? policyEngine.risk.reasons.map(String).slice(0, 30) : [],
    next_step: String(policyEngine.action_mediation?.next_step || "review_core_verdict"),
    tenant_id: String(policyEngine.tenant_id || ""),
    schema_version: String(policyEngine.schema_version || "policy_engine_v1"),
  };
}

export function createCoreClient(options = {}) {
  const baseUrl = trimBaseUrl(options.baseUrl || process.env.CORE_BASE_URL || "https://skinharmony-universal-core.onrender.com");
  const key = String(options.key || process.env.CORE_MCP_KEY || "").trim();
  const timeoutMs = Number(options.timeoutMs || process.env.CORE_MCP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return {
    async health() {
      return sanitizeForModel(await requestJson(`${baseUrl}/healthz`, { timeoutMs }));
    },
    async gateAction(input) {
      const tenantId = String(input.tenant_id || process.env.CORE_MCP_TENANT_ID || "codexai");
      const riskHint = clamp(input.risk_hint ?? 35, 0, 100);
      const body = {
        tenant_id: tenantId,
        action: {
          action_type: String(input.action_type || "workflow_decision"),
          action_label: String(input.action_label || input.action_type || "Codex action").slice(0, 240),
          risk_hint: riskHint,
          contains_pii: input.contains_pii === true,
          cross_tenant: input.cross_tenant === true,
          rollback_ready: input.rollback_ready === true,
          sandbox: input.sandbox === true,
        },
        policy: {
          mode: "hard-gating",
          required_branches: Array.isArray(input.required_branches) ? input.required_branches.slice(0, 30) : [],
          approval_required: riskHint >= 70,
        },
        context: {
          owner_confirmed: false,
          contains_pii: input.contains_pii === true,
          cross_tenant: input.cross_tenant === true,
          rollback_ready: input.rollback_ready === true,
          sandbox: input.sandbox === true,
          audit_ready: true,
          source: "skinharmony_core_mcp",
        },
      };
      const json = await requestJson(`${baseUrl}/v1/policy/check`, {
        method: "POST",
        headers: coreHeaders(key, tenantId),
        body,
        timeoutMs,
      });
      return normalizeCoreGateResponse(json);
    },
  };
}

function nyraHeaders(options) {
  const apiKey = String(options.apiKey || process.env.NYRA_MCP_API_KEY || "").trim();
  if (apiKey) return { authorization: `Bearer ${apiKey}` };
  const user = String(options.basicUser || process.env.NYRA_MCP_BASIC_USER || "").trim();
  const password = String(options.basicPassword || process.env.NYRA_MCP_BASIC_PASSWORD || "").trim();
  if (user && password) return { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
  throw new UpstreamError("Nyra MCP credentials are not configured", { status: 503, code: "nyra_credentials_missing" });
}

export function createNyraClient(options = {}) {
  const baseUrl = trimBaseUrl(options.baseUrl || process.env.NYRA_BASE_URL || "https://skinharmony-nyra-core.onrender.com");
  const timeoutMs = Number(options.timeoutMs || process.env.NYRA_MCP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return {
    async readiness() {
      return sanitizeForModel(await requestJson(`${baseUrl}/api/nyra/runtime/readiness`, {
        headers: nyraHeaders(options),
        timeoutMs,
      }));
    },
    async controlSnapshot() {
      return sanitizeForModel(await requestJson(`${baseUrl}/api/nyra/control`, {
        headers: nyraHeaders(options),
        timeoutMs,
      }), { maxDepth: 5, maxArray: 30, maxString: 1_200 });
    },
    async interpret(message, sessionId) {
      return sanitizeForModel(await requestJson(`${baseUrl}/api/nyra/text-chat`, {
        method: "POST",
        headers: nyraHeaders(options),
        body: { message: String(message).slice(0, 8_000), sessionId: String(sessionId || "mcp-session").slice(0, 160) },
        timeoutMs,
      }), { maxDepth: 6, maxArray: 40, maxString: 2_000 });
    },
  };
}
