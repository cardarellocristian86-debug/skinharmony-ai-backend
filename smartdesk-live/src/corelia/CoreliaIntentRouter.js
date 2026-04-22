"use strict";

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function clamp01(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function uniqueMatches(message, patterns = []) {
  const normalized = normalizeText(message);
  return patterns.reduce((sum, pattern) => {
    if (!pattern) return sum;
    if (pattern instanceof RegExp) {
      return sum + (pattern.test(normalized) ? 1 : 0);
    }
    const token = normalizeText(pattern);
    return sum + (token && normalized.includes(token) ? 1 : 0);
  }, 0);
}

function startsWithStrongVerb(message, verbs = []) {
  const normalized = normalizeText(message);
  return verbs.some((verb) => normalized.startsWith(`${normalizeText(verb)} `)) ? 1 : 0;
}

function questionShape(message) {
  const normalized = normalizeText(message);
  if (!normalized) return { question: 0, explain: 0, compare: 0 };
  return {
    question: /^(come|cosa|quale|quali|dimmi|mostra|analizza|verifica|confronta|riassumi|spiega)\b/.test(normalized) ? 1 : 0,
    explain: /(perche|spiega|riassumi|fammi capire|come siamo messi)/.test(normalized) ? 1 : 0,
    compare: /(confronta|andamento|trend|report|riepilogo|riassunto)/.test(normalized) ? 1 : 0
  };
}

const INTENT_MAP = {
  ask_center_status: {
    keywords: ["stato centro", "stato del centro", "situazione centro", "come va il centro", "come sta il centro", "salute centro", "centro sotto controllo"],
    patterns: [/stato.*centro/, /situazione.*centro/, /come.*centro/, /come siamo messi/, /salute.*centro/],
    entities: ["centro", "salute", "stato", "situazione"],
    verbs: ["dimmi", "mostra", "analizza", "spiega"],
    domain: "decision"
  },
  ask_priority: {
    keywords: ["priorita del giorno", "cosa devo fare", "cosa fare oggi", "priorita oggi", "azione urgente"],
    patterns: [/cosa.*fare/, /priorit.*giorno/, /oggi.*priorit/, /azione.*urgente/],
    entities: ["priorita", "oggi", "azione", "urgenza"],
    verbs: ["dimmi", "analizza", "mostra"],
    domain: "decision"
  },
  ask_cash_issue: {
    keywords: ["cassa", "cash", "pagamenti", "incassi", "pagamenti da collegare", "pagamento"],
    patterns: [/cassa/, /cash/, /pagament/, /incass/],
    entities: ["cassa", "cash", "incassi", "pagamenti"],
    verbs: ["verifica", "mostra", "analizza", "controlla"],
    domain: "cash"
  },
  ask_marketing_opportunity: {
    keywords: ["marketing", "clienti da richiamare", "richiami", "richiamare", "recall", "clienti persi"],
    patterns: [/clienti.*richiam/, /richiam/, /recall/, /marketing/, /clienti.*persi/],
    entities: ["clienti", "marketing", "recall", "richiamo"],
    verbs: ["richiama", "mostra", "analizza", "dimmi"],
    domain: "marketing"
  },
  ask_agenda_issue: {
    keywords: ["agenda", "appuntamenti", "buchi agenda", "giornata scarica", "slot liberi"],
    patterns: [/agenda/, /appuntament/, /slot liberi/, /giornata scarica/, /buchi agenda/],
    entities: ["agenda", "appuntamenti", "slot", "giornata"],
    verbs: ["mostra", "analizza", "verifica"],
    domain: "agenda"
  },
  ask_report_summary: {
    keywords: ["report", "andamento", "riepilogo", "riassunto", "trend"],
    patterns: [/report/, /andament/, /riepilog/, /riassunt/, /trend/],
    entities: ["report", "trend", "riepilogo"],
    verbs: ["riassumi", "mostra", "spiega", "confronta"],
    domain: "report"
  },
  ask_profitability: {
    keywords: ["redditivita", "margine", "profitto", "profitto centro", "margini servizi"],
    patterns: [/redditivit/, /margini?/, /profitto/, /margine.*servizi/],
    entities: ["redditivita", "margine", "profitto", "servizi"],
    verbs: ["analizza", "mostra", "verifica"],
    domain: "profitability"
  },
  ask_operator_productivity: {
    keywords: ["operatori", "produttivita operatori", "operatore forte", "operatore debole", "staff"],
    patterns: [/operator/, /produttivit/, /staff/, /operatore.*forte/, /operatore.*debole/],
    entities: ["operatori", "operatore", "staff"],
    verbs: ["analizza", "mostra", "confronta"],
    domain: "operator"
  },
  ask_data_quality: {
    keywords: ["qualita dati", "dati sporchi", "dati incompleti", "anomalia dati", "dato da verificare"],
    patterns: [/qualita dati/, /dati sporchi/, /dati incomplet/, /anomalia dati/, /dato.*verificar/],
    entities: ["dati", "qualita", "anomalia"],
    verbs: ["verifica", "analizza", "mostra"],
    domain: "data_quality"
  },
  ask_general_explanation: {
    keywords: ["spiegami", "come funziona", "cosa significa", "fammi capire", "in breve"],
    patterns: [/come funziona/, /cosa significa/, /fammi capire/, /spiegami/],
    entities: ["spiegazione", "significa", "funziona"],
    verbs: ["spiega", "dimmi"],
    domain: "general"
  }
};

const DOMAIN_MAP = {
  cash: { keywords: ["cassa", "cash", "pagamenti", "incassi"], legacyBias: 0.06 },
  decision: { keywords: ["priorita", "stato centro", "cosa fare", "azione"], legacyBias: 0.08 },
  marketing: { keywords: ["marketing", "richiami", "recall", "clienti"], legacyBias: 0.05 },
  agenda: { keywords: ["agenda", "appuntamenti", "slot"], legacyBias: 0.05 },
  report: { keywords: ["report", "andamento", "trend", "riepilogo"], legacyBias: 0.04 },
  profitability: { keywords: ["redditivita", "margine", "profitto"], legacyBias: 0.05 },
  operator: { keywords: ["operatori", "operatore", "staff"], legacyBias: 0.04 },
  data_quality: { keywords: ["qualita dati", "anomalia", "dati incompleti"], legacyBias: 0.05 },
  general: { keywords: ["spiega", "come funziona", "in breve"], legacyBias: 0.02 }
};

const ROUTER_VARIANTS = {
  balanced_v2: {
    intentWeights: {
      keyword: 0.38,
      pattern: 0.24,
      entity: 0.18,
      verb: 0.12,
      start: 0.08,
      explain: 0.05,
      compare: 0.05
    },
    domainWeights: {
      keyword: 0.34,
      state: 0.28,
      intent: 0.20,
      pattern: 0.12,
      bias: 0.06
    }
  },
  action_bias_v1: {
    intentWeights: {
      keyword: 0.32,
      pattern: 0.20,
      entity: 0.18,
      verb: 0.18,
      start: 0.12,
      explain: 0.03,
      compare: 0.03
    },
    domainWeights: {
      keyword: 0.28,
      state: 0.25,
      intent: 0.24,
      pattern: 0.15,
      bias: 0.08
    }
  },
  evidence_bias_v1: {
    intentWeights: {
      keyword: 0.40,
      pattern: 0.26,
      entity: 0.20,
      verb: 0.07,
      start: 0.07,
      explain: 0.07,
      compare: 0.07
    },
    domainWeights: {
      keyword: 0.30,
      state: 0.34,
      intent: 0.18,
      pattern: 0.10,
      bias: 0.08
    }
  }
};

const DEFAULT_ROUTER_VARIANT = "balanced_v2";

function scoreIntent(message, intentKey, variantName = DEFAULT_ROUTER_VARIANT) {
  const variant = ROUTER_VARIANTS[variantName] || ROUTER_VARIANTS[DEFAULT_ROUTER_VARIANT];
  const config = INTENT_MAP[intentKey];
  const question = questionShape(message);
  const keywordScore = uniqueMatches(message, config.keywords);
  const patternScore = uniqueMatches(message, config.patterns);
  const entityScore = uniqueMatches(message, config.entities);
  const verbScore = uniqueMatches(message, config.verbs);
  const startScore = startsWithStrongVerb(message, config.verbs);
  return Number((
    (variant.intentWeights.keyword * keywordScore)
    + (variant.intentWeights.pattern * patternScore)
    + (variant.intentWeights.entity * entityScore)
    + (variant.intentWeights.verb * verbScore)
    + (variant.intentWeights.start * startScore)
    + (variant.intentWeights.explain * question.explain)
    + (variant.intentWeights.compare * question.compare)
  ).toFixed(6));
}

function stateDomainSignal(domainKey, state = {}) {
  const snapshot = state.snapshot || {};
  const decisionContext = state.decisionContext || {};
  const topSignals = Array.isArray(decisionContext.topSignals) ? decisionContext.topSignals : [];
  const primaryAction = decisionContext.primaryAction || {};
  const marketing = snapshot.marketing || {};
  const profitability = snapshot.profitability || {};
  const dataQuality = snapshot.dataQuality || {};
  const centerHealth = snapshot.report?.centerHealth || {};
  const operations = snapshot.operations || {};
  const stateDecision = state.goldState?.decision || {};
  const signalHit = topSignals.some((item) => String(item.domain || "") === domainKey) ? 1 : 0;
  if (domainKey === "cash") {
    return clamp01(
      (Number(state.goldState?.cashSelection?.reliabilityScore || 0) * 0.35)
      + (Number(dataQuality.metrics?.unlinkedPayments || 0) > 0 ? 0.45 : 0)
      + (signalHit * 0.20)
    );
  }
  if (domainKey === "decision") {
    return clamp01(
      (String(primaryAction.domain || "") === "operations" ? 0.45 : 0)
      + (Number(decisionContext.systemRisk || 0) * 0.35)
      + (["sotto_soglia", "fragile"].includes(String(centerHealth.status || "")) ? 0.20 : 0)
    );
  }
  if (domainKey === "marketing") {
    return clamp01(
      ((Array.isArray(marketing.suggestions) && marketing.suggestions.length > 0) ? 0.55 : 0)
      + (signalHit * 0.20)
      + (marketing.focusClient ? 0.25 : 0)
    );
  }
  if (domainKey === "agenda") {
    return clamp01(
      (operations.weakestUpcomingDay ? 0.45 : 0)
      + (signalHit * 0.25)
      + (Number(snapshot.report?.centerHealth?.saturationPercent || 0) < 55 ? 0.20 : 0)
      + (String(stateDecision.domain || "") === "operations" ? 0.10 : 0)
    );
  }
  if (domainKey === "report") {
    return clamp01(
      (centerHealth.status ? 0.45 : 0)
      + (signalHit * 0.20)
      + (snapshot.report?.operational ? 0.25 : 0)
    );
  }
  if (domainKey === "profitability") {
    return clamp01(
      ((Array.isArray(profitability.alerts) && profitability.alerts.length > 0) ? 0.45 : 0)
      + ((Array.isArray(profitability.suggestions) && profitability.suggestions.length > 0) ? 0.25 : 0)
      + (signalHit * 0.20)
      + (String(stateDecision.domain || "") === "profitability" ? 0.10 : 0)
    );
  }
  if (domainKey === "operator") {
    return clamp01(
      (operations.topOperator ? 0.30 : 0)
      + (operations.weakOperator ? 0.30 : 0)
      + (signalHit * 0.20)
      + (snapshot.goldEngine?.operators?.summary?.total ? 0.20 : 0)
    );
  }
  if (domainKey === "data_quality") {
    return clamp01(
      ((Number(dataQuality.score || 0) < 75) ? 0.50 : 0)
      + ((Array.isArray(dataQuality.alerts) && dataQuality.alerts.length > 0) ? 0.30 : 0)
      + (signalHit * 0.20)
    );
  }
  return clamp01(signalHit * 0.35);
}

function scoreDomain(message, domainKey, state = {}, selectedIntent = "", variantName = DEFAULT_ROUTER_VARIANT) {
  const variant = ROUTER_VARIANTS[variantName] || ROUTER_VARIANTS[DEFAULT_ROUTER_VARIANT];
  const keywordScore = uniqueMatches(message, DOMAIN_MAP[domainKey]?.keywords || []);
  const patternScore = domainKey === "general" ? 0 : keywordScore > 0 ? 1 : 0;
  const intentBoost = INTENT_MAP[selectedIntent]?.domain === domainKey ? 1 : 0;
  const stateBoost = stateDomainSignal(domainKey, state);
  return Number((
    (variant.domainWeights.keyword * keywordScore)
    + (variant.domainWeights.pattern * patternScore)
    + (variant.domainWeights.intent * intentBoost)
    + (variant.domainWeights.state * stateBoost)
    + (variant.domainWeights.bias * Number(DOMAIN_MAP[domainKey]?.legacyBias || 0))
  ).toFixed(6));
}

function parseIntent(message, variantName = DEFAULT_ROUTER_VARIANT) {
  const scored = Object.keys(INTENT_MAP)
    .map((key) => ({ key, score: scoreIntent(message, key, variantName) }))
    .sort((a, b) => b.score - a.score);
  return {
    intent: scored[0]?.key || "ask_general_explanation",
    scores: scored,
    variant: variantName
  };
}

function routeDomain(message, state = {}, selectedIntent = "", variantName = DEFAULT_ROUTER_VARIANT) {
  const scored = Object.keys(DOMAIN_MAP)
    .map((key) => ({ key, score: scoreDomain(message, key, state, selectedIntent, variantName) }))
    .sort((a, b) => b.score - a.score);
  return {
    domain: scored[0]?.key || "general",
    scores: scored,
    variant: variantName
  };
}

function evaluateRouterVariants(cases = []) {
  return Object.keys(ROUTER_VARIANTS)
    .map((variant) => {
      let intentHits = 0;
      let domainHits = 0;
      cases.forEach((item) => {
        const intent = parseIntent(item.message, variant).intent;
        const domain = routeDomain(item.message, item.state || {}, intent, variant).domain;
        if (intent === item.intent) intentHits += 1;
        if (domain === item.domain) domainHits += 1;
      });
      const total = Math.max(cases.length, 1);
      return {
        variant,
        intentAccuracy: Number((intentHits / total).toFixed(4)),
        domainAccuracy: Number((domainHits / total).toFixed(4)),
        blendedAccuracy: Number((((intentHits + domainHits) / (total * 2))).toFixed(4))
      };
    })
    .sort((a, b) => b.blendedAccuracy - a.blendedAccuracy);
}

module.exports = {
  DEFAULT_ROUTER_VARIANT,
  ROUTER_VARIANTS,
  INTENT_MAP,
  DOMAIN_MAP,
  normalizeText,
  parseIntent,
  routeDomain,
  evaluateRouterVariants
};
