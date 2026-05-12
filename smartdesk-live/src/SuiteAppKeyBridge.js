"use strict";

const DEFAULT_SUITE_BASE_URL = "https://www.skinharmony.it";

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_SUITE_BASE_URL).trim();
  return raw.replace(/\/+$/, "");
}

function cleanText(value, fallback = "", max = 200) {
  const text = String(value || fallback || "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanArray(value, max = 20) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => cleanText(item, "", 120)).filter(Boolean);
}

class SuiteAppKeyBridge {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || process.env.SUITE_APP_KEY_PROVIDER_URL);
    this.defaultAppKey = cleanText(options.appKey || process.env.SUITE_APP_KEY, "", 160);
    this.timeoutMs = cleanNumber(options.timeoutMs || process.env.SUITE_APP_KEY_TIMEOUT_MS, 8000);
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  status() {
    return {
      configured: this.isConfigured(),
      providerUrl: this.baseUrl,
      defaultAppKeyPresent: Boolean(this.defaultAppKey),
      protocol: "suite_app_key_factory_v1",
      mode: "snapshot_governance",
      privacy: "Solo configurazione, licenza e aggregati. Nessun dato cliente nominativo."
    };
  }

  async activate(payload = {}) {
    return this.post("/wp-json/shss/v1/waas-manager/smartdesk-app-key-factory/activate", {
      app_key: this.readAppKey(payload),
      center_id: cleanText(payload.centerId || payload.center_id, "", 120),
      center_name: cleanText(payload.centerName || payload.center_name, "", 160),
      instance_id: cleanText(payload.instanceId || payload.instance_id, "", 160),
      smartdesk_version: cleanText(payload.smartdeskVersion || payload.smartdesk_version, "", 80),
      environment: cleanText(payload.environment || process.env.NODE_ENV || "production", "production", 80)
    });
  }

  async configBundle(payload = {}) {
    return this.post("/wp-json/shss/v1/waas-manager/smartdesk-app-key-factory/config-bundle", {
      app_key: this.readAppKey(payload),
      center_id: cleanText(payload.centerId || payload.center_id, "", 120),
      instance_id: cleanText(payload.instanceId || payload.instance_id, "", 160)
    });
  }

  async pulse(payload = {}) {
    return this.post("/wp-json/shss/v1/waas-manager/smartdesk-app-key-factory/pulse", {
      app_key: this.readAppKey(payload),
      center_id: cleanText(payload.centerId || payload.center_id, "", 120),
      instance_id: cleanText(payload.instanceId || payload.instance_id, "", 160),
      pulse: this.sanitizePulse(payload.pulse || payload)
    });
  }

  sanitizePulse(payload = {}) {
    return {
      appointments_today: cleanNumber(payload.appointments_today || payload.appointmentsToday, 0),
      revenue_today: cleanNumber(payload.revenue_today || payload.revenueToday, 0),
      currency: cleanText(payload.currency, "EUR", 12),
      active_staff: cleanNumber(payload.active_staff || payload.activeStaff, 0),
      stock_alerts: cleanNumber(payload.stock_alerts || payload.stockAlerts, 0),
      risk_signals: cleanArray(payload.risk_signals || payload.riskSignals, 12),
      health_status: cleanText(payload.health_status || payload.healthStatus, "unknown", 40),
      sent_at: cleanText(payload.sent_at || payload.sentAt || new Date().toISOString(), "", 40)
    };
  }

  readAppKey(payload = {}) {
    return cleanText(payload.appKey || payload.app_key || this.defaultAppKey, "", 180);
  }

  async post(path, body) {
    if (!this.isConfigured()) {
      return {
        success: false,
        code: "suite_provider_not_configured",
        message: "Provider Suite non configurato."
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-SkinHarmony-Bridge": "smartdesk-live"
        },
        body: JSON.stringify(body),
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
        success: response.ok && json.success !== false,
        httpStatus: response.status,
        providerUrl: this.baseUrl,
        ...json
      };
    } catch (error) {
      return {
        success: false,
        code: error?.name === "AbortError" ? "suite_provider_timeout" : "suite_provider_unreachable",
        providerUrl: this.baseUrl,
        message: error instanceof Error ? error.message : "Provider Suite non raggiungibile."
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { SuiteAppKeyBridge };
