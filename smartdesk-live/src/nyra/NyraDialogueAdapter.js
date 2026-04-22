"use strict";

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function determineTone(z) {
  const urgency = Number(z?.urgency || 0);
  const confidence = Number(z?.confidence || 0);
  const fragile = (z?.risks || []).some((item) => /fragile|sotto soglia|dato|verificare|sporchi/i.test(String(item || "")));
  if (urgency >= 0.75 && confidence >= 0.70) return "direct";
  if ((urgency >= 0.45 && urgency < 0.75) || (confidence >= 0.45 && confidence < 0.70)) return "consultative";
  if (fragile || urgency < 0.45) return "soft";
  return "consultative";
}

function isBriefQuestion(message = "", intent = "") {
  const normalized = normalizeText(message);
  if (intent === "ask_general_explanation") return false;
  return normalized.split(/\s+/).filter(Boolean).length <= 8 && !/(spiega|perche|riassumi|andamento|confronta)/.test(normalized);
}

function buildReply(z, opts = {}) {
  const tone = determineTone(z);
  const brief = isBriefQuestion(opts.message || "", z.intent);
  const primary = String(z.primarySignal || "Nessun segnale principale");
  const action = String(z.primaryAction || "monitorare");
  const next = String(z.recommendedNextStep || action);
  const reason = Array.isArray(z.reasons) && z.reasons[0] ? String(z.reasons[0]) : "";

  if (brief) {
    if (tone === "direct") {
      return `${primary}. Farei questo: ${action}.`;
    }
    if (tone === "consultative") {
      return `${primary}. La mossa giusta è ${action}.`;
    }
    return `${primary}. Prima ${next}.`;
  }

  if (tone === "direct") {
    return `${primary}. La priorità è ${action}. ${reason || "Il segnale è abbastanza forte da muoversi ora."}`;
  }
  if (tone === "consultative") {
    return `${primary}. Ti suggerisco ${action}. ${reason || "Il contesto è abbastanza leggibile per una scelta operativa."}`;
  }
  return `${primary}. Resterei prudente: ${next}. ${reason || "Il quadro è utile ma va letto con cautela."}`;
}

function coherenceCheck(z, r) {
  const allowedActions = new Set([String(z.primaryAction || ""), String(z.recommendedNextStep || "")].filter(Boolean));
  const suggestedActions = Array.isArray(r.suggestedActions) ? r.suggestedActions : [];
  const noInventedAction = suggestedActions.every((item) => allowedActions.has(String(item || "")));
  const primaryActionCoherent = suggestedActions.length ? String(suggestedActions[0] || "") === String(z.primaryAction || "") : true;
  const actionBandCoherent = z.actionBand !== "ACT_NOW" || r.tone !== "soft";
  const criticalRisks = (Array.isArray(z.risks) ? z.risks : []).filter((item) => /alto|critico|sotto soglia|sporchi|verificare/i.test(String(item || "")));
  const noCriticalRiskOmitted = criticalRisks.length === 0 || criticalRisks.every((item) => (r.warnings || []).includes(item));
  return {
    ok: Boolean(noInventedAction && primaryActionCoherent && actionBandCoherent && noCriticalRiskOmitted),
    checks: {
      noInventedAction,
      primaryActionCoherent,
      actionBandCoherent,
      noCriticalRiskOmitted
    }
  };
}

class NyraDialogueAdapter {
  render(coreliaOutput, opts = {}) {
    const tone = determineTone(coreliaOutput);
    const warnings = (Array.isArray(coreliaOutput.risks) ? coreliaOutput.risks : []).slice(0, 2);
    const response = {
      identity: "nyra",
      reply: buildReply(coreliaOutput, opts),
      tone,
      compactSummary: String(coreliaOutput.humanSummary || ""),
      suggestedActions: [coreliaOutput.primaryAction, coreliaOutput.recommendedNextStep]
        .filter(Boolean)
        .filter((item, index, array) => array.indexOf(item) === index),
      warnings
    };
    const coherence = coherenceCheck(coreliaOutput, response);
    if (!coherence.ok) {
      return {
        identity: "nyra",
        reply: String(coreliaOutput.humanSummary || coreliaOutput.primarySignal || "Situazione da monitorare."),
        tone: tone === "direct" ? "consultative" : tone,
        compactSummary: String(coreliaOutput.humanSummary || ""),
        suggestedActions: [coreliaOutput.primaryAction].filter(Boolean),
        warnings,
        coherence
      };
    }
    return { ...response, coherence };
  }
}

module.exports = {
  NyraDialogueAdapter,
  determineTone,
  coherenceCheck
};
