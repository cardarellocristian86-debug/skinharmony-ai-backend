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

function hashString(value = "") {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function chooseVariant(length, seed = "") {
  if (!length || length <= 1) return 0;
  return hashString(seed) % length;
}

function firstNonEmpty(values = [], fallback = "") {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return fallback;
}

function composeSentence(parts = []) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+\./g, ".")
    .replace(/\s+,/g, ",")
    .trim();
}

function pickActionLead(tone, variant, action, next) {
  const direct = [
    `Parti da ${action}.`,
    `Muoviti su ${action}.`,
    `La mossa adesso e ${action}.`
  ];
  const consultative = [
    `Io partirei da ${action}.`,
    `Se vuoi una mossa pulita, partirei da ${action}.`,
    `Ti porterei su ${action}.`
  ];
  const soft = [
    `Prima ${next}.`,
    `Resterei prudente: ${next}.`,
    `La mossa piu sicura e ${next}.`
  ];
  const bank = tone === "direct" ? direct : tone === "consultative" ? consultative : soft;
  return bank[variant % bank.length];
}

function pickReasonLead(replyMode, variant, reason, detail, fallback) {
  const content = firstNonEmpty([reason, detail], fallback);
  const diagnosis = [
    `Il punto che pesa davvero e questo: ${content}`,
    `${content}`,
    `La chiave da leggere e ${content}`
  ];
  const explanation = [
    `In sintesi: ${content}.`,
    `Il senso operativo e questo: ${content}.`,
    `La lettura corta e ${content}.`
  ];
  const decision = [
    `${content}.`,
    `Motivo: ${content}.`,
    `${content}.`
  ];
  const bank = replyMode === "diagnosis" ? diagnosis : replyMode === "explanation" ? explanation : decision;
  return bank[variant % bank.length];
}

function nyraGenerateReply(z, opts = {}) {
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
  const variabilitySeed = [
    z.intent,
    primary,
    action,
    next,
    tone,
    replyMode,
    opts.variationIndex ?? ""
  ].join("|");
  const variant = chooseVariant(3, variabilitySeed);
  const fallbackReason = replyMode === "diagnosis"
    ? "Questa è la parte che incide davvero sulla decisione."
    : replyMode === "explanation"
      ? action
      : tone === "soft"
        ? "Il quadro è utile ma va letto con cautela."
        : "Il contesto è abbastanza leggibile per una scelta operativa.";

  if (brief) {
    const briefAction = pickActionLead(tone, variant, action, next);
    return composeSentence([
      `${primary}.`,
      briefAction
    ]) + conflictNote;
  }

  const actionLead = pickActionLead(tone, variant, action, next);
  const reasonLead = pickReasonLead(replyMode, variant, reason, detail, fallbackReason);
  const orderVariants = [
    [`${primary}.`, actionLead, reasonLead],
    [`${primary}.`, reasonLead, actionLead],
    [actionLead, `${primary}.`, reasonLead]
  ];
  const ordered = orderVariants[variant % orderVariants.length];

  if (replyMode === "diagnosis") {
    return composeSentence(ordered) + conflictNote;
  }
  if (replyMode === "explanation") {
    return composeSentence([
      `${primary}.`,
      reasonLead,
      variant === 2 ? `Poi ${next}.` : `${next}.`
    ]) + conflictNote;
  }

  return composeSentence(ordered) + conflictNote;
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

function selectWarnings(coreliaOutput = {}) {
  const risks = Array.isArray(coreliaOutput.risks) ? coreliaOutput.risks.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (!risks.length) return [];
  const critical = risks.filter((item) => /alto|critico|sotto soglia|sporchi|verificare/i.test(item));
  const preferred = critical.length ? critical : risks;
  return preferred.slice(0, 3);
}

class NyraDialogueAdapter {
  render(coreliaOutput, opts = {}) {
    const tone = determineTone(coreliaOutput);
    const warnings = selectWarnings(coreliaOutput);
    const replyMode = determineReplyMode(coreliaOutput);
    const response = {
      identity: "nyra",
      reply: nyraGenerateReply(coreliaOutput, opts),
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
  coherenceCheck,
  nyraGenerateReply
};
