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

function smartDeskBranchPackage(mode = "gold") {
  if (mode === "silver") {
    return ["front_desk_base", "operations_silver", "smartdesk_operations_guard"];
  }
  return [
    "front_desk_base",
    "operations_silver",
    "executive_gold",
    "smartdesk_operations_guard",
    "customer_360_guard",
    "consent_ledger_guard",
    "beauty_protocol_guard"
  ];
}

function inferCenterSector(context = {}) {
  const settings = context.settings || context.payload?.settings || context.businessSnapshot?.settings || {};
  const text = [
    settings.centerType,
    settings.businessType,
    settings.industry,
    settings.centerName,
    context.payload?.centerName,
    context.businessSnapshot?.centerName
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  if (/parruc|hair|salon|piega|colore|taglio/.test(text)) return "parrucchiere";
  if (/barber|barba/.test(text)) return "barber";
  if (/estetic|viso|corpo|laser|epil/.test(text)) return "estetica";
  return "beauty_center";
}

function smartDeskBranchData({ mode = "gold", context = {}, question = "", centerId = "" } = {}) {
  const snapshot = context.businessSnapshot || {};
  const decisionContext = context.goldDecisionContext || context.decisionContext || {};
  const dataQuality = snapshot.dataQuality || decisionContext.dataQuality || {};
  const dashboard = context.dashboard || snapshot.dashboard || {};
  const primary = decisionContext.primaryAction || {};
  const metrics = dataQuality.metrics || {};
  const capabilities = context.goldCapabilities || {};
  return {
    module: primary.domain || primary.target || "center",
    area: primary.domain || "center",
    plan: mode,
    tier: mode,
    sector: inferCenterSector(context),
    center_id: centerId,
    question: cleanText(question, "", 500),
    data_quality_score: cleanNumber(dataQuality.score || dataQuality.qualityScore || 0),
    today_appointments: cleanNumber(dashboard.todayAppointments || snapshot.core?.appointments || 0),
    monthly_revenue_cents: cleanNumber(dashboard.monthlyRevenueCents || snapshot.core?.monthlyRevenueCents || 0),
    inactive_clients_count: cleanNumber(dashboard.inactiveClientsCount || metrics.inactiveClientsCount || 0),
    services_missing_costs: cleanNumber(metrics.servicesMissingCosts || decisionContext.metrics?.servicesMissingCosts || 0),
    clients_missing_contact: cleanNumber(metrics.clientsMissingContact || decisionContext.metrics?.clientsMissingContact || 0),
    unlinked_payments: cleanNumber(metrics.unlinkedPayments || 0),
    primary_action: cleanText(primary.label || primary.suggestedAction || primary.explanationShort || "", "", 300),
    operator_confirmed: false,
    auto_send: false,
    ai_changes_numbers: false,
    correct_real_data: false,
    medical_claim: false,
    whatsapp_enabled: Boolean(capabilities?.limits?.whatsappEnabled),
    marketing_consent: Boolean(context.customerIntelligence?.readiness?.consentReady),
    consent: Boolean(context.customerIntelligence?.readiness?.consentReady),
    customer_state: cleanText(context.customerIntelligence?.state || "", "", 80),
    objective: cleanText(context.payload?.protocolObjective || "", "", 120),
    technologies: Array.isArray(context.payload?.technologies) ? context.payload.technologies : [],
    sources_provided: true
  };
}

function smartDeskAnswerUsable(content = "") {
  const text = String(content || "").toLowerCase();
  if (!text.trim()) return false;
  const requiredDomain = /(smart desk|centro|agenda|cassa|client|serviz|operator|costi|redditiv|margini|appuntament|recall|marketing|protocoll)/.test(text);
  const contaminated = /(economic pressure|diagnosi secca|spese pi[uù] pesanti|offerta vendibile entro 24 ore|manda 10 contatti|tagliare una perdita visibile subito)/.test(text);
  return requiredDomain && !contaminated;
}

function branchNextActions(branchAnalyses = []) {
  return branchAnalyses
    .flatMap((item) => Array.isArray(item.branch_output?.next_actions) ? item.branch_output.next_actions : [])
    .map((item) => cleanText(item, "", 260))
    .filter(Boolean);
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
    this.nyraApiKey = cleanText(options.nyraApiKey || process.env.NYRA_RENDER_KEY || "", "", 2000);
    this.timeoutMs = cleanNumber(options.timeoutMs || process.env.NYRA_CORE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  }

  isNyraConfigured() {
    return Boolean(this.nyraBaseUrl && this.nyraApiKey);
  }

  status() {
    return {
      mode: "external_ai_gold_v1",
      smartDeskRole: "data_source_only",
      core: this.universalCoreBridge?.status?.() || { configured: false },
      nyra: {
        configured: this.isNyraConfigured(),
        authenticationConfigured: Boolean(this.nyraApiKey),
        providerUrl: this.nyraBaseUrl,
        endpoint: "/api/nyra/text-chat"
      },
      rule: "Smart Desk legge i dati; Core decide; Nyra spiega; OpenAI rifinisce; operatore conferma."
    };
  }

  buildNyraPrompt({ mode = "gold", question = "", context = {}, core = null, branchAnalyses = [] } = {}) {
    const action = firstAction(context);
    const branchSummary = branchAnalyses.map((item) => ({
      branch: item.branch,
      ok: Boolean(item.success || item.ok),
      label: item.profile?.label || item.branch,
      rules: Array.isArray(item.profile?.rules) ? item.profile.rules.slice(0, 5) : [],
      output: item.branch_output || {},
      risk: item.output?.risk || null
    }));
    const payload = {
      mode,
      smartdesk_role: mode === "silver"
        ? "Silver legge e organizza, senza priorita executive e senza automazioni."
        : "Gold si comporta come responsabile operativo digitale: decide cosa fare, ma non esegue senza conferma.",
      question,
      strict_boundary: [
        "Rispondi solo come Smart Desk per un centro beauty/parrucchiere/estetica.",
        "Non usare memoria owner, trading, finanza personale, spese personali o consigli generici da business coach.",
        "Devi citare moduli Smart Desk: agenda, clienti, cassa, servizi/operatori, costi, redditivita, marketing o protocolli.",
        "Se mancano dati, trasforma il vuoto in checklist: cosa manca, dove aprire, perche serve, prossima verifica."
      ],
      rule: "Il gestionale dice cosa sta succedendo. AI Gold dice cosa fare. Non inventare numeri: usa solo il contesto.",
      communication_rule: mode === "silver"
        ? "Parla come controllo operativo: dati, anomalie, prima verifica manuale. Non venderti come AI Gold."
        : "Parla come responsabile operativo premium: priorita, motivo economico/operativo, cosa manca, prossima azione confermabile.",
      expected_output: [
        "stato del centro in una frase",
        "prima priorita manuale",
        "perche conta",
        "dati mancanti o anomali",
        "azione da confermare dall'operatore"
      ],
      first_action_from_smartdesk_data: action,
      core,
      core_branch_learning: branchSummary,
      context
    };
    return `AI Gold Smart Desk. Leggi questo contesto e parla SOLO del centro Smart Desk. Non usare memoria owner o consigli generici esterni. Rispondi in italiano premium, concreto, con priorita manuali confermabili.\n${compactJson(payload)}`;
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.nyraApiKey}`
        },
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
    const requestedBranches = smartDeskBranchPackage(mode);
    const branchData = smartDeskBranchData({ mode, context, question, centerId });
    const corePayload = {
      domain: mode === "silver" ? "smartdesk_silver_readonly" : "smartdesk_ai_gold",
      branches: requestedBranches,
      requested_branches: requestedBranches,
      signals: buildSignals(context, question),
      data_quality: context.businessSnapshot?.dataQuality || context.goldDecisionContext?.dataQuality || { score: 70 },
      metadata: {
        surface: mode === "silver" ? "silver_readonly" : "ai_gold",
        source_layer: "smartdesk_data_source",
        center_id: centerId,
        mode,
        sector: branchData.sector,
        requested_branches: requestedBranches,
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
    const branchAnalyses = this.universalCoreBridge?.isConfigured?.()
      ? await Promise.all(requestedBranches.map(async (branch) => {
        try {
          return await this.universalCoreBridge.branchAnalyze(branch, {
            data: { ...branchData, branch },
            metadata: { mode, center_id: centerId, sector: branchData.sector, source: "smartdesk_live_external_ai_gold" }
          });
        } catch (error) {
          return { success: false, branch, code: "branch_analyze_failed", message: error instanceof Error ? error.message : "branch analyze failed" };
        }
      }))
      : [];
    const nyraPrompt = this.buildNyraPrompt({ mode, question, context, core: normalizedCore.output, branchAnalyses });
    const nyra = await this.callNyraTextChat({
      text: nyraPrompt,
      sessionId: `smartdesk-${mode}-${centerId}`
    });
    const nyraResult = nyra.result || {};
    const content = cleanText(nyraResult.content || nyraResult.reply || "", "", 4000);
    const governedFallback = this.fallbackAnswer({ mode, context, core: normalizedCore, nyra, branchAnalyses });
    return {
      success: Boolean(normalizedCore.ok || nyra.success),
      provider: "universal_core_server_nyra_server",
      sourceLayer: "external_core_nyra_render",
      mode,
      answer: smartDeskAnswerUsable(content) ? content : governedFallback,
      nyraAnswerAccepted: smartDeskAnswerUsable(content),
      firstAction: cleanText(normalizedCore.action?.suggestedAction || normalizedCore.action?.label || normalizedCore.action || firstAction(context), firstAction(context), 260),
      core,
      coreOutput: normalizedCore,
      requestedBranches,
      branchAnalyses,
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

  fallbackAnswer({ mode = "gold", context = {}, core = {}, nyra = {}, branchAnalyses = [] } = {}) {
    const dataQuality = cleanNumber(context.businessSnapshot?.dataQuality?.score || context.goldDecisionContext?.dataQuality?.score || 0);
    const action = firstAction(context);
    const branchActions = branchNextActions(branchAnalyses);
    const missing = [];
    if (dataQuality && dataQuality < 75) missing.push(`affidabilita dati ${dataQuality}%`);
    if (!(core.success || core.ok)) missing.push("Core server non disponibile");
    if (!nyra.success) missing.push("Nyra server non disponibile");
    if (mode === "silver") {
      return `Silver ha letto il centro in modalita controllo. Prima verifica manuale: ${branchActions[0] || action}. ${missing.length ? `Limiti: ${missing.join(", ")}.` : "Nessuna azione automatica."}`;
    }
    return [
      `AI Gold ha letto il centro. Prima priorita: ${branchActions[0] || action}.`,
      branchActions[1] ? `Poi controlla: ${branchActions[1]}.` : "",
      missing.length ? `Cosa manca prima di decidere con forza: ${missing.join(", ")}.` : "Operatore: conferma prima di eseguire.",
      "Smart Desk non modifica dati: apri il modulo indicato, completa il dato o conferma l'azione manuale."
    ].filter(Boolean).join(" ");
  }
}

module.exports = { ExternalAiGoldBridge };
