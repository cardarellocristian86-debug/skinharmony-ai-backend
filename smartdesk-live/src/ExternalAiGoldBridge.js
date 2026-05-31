"use strict";

const DEFAULT_NYRA_URL = "https://skinharmony-nyra-core.onrender.com";
const DEFAULT_TIMEOUT_MS = 12000;

function cleanText(value, fallback = "", max = 2000) {
  const text = String(value || fallback || "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBaseUrl(value) {
  return cleanText(value, "", 400).replace(/\/+$/, "");
}

function compactJson(value, max = 9000) {
  try {
    const text = JSON.stringify(value || {});
    return text.length > max ? `${text.slice(0, max)}...` : text;
  } catch {
    return "{}";
  }
}

function firstAction(context = {}) {
  const decisionContext = context.goldDecisionContext || context.decisionContext || {};
  const primary = decisionContext.primaryAction || {};
  return cleanText(primary.suggestedAction || primary.label || primary.explanationShort || "leggi il centro e indica la prima azione manuale", "leggi il centro e indica la prima azione manuale", 260);
}

function normalizeCoreOutput(core = {}) {
  const output = core?.output || core?.decision_contract || core?.decision || core || {};
  const risk = output.risk || core.risk || {};
  const confidence = cleanNumber(output.confidence ?? output.globalConfidence ?? core.confidence ?? 0, 0);
  const action = output.primaryAction || output.recommended_action || output.recommendedAction || output.action || null;
  return {
    ok: Boolean(core.success || core.ok),
    output,
    confidence,
    risk,
    action,
    controlLevel: output.control_level || output.controlLevel || output.control || "",
    decision: output.decision || output.verdict || output.actionBand || ""
  };
}

function buildSignals(context = {}, question = "") {
  const snapshot = context.businessSnapshot || {};
  const decisionContext = context.goldDecisionContext || context.decisionContext || {};
  const dataQuality = snapshot.dataQuality || decisionContext.dataQuality || {};
  const dashboard = context.dashboard || snapshot.dashboard || {};
  const primary = decisionContext.primaryAction || {};
  const topSignals = Array.isArray(decisionContext.topSignals) ? decisionContext.topSignals : [];
  return [
    { id: "question", value: cleanText(question || "lettura Smart Desk", "lettura Smart Desk", 220), weight: 0.7 },
    { id: "primary_action", value: cleanText(primary.label || primary.suggestedAction || primary.explanationShort || "", "", 260), weight: 0.95 },
    { id: "data_quality", value: cleanNumber(dataQuality.score || dataQuality.qualityScore || 0), weight: 0.75 },
    { id: "today_appointments", value: cleanNumber(dashboard.todayAppointments || snapshot.core?.appointments || 0), weight: 0.55 },
    ...topSignals.slice(0, 6).map((item, index) => ({
      id: `signal_${index + 1}`,
      value: cleanText(item.label || item.suggestedAction || item.explanationShort || item.output || item.domain || "", "", 260),
      weight: 0.5
    }))
  ].filter((item) => String(item.value ?? "").trim() !== "");
}

class ExternalAiGoldBridge {
  constructor(options = {}) {
    this.universalCoreBridge = options.universalCoreBridge || null;
    this.nyraBaseUrl = normalizeBaseUrl(options.nyraBaseUrl || process.env.NYRA_CORE_URL || process.env.NYRA_RENDER_URL || DEFAULT_NYRA_URL);
    this.timeoutMs = cleanNumber(options.timeoutMs || process.env.NYRA_CORE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  }

  isNyraConfigured() {
    return Boolean(this.nyraBaseUrl);
  }

  status() {
    return {
      mode: "external_ai_gold_v1",
      smartDeskRole: "data_source_only",
      core: this.universalCoreBridge?.status?.() || { configured: false },
      nyra: {
        configured: this.isNyraConfigured(),
        providerUrl: this.nyraBaseUrl,
        endpoint: "/api/nyra/text-chat"
      },
      rule: "Smart Desk legge i dati; Core decide; Nyra spiega; OpenAI rifinisce; operatore conferma."
    };
  }

  buildNyraPrompt({ mode = "gold", question = "", context = {}, core = null } = {}) {
    const action = firstAction(context);
    const payload = {
      mode,
      question,
      rule: "Il gestionale dice cosa sta succedendo. AI Gold dice cosa fare. Non inventare numeri: usa solo il contesto.",
      expected_output: [
        "stato del centro in una frase",
        "prima priorita manuale",
        "perche conta",
        "dati mancanti o anomali",
        "azione da confermare dall'operatore"
      ],
      first_action_from_smartdesk_data: action,
      core,
      context
    };
    return `AI Gold Smart Desk. Leggi questo contesto e parla da responsabile operativo digitale, non da chatbot. Rispondi in italiano premium, concreto, con priorita manuali confermabili.\n${compactJson(payload)}`;
  }

  async callNyraTextChat({ text, sessionId }) {
    if (!this.isNyraConfigured()) {
      return { success: false, code: "nyra_render_not_configured", message: "Nyra server non configurata." };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.nyraBaseUrl}/api/nyra/text-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sessionId: sessionId || "smartdesk-ai-gold" }),
        signal: controller.signal
      });
      const json = await response.json().catch(() => ({}));
      return {
        success: response.ok && json.ok !== false,
        httpStatus: response.status,
        providerUrl: this.nyraBaseUrl,
        ...json
      };
    } catch (error) {
      return {
        success: false,
        code: error?.name === "AbortError" ? "nyra_render_timeout" : "nyra_render_unreachable",
        providerUrl: this.nyraBaseUrl,
        message: error instanceof Error ? error.message : "Nyra server non raggiungibile."
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async buildReadout({ mode = "gold", question = "", context = {}, session = null } = {}) {
    const centerId = cleanText(session?.centerId || session?.supportTargetUsername || session?.username || "smartdesk", "smartdesk", 120);
    const corePayload = {
      domain: mode === "silver" ? "smartdesk_silver_readonly" : "smartdesk_ai_gold",
      signals: buildSignals(context, question),
      data_quality: context.businessSnapshot?.dataQuality || context.goldDecisionContext?.dataQuality || { score: 70 },
      metadata: {
        surface: mode === "silver" ? "silver_readonly" : "ai_gold",
        source_layer: "smartdesk_data_source",
        center_id: centerId,
        mode,
        question: cleanText(question, "", 500)
      },
      constraints: {
        allow_automation: false,
        require_confirmation: mode !== "silver",
        safety_mode: true,
        operator_must_confirm: true
      }
    };
    const core = this.universalCoreBridge?.isConfigured?.()
      ? await this.universalCoreBridge.decision(corePayload)
      : { success: false, code: "universal_core_not_configured", message: "Universal Core server non configurato." };
    const normalizedCore = normalizeCoreOutput(core);
    const nyraPrompt = this.buildNyraPrompt({ mode, question, context, core: normalizedCore.output });
    const nyra = await this.callNyraTextChat({
      text: nyraPrompt,
      sessionId: `smartdesk-${mode}-${centerId}`
    });
    const nyraResult = nyra.result || {};
    const content = cleanText(nyraResult.content || nyraResult.reply || "", "", 4000);
    return {
      success: Boolean(normalizedCore.ok || nyra.success),
      provider: "universal_core_server_nyra_server",
      sourceLayer: "external_core_nyra_render",
      mode,
      answer: content || this.fallbackAnswer({ mode, context, core: normalizedCore, nyra }),
      firstAction: cleanText(normalizedCore.action?.suggestedAction || normalizedCore.action?.label || normalizedCore.action || firstAction(context), firstAction(context), 260),
      core,
      coreOutput: normalizedCore,
      nyra,
      ui: nyraResult.ui || {},
      core2Pipeline: nyraResult.core2Pipeline || null,
      guardrails: {
        smartDeskCalculatesNumbers: true,
        coreDecides: Boolean(normalizedCore.ok),
        nyraExplains: Boolean(nyra.success),
        openAiRefinesOnly: true,
        automaticExecutionAllowed: false,
        operatorConfirmationRequired: mode !== "silver"
      }
    };
  }

  fallbackAnswer({ mode = "gold", context = {}, core = {}, nyra = {} } = {}) {
    const dataQuality = cleanNumber(context.businessSnapshot?.dataQuality?.score || context.goldDecisionContext?.dataQuality?.score || 0);
    const action = firstAction(context);
    const missing = [];
    if (dataQuality && dataQuality < 75) missing.push(`affidabilita dati ${dataQuality}%`);
    if (!core.success) missing.push("Core server non disponibile");
    if (!nyra.success) missing.push("Nyra server non disponibile");
    if (mode === "silver") {
      return `Silver ha letto il centro in modalita controllo. Prima verifica: ${action}. ${missing.length ? `Limiti: ${missing.join(", ")}.` : "Nessuna azione automatica."}`;
    }
    return `AI Gold ha letto il centro. Prima priorita: ${action}. ${missing.length ? `Prima di decidere con forza: ${missing.join(", ")}.` : "Operatore: conferma prima di eseguire."}`;
  }
}

module.exports = { ExternalAiGoldBridge };
