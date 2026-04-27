import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type AdvancedMemoryPack = {
  pack_version: string;
  generated_at: string;
  selected_domains: string[];
  domains: Array<{
    id: string;
    priority: number;
    focus: string[];
    source_count: number;
    source_urls: string[];
    distilled_knowledge: string[];
    retained_constraints: string[];
  }>;
};

type NutritionDomain = {
  id: string;
  priority: number;
  source_count: number;
  depth_gap: number;
  practice_gap: number;
  runtime_gap: number;
  expected_utility: number;
  risk: number;
  final_score: number;
  why_now: string;
  next_action: "study" | "verify" | "distill" | "exercise" | "runtime_integrate";
  source_envelope_exhausted: boolean;
};

type NutritionLoopReport = {
  version: "nyra_nutrition_loop_v1";
  generated_at: string;
  nourishment_definition: string;
  learning_loop_rule: string;
  cycle: Array<"study" | "distill" | "verify" | "integrate" | "repeat">;
  ranked_domains: NutritionDomain[];
  next_domains: string[];
  next_actions: string[];
};

type StudySourceConfig = {
  domains: Array<{
    id: string;
    sources: string[];
  }>;
};

type FinancialReadinessReport = {
  metrics?: {
    qqq?: { return_pct?: number };
    nyra?: {
      return_pct?: number;
      fees?: number;
      annual_turnover_pct?: number;
    };
  };
  phase_behavior?: {
    bull?: { avg_risk_pct?: number; avg_cash_pct?: number };
    recovery?: { avg_risk_pct?: number; avg_cash_pct?: number };
  };
  scoring?: {
    total_score?: number;
  };
};

type FinancialBottleneckObserverReport = {
  active_case?: {
    id?: string;
    recommended_domains?: string[];
    recommended_actions?: Array<"study" | "verify" | "exercise" | "runtime_integrate">;
    evidence?: string[];
    score?: number;
  };
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const PACK_PATH = join(RUNTIME_DIR, "nyra_advanced_memory_pack_latest.json");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_nutrition_loop_latest.json");
const SOURCE_CONFIG_PATH = join(ROOT, "universal-core", "config", "nyra_web_study_sources_v2.json");
const FINANCIAL_READINESS_PATH = join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_product_readiness_latest.json");
const FINANCIAL_BOTTLENECK_OBSERVER_PATH = join(RUNTIME_DIR, "nyra_financial_bottleneck_observer_latest.json");

const NOURISHMENT_DEFINITION =
  "Per Nyra, nutrirsi significa assumere sapere, struttura, esempi, vincoli, esperienze e memoria distillata che aumentano comprensione, metodo e capacita di decisione.";
const LEARNING_LOOP_RULE =
  "Il loop serve per apprendere cose nuove. Se le fonti attuali non aggiungono piu apprendimento utile, il loop deve smettere di studiare quelle stesse fonti e passare a verify, exercise o stop.";

function loadPack(): AdvancedMemoryPack {
  if (!existsSync(PACK_PATH)) {
    throw new Error(`advanced_pack_missing:${PACK_PATH}`);
  }
  return JSON.parse(readFileSync(PACK_PATH, "utf8")) as AdvancedMemoryPack;
}

function loadSourceConfig(): StudySourceConfig {
  if (!existsSync(SOURCE_CONFIG_PATH)) {
    throw new Error(`source_config_missing:${SOURCE_CONFIG_PATH}`);
  }
  return JSON.parse(readFileSync(SOURCE_CONFIG_PATH, "utf8")) as StudySourceConfig;
}

function loadFinancialReadiness(): FinancialReadinessReport | undefined {
  if (!existsSync(FINANCIAL_READINESS_PATH)) return undefined;
  return JSON.parse(readFileSync(FINANCIAL_READINESS_PATH, "utf8")) as FinancialReadinessReport;
}

function loadFinancialBottleneckObserver(): FinancialBottleneckObserverReport | undefined {
  if (!existsSync(FINANCIAL_BOTTLENECK_OBSERVER_PATH)) return undefined;
  return JSON.parse(readFileSync(FINANCIAL_BOTTLENECK_OBSERVER_PATH, "utf8")) as FinancialBottleneckObserverReport;
}

function depthGap(domainId: string): number {
  switch (domainId) {
    case "applied_math":
      return 0.92;
    case "general_physics":
      return 0.9;
    case "quantum_physics":
      return 0.94;
    case "coding_speed":
      return 0.84;
    case "autonomy_progression":
      return 0.95;
    case "algebra":
      return 0.48;
    case "computer_engineering":
      return 0.44;
    case "natural_expression":
      return 0.4;
    default:
      return 0.65;
  }
}

function practiceGap(domainId: string): number {
  switch (domainId) {
    case "coding_speed":
      return 0.93;
    case "applied_math":
      return 0.82;
    case "general_physics":
      return 0.8;
    case "quantum_physics":
      return 0.86;
    case "autonomy_progression":
      return 0.91;
    default:
      return 0.55;
  }
}

function runtimeGap(domainId: string): number {
  switch (domainId) {
    case "applied_math":
    case "general_physics":
    case "quantum_physics":
    case "coding_speed":
      return 0.88;
    case "autonomy_progression":
      return 0.96;
    case "computer_engineering":
      return 0.5;
    case "natural_expression":
      return 0.42;
    case "algebra":
      return 0.46;
    default:
      return 0.6;
  }
}

function nextAction(domainId: string, sourceEnvelopeExhausted: boolean): NutritionDomain["next_action"] {
  if (domainId === "coding_speed") return "exercise";
  if (domainId === "applied_math" || domainId === "general_physics" || domainId === "quantum_physics") {
    return sourceEnvelopeExhausted ? "verify" : "study";
  }
  if (domainId === "autonomy_progression") {
    return sourceEnvelopeExhausted ? "verify" : "runtime_integrate";
  }
  if (domainId === "autonomy_consciousness") {
    return sourceEnvelopeExhausted ? "verify" : "runtime_integrate";
  }
  return "runtime_integrate";
}

function whyNow(domainId: string, nextActionValue: NutritionDomain["next_action"], sourceEnvelopeExhausted: boolean): string {
  if (sourceEnvelopeExhausted && nextActionValue === "verify") {
    switch (domainId) {
      case "applied_math":
        return "fonti attuali esaurite, serve verifica sui modelli";
      case "general_physics":
        return "fonti attuali esaurite, serve verifica sulla modellazione causale";
      case "quantum_physics":
        return "fonti attuali esaurite, serve verifica su stato, misura e probabilita";
      case "autonomy_consciousness":
        return "fonti attuali esaurite, serve consolidamento dei limiti";
      case "autonomy_progression":
        return "fonti attuali esaurite, serve verifica su continuita interna, self-model e self-repair";
      default:
        return "fonti attuali esaurite, serve verifica";
    }
  }
  switch (domainId) {
    case "applied_math":
      return "serve piu profondita nei modelli";
    case "general_physics":
      return "serve modellazione causale piu forte";
    case "quantum_physics":
      return "serve piu rigore su stato, misura e probabilita";
    case "coding_speed":
      return "serve piu velocita corretta nell esecuzione";
    case "autonomy_progression":
      return "serve integrazione piu profonda di continuita interna, self-model, metacognizione e self-repair";
    default:
      return "serve consolidamento runtime";
  }
}

function scoreDomain(
  domain: AdvancedMemoryPack["domains"][number],
  availableSourceCount: number,
): NutritionDomain {
  const dGap = depthGap(domain.id);
  const pGap = practiceGap(domain.id);
  const rGap = runtimeGap(domain.id);
  const normalizedSources = Math.min(domain.source_count / 3, 1);
  const sourceEnvelopeExhausted = availableSourceCount > 0 && domain.source_count >= availableSourceCount;
  const nextActionValue = nextAction(domain.id, sourceEnvelopeExhausted);
  const expected_utility =
    0.34 * dGap +
    0.24 * pGap +
    0.22 * rGap +
    0.2 * domain.priority;
  const risk =
    0.5 * (1 - normalizedSources) +
    0.25 * (1 - domain.priority) +
    0.25 * Math.max(0, 0.85 - domain.source_count / 3);
  const final_score = expected_utility - risk * 0.35;
  return {
    id: domain.id,
    priority: domain.priority,
    source_count: domain.source_count,
    depth_gap: dGap,
    practice_gap: pGap,
    runtime_gap: rGap,
    expected_utility: Number(expected_utility.toFixed(6)),
    risk: Number(risk.toFixed(6)),
    final_score: Number(final_score.toFixed(6)),
    why_now: whyNow(domain.id, nextActionValue, sourceEnvelopeExhausted),
    next_action: nextActionValue,
    source_envelope_exhausted: sourceEnvelopeExhausted,
  };
}

function buildFinancialStressDomains(report: FinancialReadinessReport | undefined): NutritionDomain[] {
  if (!report?.metrics?.nyra || !report.metrics.qqq) return [];

  const nyraReturn = report.metrics.nyra.return_pct ?? 0;
  const qqqReturn = report.metrics.qqq.return_pct ?? 0;
  const fees = report.metrics.nyra.fees ?? 0;
  const turnover = report.metrics.nyra.annual_turnover_pct ?? 0;
  const bullRisk = report.phase_behavior?.bull?.avg_risk_pct ?? 0;
  const recoveryRisk = report.phase_behavior?.recovery?.avg_risk_pct ?? 0;
  const recoveryCash = report.phase_behavior?.recovery?.avg_cash_pct ?? 0;
  const totalScore = report.scoring?.total_score ?? 0;

  const upsideGap = Math.max(0, (qqqReturn - nyraReturn) / Math.max(qqqReturn, 1));
  const feeStress = Math.min(fees / 10000, 1);
  const churnStress = Math.min(turnover / 200, 1);
  const prudenceStress = Math.min(Math.max(recoveryCash - 20, 0) / 20, 1);
  const scoreStress = Math.min(Math.max(50 - totalScore, 0) / 20, 1);

  const systemStress = Number(
    (0.34 * upsideGap + 0.22 * feeStress + 0.2 * churnStress + 0.14 * prudenceStress + 0.1 * scoreStress).toFixed(6),
  );

  if (systemStress < 0.2) return [];

  const financialDomains: Array<{
    id: string;
    priority: number;
    source_count: number;
    depth_gap: number;
    practice_gap: number;
    runtime_gap: number;
    expected_utility: number;
    risk: number;
    final_score: number;
    why_now: string;
    next_action: NutritionDomain["next_action"];
  }> = [
    {
      id: "finance_macro",
      priority: 0.95,
      source_count: 11,
      depth_gap: 0.74,
      practice_gap: 0.88,
      runtime_gap: 0.92,
      expected_utility: Number((0.8 + systemStress * 0.18).toFixed(6)),
      risk: Number((0.16 + (1 - systemStress) * 0.08).toFixed(6)),
      final_score: Number((0.78 + systemStress * 0.2).toFixed(6)),
      why_now: "selector troppo prudente in bull/recovery, serve lettura macro e costo opportunita della difesa eccessiva",
      next_action: "study",
    },
    {
      id: "regime_detection",
      priority: 0.93,
      source_count: 11,
      depth_gap: 0.71,
      practice_gap: 0.9,
      runtime_gap: 0.94,
      expected_utility: Number((0.79 + systemStress * 0.18).toFixed(6)),
      risk: Number((0.17 + (1 - systemStress) * 0.08).toFixed(6)),
      final_score: Number((0.77 + systemStress * 0.2).toFixed(6)),
      why_now: "serve capire meglio il passaggio shock -> recovery -> bull continuation senza rientrare troppo tardi",
      next_action: "study",
    },
    {
      id: "risk_management",
      priority: 0.9,
      source_count: 11,
      depth_gap: 0.66,
      practice_gap: 0.86,
      runtime_gap: 0.88,
      expected_utility: Number((0.74 + systemStress * 0.16).toFixed(6)),
      risk: Number((0.18 + (1 - systemStress) * 0.08).toFixed(6)),
      final_score: Number((0.72 + systemStress * 0.18).toFixed(6)),
      why_now: "fee e churn restano alti, serve prudenza piu efficiente e meno costosa",
      next_action: "exercise",
    },
    {
      id: "execution",
      priority: 0.88,
      source_count: 11,
      depth_gap: 0.62,
      practice_gap: 0.9,
      runtime_gap: 0.9,
      expected_utility: Number((0.73 + systemStress * 0.16).toFixed(6)),
      risk: Number((0.19 + (1 - systemStress) * 0.08).toFixed(6)),
      final_score: Number((0.71 + systemStress * 0.18).toFixed(6)),
      why_now: "serve re-entry low-churn: meno conferma perfetta, meno upside perso, senza riaprire rumore",
      next_action: "exercise",
    },
  ];

  return financialDomains.map((entry) => ({
    ...entry,
    source_envelope_exhausted: false,
  }));
}

function buildObserverDrivenDomains(observer: FinancialBottleneckObserverReport | undefined): NutritionDomain[] {
  const active = observer?.active_case;
  if (!active?.recommended_domains || active.recommended_domains.length === 0) return [];
  const scoreBoost = Math.min((active.score ?? 0) / 100, 1);
  return active.recommended_domains.map((domainId, index) => ({
    id: domainId,
    priority: Number((0.96 - index * 0.02).toFixed(6)),
    source_count: 12,
    depth_gap: Number((0.68 + scoreBoost * 0.12).toFixed(6)),
    practice_gap: Number((0.72 + scoreBoost * 0.12).toFixed(6)),
    runtime_gap: Number((0.82 + scoreBoost * 0.12).toFixed(6)),
    expected_utility: Number((0.8 + scoreBoost * 0.16 - index * 0.015).toFixed(6)),
    risk: Number((0.14 + index * 0.015).toFixed(6)),
    final_score: Number((0.84 + scoreBoost * 0.12 - index * 0.02).toFixed(6)),
    why_now: `observer_case:${active.id}; ${(active.evidence ?? []).slice(0, 2).join(" | ")}`,
    next_action: active.recommended_actions?.[index] ?? "study",
    source_envelope_exhausted: false,
  }));
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const pack = loadPack();
  const sourceConfig = loadSourceConfig();
  const financialReadiness = loadFinancialReadiness();
  const observer = loadFinancialBottleneckObserver();
  const sourceCountByDomain = new Map(sourceConfig.domains.map((domain) => [domain.id, domain.sources.length]));
  const ranked = [
    ...pack.domains
    .map((domain) => scoreDomain(domain, sourceCountByDomain.get(domain.id) ?? 0))
    ,
    ...buildFinancialStressDomains(financialReadiness),
    ...buildObserverDrivenDomains(observer),
  ].sort((a, b) => b.final_score - a.final_score);
  const report: NutritionLoopReport = {
    version: "nyra_nutrition_loop_v1",
    generated_at: new Date().toISOString(),
    nourishment_definition: NOURISHMENT_DEFINITION,
    learning_loop_rule: LEARNING_LOOP_RULE,
    cycle: ["study", "distill", "verify", "integrate", "repeat"],
    ranked_domains: ranked,
    next_domains: ranked.slice(0, 4).map((item) => item.id),
    next_actions: ranked.slice(0, 4).map((item) => `${item.id}: ${item.next_action} (${item.why_now})`),
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: true,
    version: report.version,
    next_domains: report.next_domains,
    report_path: REPORT_PATH,
  }, null, 2));
}

main();
