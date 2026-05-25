class WhatsappService {
  constructor(env = process.env) {
    this.accountSid = String(env.TWILIO_ACCOUNT_SID || "").trim();
    this.authToken = String(env.TWILIO_AUTH_TOKEN || "").trim();
    this.from = String(env.TWILIO_WHATSAPP_FROM || "").trim();
    this.templateSids = {
      recupero_soft: String(env.TWILIO_WHATSAPP_TEMPLATE_RECUPERO_SOFT || "").trim(),
      recupero_attivo: String(env.TWILIO_WHATSAPP_TEMPLATE_RECUPERO_ATTIVO || "").trim(),
      mantenimento: String(env.TWILIO_WHATSAPP_TEMPLATE_MANTENIMENTO || "").trim(),
      riattivazione_cliente_perso: String(env.TWILIO_WHATSAPP_TEMPLATE_RIATTIVAZIONE || "").trim(),
      reminder_appuntamento: String(env.TWILIO_WHATSAPP_TEMPLATE_REMINDER || "").trim()
    };
  }

  isConfigured() {
    return Boolean(this.accountSid && this.authToken && this.from);
  }

  resolveConfig(overrides = {}) {
    return {
      accountSid: String(overrides.accountSid || this.accountSid || "").trim(),
      authToken: String(overrides.authToken || this.authToken || "").trim(),
      from: String(overrides.from || this.from || "").trim()
    };
  }

  isConfiguredWith(overrides = {}) {
    const config = this.resolveConfig(overrides);
    return Boolean(config.accountSid && config.authToken && config.from);
  }

  normalizePhone(phone = "") {
    const cleaned = String(phone || "").replace(/[^\d+]/g, "");
    if (!cleaned) return "";
    if (cleaned.startsWith("+")) return `whatsapp:${cleaned}`;
    if (cleaned.startsWith("00")) return `whatsapp:+${cleaned.slice(2)}`;
    if (cleaned.length >= 9 && cleaned.length <= 11) return `whatsapp:+39${cleaned}`;
    return "";
  }

  plainPhone(phone = "") {
    return String(phone || "").replace(/^whatsapp:/, "").replace(/[^\d+]/g, "");
  }

  mapStatus(status = "") {
    const value = String(status || "").toLowerCase();
    if (["sent", "queued", "accepted", "sending"].includes(value)) return "sent";
    if (value === "delivered") return "delivered";
    if (value === "read") return "read";
    if (["failed", "undelivered"].includes(value)) return "failed";
    if (value === "received") return "replied";
    return value || "unknown";
  }

  getTemplateSid(templateKey = "") {
    return this.templateSids[String(templateKey || "")] || "";
  }

  async testCredentials(overrides = {}) {
    const config = this.resolveConfig(overrides);
    if (!config.accountSid || !config.authToken || !config.from) {
      return {
        ok: false,
        reason: "missing_credentials",
        message: "Account SID, Auth Token e mittente WhatsApp sono obbligatori."
      };
    }
    if (!/^AC[a-zA-Z0-9]{32}$/.test(config.accountSid)) {
      return {
        ok: false,
        reason: "invalid_account_sid",
        message: "Account SID Twilio non valido."
      };
    }
    if (!String(config.from || "").startsWith("whatsapp:")) {
      return {
        ok: false,
        reason: "invalid_sender",
        message: "Il mittente deve essere nel formato whatsapp:+393..."
      };
    }
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}.json`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        reason: payload.code ? `twilio_${payload.code}` : "twilio_auth_failed",
        message: payload.message || "Twilio non ha accettato le credenziali.",
        raw: payload
      };
    }
    return {
      ok: true,
      status: String(payload.status || "active"),
      message: "Credenziali Twilio valide. Verifica anche che il mittente sia un WhatsApp Sender approvato.",
      raw: {
        sid: payload.sid || "",
        status: payload.status || "",
        type: payload.type || ""
      }
    };
  }

  async sendMessage({ to, body, templateKey = "", contentVariables = {}, credentials = null }) {
    const config = this.resolveConfig(credentials || {});
    const normalizedTo = this.normalizePhone(to);
    if (!this.isConfiguredWith(config)) {
      return {
        ok: false,
        fallbackRequired: true,
        reason: "twilio_not_configured",
        message: "Twilio WhatsApp non configurato."
      };
    }
    if (!normalizedTo) {
      return {
        ok: false,
        fallbackRequired: true,
        reason: "invalid_phone",
        message: "Numero WhatsApp non valido."
      };
    }
    const text = String(body || "").trim();
    const contentSid = this.getTemplateSid(templateKey);
    if (!text && !contentSid) {
      return {
        ok: false,
        fallbackRequired: true,
        reason: "empty_message",
        message: "Messaggio vuoto."
      };
    }

    const form = new URLSearchParams();
    form.set("From", config.from);
    form.set("To", normalizedTo);
    if (contentSid) {
      form.set("ContentSid", contentSid);
      form.set("ContentVariables", JSON.stringify(contentVariables || {}));
    } else {
      form.set("Body", text);
    }

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        fallbackRequired: true,
        reason: payload.code ? `twilio_${payload.code}` : "twilio_error",
        message: payload.message || "Invio WhatsApp non riuscito.",
        raw: payload
      };
    }
    return {
      ok: true,
      messageId: payload.sid || "",
      status: this.mapStatus(payload.status || "sent"),
      raw: payload
    };
  }
}

module.exports = { WhatsappService };
