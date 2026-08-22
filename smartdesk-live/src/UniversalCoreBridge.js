"use strict";

const crypto = require("node:crypto");

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_PREFLIGHT_TTL_MS = 90_000;

function cleanText(value, fallback = "", max = 240) {
  const text = String(value || fallback || "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBaseUrl(value) {
  return cleanText(value, "", 300).replace(/\/+$/, "");
}

function safeNyraText(value, max = 500) {
  return cleanText(value, "", max)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED_SECRET]")
    .replace(/\b(?:password|secret|token|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\+?\d[\d .()-]{7,}\d/g, "[REDACTED_PHONE]");
}

class UniversalCoreBridge {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || process.env.UNIVERSAL_CORE_URL);
    this.apiKey = cleanText(options.apiKey || process.env.UNIVERSAL_CORE_KEY, "", 260);
    this.tenantId = cleanText(options.tenantId || process.env.UNIVERSAL_CORE_TENANT_ID || "smartdesk", "smartdesk", 120);
    this.brandScope = cleanText(options.brandScope || process.env.UNIVERSAL_CORE_BRAND_SCOPE || "skinharmony", "skinharmony", 120);
    this.timeoutMs = cleanNumber(options.timeoutMs || process.env.UNIVERSAL_CORE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.workPreflightCache = new Map();
    this.preflightTtlMs = cleanNumber(options.preflightTtlMs || process.env.SMARTDESK_WORK_PREFLIGHT_TTL_MS, DEFAULT_PREFLIGHT_TTL_MS);
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  status() {
    return {
      configured: this.isConfigured(),
      providerUrl: this.baseUrl || "",
      tenantId: this.tenantId,
      brandScope: this.brandScope,
      protocol: "universal_core_service_v1",
      mode: "read_only_decision_bridge",
      guardrail: "Core decide priorita e rischio; Smart Desk non esegue azioni automatiche senza conferma operatore."
    };
  }

  async tenantStatus() {
    return this.request("GET", `/v1/tenant/status?tenant_id=${encodeURIComponent(this.tenantId)}`);
  }

  async ecosystemPulse() {
    return this.request("GET", `/v1/ecosystem-pulse?tenant_id=${encodeURIComponent(this.tenantId)}`);
  }

  async customerIntelligenceContract() {
    return this.request("GET", `/v1/customer-intelligence/contract?tenant_id=${encodeURIComponent(this.tenantId)}`);
  }

  async customerIntelligenceReadiness(payload = {}) {
    return this.governedRequest("POST", "/v1/customer-intelligence/readiness", {
      tenant_id: this.tenantId,
      brand_scope: this.brandScope,
      events: Array.isArray(payload.events) ? payload.events : [],
      consents: Array.isArray(payload.consents) ? payload.consents : [],
      customer_profile: payload.customer_profile || payload.customerProfile || {},
    }, payload);
  }

  async decision(payload = {}) {
    return this.governedRequest("POST", "/v1/decision", {
      tenant_id: this.tenantId,
      brand_scope: this.brandScope,
      domain: cleanText(payload.domain, "smartdesk", 80),
      signals: Array.isArray(payload.signals) ? payload.signals : [],
      data_quality: payload.data_quality || payload.dataQuality || { score: 70 },
      metadata: {
        source: "smartdesk_live",
        ...(payload.metadata || {})
      },
      constraints: {
        allow_automation: false,
        require_confirmation: true,
        safety_mode: true,
        ...(payload.constraints || {})
      },
    }, payload);
  }

  async semanticSelection(payload = {}) {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    return this.governedRequest("POST", "/v1/semantic-selection", {
      tenant_id: this.tenantId,
      brand_scope: this.brandScope,
      adapter: cleanText(payload.adapter, "smart_desk", 80),
      target_language: cleanText(payload.target_language || payload.targetLanguage, "it", 12),
      candidates,
      context: {
        source: "smartdesk_live",
        product: "smartdesk",
        ...(payload.context || {})
      },
    }, payload);
  }

  async branchAnalyze(branch, payload = {}) {
    const { work_preflight: _ignoredPreflight, _preflight_scope: _ignoredScope, ...safePayload } = payload;
    return this.governedRequest("POST", `/v1/branches/${encodeURIComponent(branch)}/analyze`, {
      tenant_id: this.tenantId,
      brand_scope: this.brandScope,
      data: payload.data || safePayload,
      metadata: {
        source: "smartdesk_live",
        ...(payload.metadata || {})
      },
    }, payload);
  }

  async nyraInterpret(payload = {}) {
    const text = safeNyraText(payload.message || payload.question || payload.text, 500);
    if (!text) {
      return { success: false, code: "nyra_bridge_message_required", message: "Serve una richiesta Smart Desk sintetica." };
    }
    return this.governedRequest("POST", "/v1/nira/core-bridge", {
      text,
      request: text,
      target_system: "smartdesk",
      available_capabilities: ["smartdesk_ui"],
      // The Core derives the tenant and domain pack from the authenticated key.
      // No customer record, raw prompt, domain-pack override, or execution flag crosses the bridge.
      metadata: {
        source: "smartdesk_ui_bridge",
        contract: "smartdesk_nyra_core_bridge_v1",
        mode: cleanText(payload.mode, "gold", 16),
        center_scope: cleanText(payload.centerScope, "", 120),
      },
    }, payload);
  }

  async governedRequest(method, path, body, payload = {}) {
    const scope = payload._preflight_scope;
    const workPreflight = await this.establishWorkPreflight({ method, path, body, scope });
    if (!workPreflight) {
      return {
        success: false,
        code: "work_preflight_required",
        execution_allowed: false,
        message: "Smart Desk deve passare da Nyra/Core e dalla Tenant Work Gallery prima della richiesta."
      };
    }
    return this.request(method, path, { ...body, work_preflight: workPreflight });
  }

  async establishWorkPreflight({ method, path, body, scope } = {}) {
    const scopeKey = this.preflightScopeKey(scope);
    if (!scopeKey) return null;
    const requestSummary = safeNyraText(
      body?.request || body?.text || body?.domain || `${method || "POST"} ${path || "/"}`,
      500
    );
    const response = await this.request("POST", "/v1/work/preflight", {
      request: requestSummary || "Smart Desk governed advisory request",
      target_system: "smartdesk",
      operation_type: "read_only_advisory",
      tool_name: "smartdesk_bridge",
      available_capabilities: ["smartdesk_ui"],
      metadata: {
        center_scope: cleanText(scope?.center_id, "", 120),
        user_scope: cleanText(scope?.user_id, "", 120),
        work_id: cleanText(scope?.work_id, "", 160) || null
      }
    });
    const preflight = response?.work_preflight || null;
    if (!this.rememberWorkPreflight(preflight, scope)) return null;
    return this.getWorkPreflight(scope, { consume: true });
  }

  preflightScopeKey(scope) {
    const values = scope && typeof scope === "object"
      ? [scope.center_id, scope.user_id, scope.session_id, scope.work_id].map((item) => cleanText(item, "", 160))
      : [cleanText(scope, "", 500)];
    if (!values.some(Boolean)) return "";
    return `${this.tenantId}:${crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex")}`;
  }

  rememberWorkPreflight(preflight, scope) {
    const scopeKey = this.preflightScopeKey(scope);
    const security = preflight?.security_governance;
    const gallery = preflight?.tenant_work_gallery;
    if (
      !scopeKey
      || !preflight
      || typeof preflight !== "object"
      || preflight.schema_version !== "skinharmony_work_preflight_v1"
      || preflight.mandatory !== true
      || cleanText(preflight.tenant_id, "", 120) !== this.tenantId
      || preflight.operational_surface !== "tenant_work_gallery"
      || gallery?.tenant_id !== this.tenantId
      || gallery?.available !== true
      || preflight.memory_first?.status !== "recalled"
      || security?.schema_version !== "nyra_core_security_gate_v1"
      || security?.always_on !== true
      || security?.fail_closed !== true
      || security?.core_verdict_required !== true
    ) return false;
    const now = Date.now();
    for (const [key, entry] of this.workPreflightCache.entries()) {
      if (!entry || now >= entry.expiresAt) this.workPreflightCache.delete(key);
    }
    while (this.workPreflightCache.size >= 256) {
      this.workPreflightCache.delete(this.workPreflightCache.keys().next().value);
    }
    this.workPreflightCache.set(scopeKey, {
      preflight,
      expiresAt: now + Math.max(1_000, this.preflightTtlMs),
      consumed: false
    });
    return true;
  }

  getWorkPreflight(scope, options = {}) {
    const scopeKey = this.preflightScopeKey(scope);
    if (!scopeKey) return null;
    const entry = this.workPreflightCache.get(scopeKey);
    if (!entry || entry.consumed || Date.now() >= entry.expiresAt) {
      this.workPreflightCache.delete(scopeKey);
      return null;
    }
    if (options.consume === true) {
      entry.consumed = true;
      this.workPreflightCache.delete(scopeKey);
    }
    return entry.preflight;
  }

  async request(method, path, body) {
    if (!this.isConfigured()) {
      return {
        success: false,
        code: "universal_core_not_configured",
        message: "Universal Core non configurato su Smart Desk."
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-SH-Tenant-ID": this.tenantId
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch (_error) {
        json = { raw: text };
      }
      return {
        success: response.ok && json.ok !== false,
        httpStatus: response.status,
        providerUrl: this.baseUrl,
        ...json
      };
    } catch (error) {
      return {
        success: false,
        code: error?.name === "AbortError" ? "universal_core_timeout" : "universal_core_unreachable",
        providerUrl: this.baseUrl,
        message: error instanceof Error ? error.message : "Universal Core non raggiungibile."
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { UniversalCoreBridge };
