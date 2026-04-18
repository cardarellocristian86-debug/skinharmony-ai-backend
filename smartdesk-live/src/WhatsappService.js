class WhatsappService {
  constructor(env = process.env) {
    this.accountSid = String(env.TWILIO_ACCOUNT_SID || "").trim();
    this.authToken = String(env.TWILIO_AUTH_TOKEN || "").trim();
    this.from = String(env.TWILIO_WHATSAPP_FROM || "").trim();
  }

  isConfigured() {
    return Boolean(this.accountSid && this.authToken && this.from);
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

  async sendMessage({ to, body }) {
    const normalizedTo = this.normalizePhone(to);
    if (!this.isConfigured()) {
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
    if (!text) {
      return {
        ok: false,
        fallbackRequired: true,
        reason: "empty_message",
        message: "Messaggio vuoto."
      };
    }

    const form = new URLSearchParams();
    form.set("From", this.from);
    form.set("To", normalizedTo);
    form.set("Body", text);

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
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
