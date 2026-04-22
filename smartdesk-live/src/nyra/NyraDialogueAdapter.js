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
  const conflict = Number(z?.v7?.conflictIndex || 0);
  if (conflict >= 0.45) return "consultative";
  if (urgency >= 0.75 && confidence >= 0.70) return "direct";
  if ((urgency >= 0.45 && urgency < 0.75) || (confidence >= 0.45 && confidence < 0.70)) return "consultative";
  if (fragile || urgency < 0.45) return "soft";
  return "consultative";
}

function determineReplyMode(z) {
  const intent = String(z?.intent || "");
  if (intent === "ask_general_explanation" || intent === "ask_report_summary") return "explanation";
  if (intent === "ask_data_quality" || intent === "ask_cash_issue" || intent === "ask_profitability") return "diagnosis";
  return "decision";
}

function isBriefQuestion(message = "", intent = "") {
  const normalized = normalizeText(message);
  if (intent === "ask_general_explanation") return false;
  return normalized.split(/\s+/).filter(Boolean).length <= 8 && !/(spiega|perche|riassumi|andamento|confronta)/.test(normalized);
}

function buildReply(z, opts = {}) {
  const tone = determineTone(z);
  const replyMode = determineReplyMode(z);
  const brief = isBriefQuestion(opts.message || "", z.intent);
  const primary = String(z.primarySignal || "Nessun segnale principale");
  const action = String(z.primaryAction || "monitorare");
  const next = String(z.recommendedNextStep || action);
  const reason = Array.isArray(z.reasons) && z.reasons[0] ? String(z.reasons[0]) : "";
  const detail = Array.isArray(z.secondarySignals) && z.secondarySignals[0] ? String(z.secondarySignals[0]) : "";
  const conflict = Number(z?.v7?.conflictIndex || 0);
  const conflictNote = conflict >= 0.45 ? " Il quadro è misto, quindi tengo la risposta stretta sui fatti già confermati." : "";

  if (brief) {
    if (tone === "direct") {
      return `${primary}. Parti da ${action}.${conflictNote}`;
    }
    if (tone === "consultative") {
      return `${primary}. Se fai una sola cosa, parti da ${action}.${conflictNote}`;
    }
    return `${primary}. Prima ${next}.${conflictNote}`;
  }

  if (replyMode === "diagnosis") {
    return `${primary}. Il punto da leggere è ${action}. ${reason || detail || "Questa è la parte che incide davvero sulla decisione."}${conflictNote}`;
  }
  if (replyMode === "explanation") {
    return `${primary}. In sintesi: ${reason || detail || action}. ${next}.${conflictNote}`;
  }
  if (tone === "direct") {
    return `${primary}. Parti da ${action}. ${reason || detail || "Il segnale è abbastanza forte da muoversi ora."}${conflictNote}`;
  }
  if (tone === "consultative") {
    return `${primary}. Ti guiderei da qui: ${action}. ${reason || detail || "Il contesto è abbastanza leggibile per una scelta operativa."}${conflictNote}`;
  }
  return `${primary}. Resterei prudente: ${next}. ${reason || detail || "Il quadro è utile ma va letto con cautela."}${conflictNote}`;
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
    const replyMode = determineReplyMode(coreliaOutput);
    const response = {
      identity: "nyra",
      reply: buildReply(coreliaOutput, opts),
      tone,
      replyMode,
      uiReadingBand: String(coreliaOutput.uiReadingBand || ""),
      uiReadingLabel: String(coreliaOutput.uiReadingLabel || ""),
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
  determineReplyMode,
  coherenceCheck
};
