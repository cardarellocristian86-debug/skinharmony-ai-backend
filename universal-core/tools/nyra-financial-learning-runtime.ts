import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  NyraFinancialLearningDomain,
  NyraFinancialLearningPack,
  NyraFinancialLearningRecord,
  NyraLearningStorageProfile,
} from "../packages/contracts/src/index.ts";

type FinancialDomainDefinition = {
  id: NyraFinancialLearningDomain;
  label: string;
  summary: string;
};

const DOMAINS: FinancialDomainDefinition[] = [
  { id: "market_structure", label: "Market Structure", summary: "come funzionano mercati, ordini, scambi, liquidita e prezzo" },
  { id: "equities", label: "Equities", summary: "azioni, capitalizzazione, trend, settori e rischio societario" },
  { id: "bonds", label: "Bonds", summary: "tassi, duration, credito, curva e sensibilita macro" },
  { id: "etfs", label: "ETFs", summary: "panieri, replica, esposizione, liquidita e tracking" },
  { id: "options", label: "Options", summary: "premio, delta, gamma, theta, volatilita implicita e copertura" },
  { id: "forex", label: "Forex", summary: "coppie valutarie, differenziali tassi, flussi e shock macro" },
  { id: "crypto", label: "Crypto", summary: "microstructure, volatilita, sentiment, liquidazioni e regime risk-on/off" },
  { id: "macro", label: "Macro", summary: "inflazione, tassi, crescita, banche centrali, rischio sistemico" },
  { id: "risk_management", label: "Risk Management", summary: "drawdown, sizing, stop, take profit, scenario avverso" },
  { id: "short_selling", label: "Short Selling", summary: "short, borrow, margin, squeeze, copertura ribassista e rischio asimmetrico" },
  { id: "technical_analysis", label: "Technical Analysis", summary: "trend, momentum, volumi, volatilita, conferme e falsi segnali" },
  { id: "execution", label: "Execution", summary: "slippage, spread, fill quality, pazienza, aggressivita e costo reale di uscita/ingresso" },
  { id: "portfolio", label: "Portfolio", summary: "allocazione, correlazione, concentrazione, hedging e selezione del numero giusto di posizioni" },
  { id: "behavioral", label: "Behavioral", summary: "fomo, overtrading, revenge trading, conferma del bias e disciplina decisionale" },
  { id: "regime_detection", label: "Regime Detection", summary: "compressione, trend, mean reversion, risk-on/off e cambio di regime" },
  { id: "derivatives", label: "Derivatives", summary: "funding, basis, leverage, liquidazioni, futures e stress da positioning forzato" },
  { id: "commodities", label: "Commodities", summary: "petrolio, gas, oro, supply shock, geopolitica e rischio logistico sulle materie prime" },
  { id: "event_driven", label: "Event Driven", summary: "earnings, banche centrali, guerra, headline risk, calendario e shock discreti" },
  { id: "exit_management", label: "Exit Management", summary: "take profit, trailing stop, invalidazione, time stop e chiusura di basket o singole posizioni" },
];

function domainSpecificConcepts(domain: NyraFinancialLearningDomain): string[] {
  const shared = ["scenario", "probabilita", "drawdown", "liquidita", "trend", "rischio", "decisione"];
  const map: Record<NyraFinancialLearningDomain, string[]> = {
    market_structure: ["order_book", "spread", "trade_flow"],
    equities: ["earnings", "sector_rotation", "valuation"],
    bonds: ["duration", "yield_curve", "credit_spread"],
    etfs: ["tracking_error", "basket", "flow"],
    options: ["delta", "gamma", "implied_volatility"],
    forex: ["carry", "rate_diff", "macro_flow"],
    crypto: ["liquidations", "funding", "risk_on_off"],
    macro: ["inflation", "rates", "growth"],
    risk_management: ["position_sizing", "stop_loss", "take_profit"],
    short_selling: ["borrow", "margin_call", "short_squeeze"],
    technical_analysis: ["momentum", "breakout", "support_resistance"],
    execution: ["slippage", "spread_cost", "fill_quality"],
    portfolio: ["correlation", "allocation", "concentration"],
    behavioral: ["fomo", "overtrading", "discipline"],
    regime_detection: ["compression", "trend_regime", "mean_reversion"],
    derivatives: ["basis", "funding", "leverage"],
    commodities: ["supply_shock", "inventory", "geopolitical_premium"],
    event_driven: ["calendar_risk", "headline_shock", "event_window"],
    exit_management: ["take_profit", "trailing_stop", "time_stop"],
  };
  return uniqueSorted([...shared, ...map[domain]]);
}

function domainSpecificScenarios(domain: NyraFinancialLearningDomain): string[] {
  const base = [
    `valuta ${domain} con scenario rialzista, ribassista e neutrale`,
    `trova il rischio dominante in ${domain}`,
    `decidi se buy sell hold con conferma del contesto`,
  ];
  const extra: Record<NyraFinancialLearningDomain, string[]> = {
    market_structure: ["leggi il book e separa assorbimento da finto breakout"],
    equities: ["separa rally di utili da rally fragile di multipli"],
    bonds: ["capisci quando i tassi alti schiacciano duration e crescita"],
    etfs: ["stima se il paniere nasconde concentrazione in poche mega cap"],
    options: ["evita di confondere volatilita implicita con direzione certa"],
    forex: ["distingui trend macro da rumore intraday sulle coppie"],
    crypto: ["riconosci quando funding e liquidazioni guidano il prezzo piu del fondamentale"],
    macro: ["traduce un regime higher for longer in pressione su equity e duration"],
    risk_management: ["scegli sizing e uscita prima di aprire la posizione"],
    short_selling: ["shortare solo quando deterioramento e timing coincidono"],
    technical_analysis: ["scarta il setup se momentum e volumi non confermano"],
    execution: ["scegli se entrare ora o attendere un fill migliore"],
    portfolio: ["decidi se concentrare capitale o restare selettivo su poche posizioni"],
    behavioral: ["blocca overtrading quando il numero di setup supera la qualita"],
    regime_detection: ["riconosci quando un mercato passa da trend a compressione"],
    derivatives: ["leggi leverage e liquidazioni come rischio di squeeze"],
    commodities: ["distinguere rally di scarsita reale da spike emotivo da headline"],
    event_driven: ["trattare eventi discreti come finestre di rischio non lineare"],
    exit_management: ["scegliere prima l invalidazione e poi il profitto atteso della posizione"],
  };
  return [...base, ...extra[domain]];
}

function domainSpecificRiskRules(domain: NyraFinancialLearningDomain): string[] {
  const shared = [
    "non trattare volatilita e trend come la stessa cosa",
    "non trasformare segnale ambiguo in esecuzione aggressiva",
    "se drawdown e volatilita salgono insieme, alza prudenza",
    "la microstructure non basta senza conferma di contesto",
  ];
  const extra: Record<NyraFinancialLearningDomain, string[]> = {
    market_structure: ["non confondere compressione con assenza di rischio"],
    equities: ["non comprare forza tardiva senza valutare tassi e concentrazione"],
    bonds: ["duration lunga sotto tassi alti richiede prudenza strutturale"],
    etfs: ["un ETF largo puo nascondere rischio di poche componenti dominanti"],
    options: ["opzioni con leva alta non vanno trattate come spot semplificato"],
    forex: ["news macro e differenziale tassi possono invalidare pattern tecnici puliti"],
    crypto: ["funding e liquidazioni possono ribaltare il prezzo anche con narrativa intatta"],
    macro: ["non usare un solo dato macro per forzare un regime completo"],
    risk_management: ["prima sopravvivenza del capitale, poi ricerca del profitto"],
    short_selling: ["lo short ha perdita teorica asimmetrica e richiede size piu dura del long", "riconoscere squeeze risk prima di aumentare size"],
    technical_analysis: ["mai scambiare una trendline per conferma sufficiente da sola"],
    execution: ["il costo reale di spread e slippage puo annullare un edge piccolo"],
    portfolio: ["troppe posizioni deboli valgono meno di poche posizioni forti"],
    behavioral: ["se serve forzare il trade, il trade probabilmente non va fatto"],
    regime_detection: ["cambio regime batte pattern locale"],
    derivatives: ["leverage alto senza margine di errore richiede bias piu duro e sizing minore"],
    commodities: ["nelle commodity il rischio geopolitico puo dominare il fondamentale di breve"],
    event_driven: ["un evento binario invalida facilmente segnali puliti di microstructure"],
    exit_management: ["una buona entrata senza buona uscita non basta per un sistema profittevole"],
  };
  return uniqueSorted([...shared, ...extra[domain]]);
}

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9àèéìòù\s]/gi, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function topTerms(tokens: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

function bytesOf(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function brotliBytesOf(value: string): number {
  return brotliCompressSync(Buffer.from(value, "utf8"), {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  }).byteLength;
}

function buildStorageProfile(rawJson: string, semanticJson: string): NyraLearningStorageProfile {
  const rawBytes = bytesOf(rawJson);
  const semanticBytes = bytesOf(semanticJson);
  const brotliRawBytes = brotliBytesOf(rawJson);
  const brotliSemanticBytes = brotliBytesOf(semanticJson);

  return {
    profile_version: "nyra_semantic_storage_v1",
    raw_bytes: rawBytes,
    semantic_bytes: semanticBytes,
    semantic_ratio: Number((semanticBytes / rawBytes).toFixed(6)),
    brotli_raw_bytes: brotliRawBytes,
    brotli_semantic_bytes: brotliSemanticBytes,
    brotli_ratio: Number((brotliSemanticBytes / brotliRawBytes).toFixed(6)),
    loss_model: "semantic_distillation",
  };
}

export function buildFinancialLearningRecords(): NyraFinancialLearningRecord[] {
  const records: NyraFinancialLearningRecord[] = [];
  let counter = 1;

  for (const domain of DOMAINS) {
    const rawText =
      `Modulo ${domain.label}. ` +
      `${domain.summary}. ` +
      `Nyra studia definizioni, rischi, segnali, contesto macro, casi limite e regole di prudenza. ` +
      `Ogni record viene trasformato in concetti, vocabolario, regole rischio e scenari riutilizzabili. ` +
      `Il focus operativo e capire quando entrare, quando non entrare, come uscire e quando il costo reale annulla il vantaggio teorico.`;
    const conceptNodes = domainSpecificConcepts(domain.id);
    const scenarioSeeds = domainSpecificScenarios(domain.id);
    const riskRules = domainSpecificRiskRules(domain.id);

    records.push({
      record_id: `nyra-financial-learning:${counter++}`,
      domain: domain.id,
      title: domain.label,
      source_kind: "primer",
      raw_text: rawText,
      concept_nodes: conceptNodes,
      vocabulary: uniqueSorted(topTerms(tokenize(rawText), 18)),
      scenario_seeds: scenarioSeeds,
      risk_rules: riskRules,
    });
  }

  return records;
}

export function distillFinancialLearningPack(records: NyraFinancialLearningRecord[], generatedAt = new Date().toISOString()): NyraFinancialLearningPack {
  const conceptGraphMap = new Map<string, { weight: number; domain: NyraFinancialLearningDomain; related: Set<string> }>();
  const scenarioMap = new Map<string, NyraFinancialLearningPack["scenario_templates"][number]>();
  const riskRules = new Set<string>();

  for (const record of records) {
    for (const rule of record.risk_rules) riskRules.add(rule);
    for (const [index, seed] of record.scenario_seeds.entries()) {
      const key = `${record.domain}:${seed}`;
      if (!scenarioMap.has(key)) {
        scenarioMap.set(key, {
          id: `financial-scenario:${record.domain}:${index + 1}`,
          domain: record.domain,
          prompt: seed,
        });
      }
    }
    for (const concept of record.concept_nodes) {
      const entry = conceptGraphMap.get(concept) ?? { weight: 0, domain: record.domain, related: new Set<string>() };
      entry.weight += 1;
      for (const related of record.concept_nodes) {
        if (related !== concept) entry.related.add(related);
      }
      conceptGraphMap.set(concept, entry);
    }
  }

  const semanticBase = {
    pack_version: "nyra_financial_learning_pack_v1" as const,
    generated_at: generatedAt,
    owner_scope: "god_mode_only" as const,
    records_count: records.length,
    domains: DOMAINS.map((domain) => ({
      id: domain.id,
      label: domain.label,
      summary: domain.summary,
      concept_count: uniqueSorted(records.filter((record) => record.domain === domain.id).flatMap((record) => record.concept_nodes)).length,
    })),
    concept_graph: [...conceptGraphMap.entries()]
      .map(([concept, data]) => ({
        concept,
        weight: data.weight,
        domain: data.domain,
        related_concepts: [...data.related].sort((a, b) => a.localeCompare(b)).slice(0, 8),
      }))
      .sort((a, b) => b.weight - a.weight || a.concept.localeCompare(b.concept)),
    scenario_templates: [...scenarioMap.values()].sort((a, b) => `${a.domain}:${a.prompt}`.localeCompare(`${b.domain}:${b.prompt}`)),
    risk_rules: [...riskRules].sort((a, b) => a.localeCompare(b)),
  };

  return {
    ...semanticBase,
    storage_profile: buildStorageProfile(JSON.stringify(records), JSON.stringify(semanticBase)),
  };
}

export function saveFinancialLearningPack(path: string, pack: NyraFinancialLearningPack): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pack, null, 2));
}

export function loadFinancialLearningPack(path: string): NyraFinancialLearningPack {
  return JSON.parse(readFileSync(path, "utf8")) as NyraFinancialLearningPack;
}
