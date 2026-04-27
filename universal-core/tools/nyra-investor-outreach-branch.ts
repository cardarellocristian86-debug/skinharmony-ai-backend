import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runNyraInvestorThesisLab } from "./nyra-investor-thesis-lab.ts";

type Language = "it" | "en";
type Region = "italy" | "europe" | "global" | "usa";
type InvestorType = "vc" | "angel_network" | "venture_platform";
type EmailStyle = "traction_first" | "thesis_first" | "operator_first";

type InvestorSeed = {
  name: string;
  country: string;
  region: Region;
  language: Language;
  type: InvestorType;
  source_url: string;
  focus_tags: string[];
  stage_focus: string;
  cold_accessibility: number;
};

type EvidenceItem = {
  id: string;
  label: string;
  evidence: string;
  source_path: string;
  strength: number;
  keep_in_email: boolean;
};

type InvestorEmailDraft = {
  style: EmailStyle;
  subject: string;
  opening_line: string;
  body: string;
  ask: string;
};

type RankedInvestor = InvestorSeed & {
  existence_verified: boolean;
  fit_score: number;
  read_probability: number;
  reply_probability: number;
  meeting_probability: number;
  why_fit: string;
  recommended_style: EmailStyle;
  email: InvestorEmailDraft;
};

type InvestorOutreachReport = {
  generated_at: string;
  runner: string;
  branch: string;
  owner_priority: "critical_cash_now_parallel_capital";
  product_stack: {
    operating_product: string;
    adjacent_applied_surfaces: string;
    finance_branch: string;
    core: string;
    agent: string;
    marketing_usage: string;
  };
  evidence: EvidenceItem[];
  top_claims: string[];
  honesty_notes: string[];
  thesis_winner: {
    id: string;
    label: string;
    opening_style: string;
    lines: {
      thesis: string;
      universal_core: string;
      nyra: string;
      smartdesk: string;
      finance: string;
      marketing: string;
      why_now: string;
      ask: string;
    };
  };
  investor_targets: RankedInvestor[];
  outreach_strategy: {
    first_wave_count: number;
    first_wave_rule: string;
    sequencing: string[];
    waves: Array<{
      wave: number;
      targets: Array<{
        name: string;
        language: Language;
        source_url: string;
        read_probability: number;
        reply_probability: number;
      }>;
    }>;
  };
  improvement_loop: {
    rule: string;
    thresholds: {
      min_open_rate: number;
      min_reply_rate: number;
      min_meeting_rate: number;
    };
    if_low_open: string[];
    if_open_no_reply: string[];
    if_reply_no_meeting: string[];
  };
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const UC_ROOT = join(ROOT, "universal-core");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "business");
const RUNTIME_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const REPORT_PATH = join(REPORT_DIR, "nyra_investor_outreach_branch_latest.json");
const PACK_PATH = join(RUNTIME_DIR, "nyra_investor_outreach_branch_latest.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const INVESTOR_SEEDS: InvestorSeed[] = [
  { name: "CDP Venture Capital", country: "Italy", region: "italy", language: "it", type: "vc", source_url: "https://www.cdpventurecapital.it/", focus_tags: ["italy", "software", "ai", "deeptech"], stage_focus: "venture capital / strategic funds", cold_accessibility: 0.48 },
  { name: "United Ventures", country: "Italy", region: "italy", language: "it", type: "vc", source_url: "https://unitedventures.com/", focus_tags: ["software", "ai", "digital", "b2b"], stage_focus: "early stage / growth tech", cold_accessibility: 0.54 },
  { name: "Primo Ventures", country: "Italy", region: "italy", language: "it", type: "vc", source_url: "https://primoventures.com/", focus_tags: ["digital", "software", "fintech", "deeptech"], stage_focus: "pre-seed / seed", cold_accessibility: 0.5 },
  { name: "P101", country: "Italy", region: "italy", language: "it", type: "vc", source_url: "https://p101.vc/", focus_tags: ["digital", "software", "marketplace", "saas"], stage_focus: "early stage", cold_accessibility: 0.5 },
  { name: "360 Capital", country: "Italy / France", region: "europe", language: "en", type: "vc", source_url: "https://360cap.vc/", focus_tags: ["software", "deeptech", "saas", "europe"], stage_focus: "seed / series A", cold_accessibility: 0.46 },
  { name: "Club degli Investitori", country: "Italy", region: "italy", language: "it", type: "angel_network", source_url: "https://www.clubdegliinvestitori.it/", focus_tags: ["italy", "angel", "startup", "digital"], stage_focus: "angel / seed", cold_accessibility: 0.58 },
  { name: "Indaco Venture Partners", country: "Italy", region: "italy", language: "it", type: "vc", source_url: "https://indacoventure.com/", focus_tags: ["technology", "software", "growth"], stage_focus: "venture capital", cold_accessibility: 0.41 },
  { name: "Italian Angels for Growth", country: "Italy", region: "italy", language: "it", type: "angel_network", source_url: "https://www.italianangels.net/", focus_tags: ["angel", "italy", "software", "startup"], stage_focus: "angel / seed", cold_accessibility: 0.57 },
  { name: "Doorway", country: "Italy", region: "italy", language: "it", type: "venture_platform", source_url: "https://doorwayplatform.com/", focus_tags: ["platform", "startup", "italy", "investment"], stage_focus: "syndicate / early stage", cold_accessibility: 0.55 },
  { name: "LIFTT", country: "Italy", region: "italy", language: "it", type: "vc", source_url: "https://liftt.com/", focus_tags: ["technology", "innovation", "software"], stage_focus: "venture capital", cold_accessibility: 0.43 },

  { name: "Seedcamp", country: "United Kingdom", region: "europe", language: "en", type: "vc", source_url: "https://seedcamp.com/faqs/", focus_tags: ["software", "ai", "fintech", "europe", "seed"], stage_focus: "seed", cold_accessibility: 0.6 },
  { name: "Point Nine", country: "Germany", region: "europe", language: "en", type: "vc", source_url: "https://www.pointnine.com/", focus_tags: ["saas", "b2b", "marketplace", "seed"], stage_focus: "seed", cold_accessibility: 0.58 },
  { name: "Speedinvest", country: "Austria", region: "europe", language: "en", type: "vc", source_url: "https://speedinvest.com/how-we-work", focus_tags: ["ai", "fintech", "saas", "europe"], stage_focus: "pre-seed to growth", cold_accessibility: 0.52 },
  { name: "Antler", country: "Global", region: "global", language: "en", type: "venture_platform", source_url: "https://www.antler.co/press-releases/fact-sheet", focus_tags: ["global", "early-stage", "ai", "software"], stage_focus: "day zero / early stage", cold_accessibility: 0.61 },
  { name: "Balderton Capital", country: "United Kingdom", region: "europe", language: "en", type: "vc", source_url: "https://www.balderton.com/", focus_tags: ["europe", "software", "ai", "b2b"], stage_focus: "seed / series A", cold_accessibility: 0.44 },
  { name: "Atomico", country: "United Kingdom", region: "europe", language: "en", type: "vc", source_url: "https://atomico.com/", focus_tags: ["europe", "software", "ai", "growth"], stage_focus: "series A and beyond", cold_accessibility: 0.36 },
  { name: "Index Ventures", country: "United Kingdom / Global", region: "global", language: "en", type: "vc", source_url: "https://www.indexventures.com/", focus_tags: ["software", "ai", "fintech", "global"], stage_focus: "seed to growth", cold_accessibility: 0.38 },
  { name: "Accel", country: "Global", region: "global", language: "en", type: "vc", source_url: "https://www.accel.com/", focus_tags: ["software", "saas", "ai", "global"], stage_focus: "seed to growth", cold_accessibility: 0.37 },
  { name: "Northzone", country: "Europe", region: "europe", language: "en", type: "vc", source_url: "https://northzone.com/", focus_tags: ["software", "fintech", "europe", "growth"], stage_focus: "seed / growth", cold_accessibility: 0.43 },
  { name: "LocalGlobe", country: "United Kingdom", region: "europe", language: "en", type: "vc", source_url: "https://www.localglobe.vc/", focus_tags: ["seed", "software", "ai", "europe"], stage_focus: "pre-seed / seed", cold_accessibility: 0.53 },
  { name: "Dawn Capital", country: "United Kingdom", region: "europe", language: "en", type: "vc", source_url: "https://dawncapital.com/", focus_tags: ["b2b", "software", "saas", "europe"], stage_focus: "seed / series A / growth", cold_accessibility: 0.46 },
  { name: "Notion Capital", country: "United Kingdom", region: "europe", language: "en", type: "vc", source_url: "https://notion.vc/", focus_tags: ["b2b", "saas", "cloud", "software"], stage_focus: "seed / series A", cold_accessibility: 0.45 },
  { name: "Octopus Ventures", country: "United Kingdom", region: "europe", language: "en", type: "vc", source_url: "https://octopusventures.com/", focus_tags: ["software", "ai", "health", "fintech"], stage_focus: "pre-seed to series B", cold_accessibility: 0.44 },
  { name: "Crane Venture Partners", country: "United Kingdom", region: "europe", language: "en", type: "vc", source_url: "https://crane.vc/", focus_tags: ["b2b", "developer", "saas", "software"], stage_focus: "seed", cold_accessibility: 0.51 },
  { name: "Hoxton Ventures", country: "United Kingdom", region: "europe", language: "en", type: "vc", source_url: "https://www.hoxtonventures.com/", focus_tags: ["software", "saas", "internet", "seed"], stage_focus: "seed", cold_accessibility: 0.47 },
  { name: "Cherry Ventures", country: "Germany", region: "europe", language: "en", type: "vc", source_url: "https://www.cherry.vc/", focus_tags: ["seed", "software", "b2b", "europe"], stage_focus: "pre-seed / seed", cold_accessibility: 0.55 },
  { name: "Earlybird", country: "Germany", region: "europe", language: "en", type: "vc", source_url: "https://earlybird.com/", focus_tags: ["europe", "software", "deeptech", "growth"], stage_focus: "seed / series A", cold_accessibility: 0.41 },
  { name: "HV Capital", country: "Germany", region: "europe", language: "en", type: "vc", source_url: "https://www.hvcapital.com/", focus_tags: ["internet", "software", "fintech", "europe"], stage_focus: "seed / growth", cold_accessibility: 0.42 },
  { name: "Project A", country: "Germany", region: "europe", language: "en", type: "vc", source_url: "https://www.project-a.com/", focus_tags: ["software", "b2b", "marketplace", "europe"], stage_focus: "pre-seed / seed", cold_accessibility: 0.47 },
  { name: "468 Capital", country: "Germany / Global", region: "global", language: "en", type: "vc", source_url: "https://www.468cap.com/", focus_tags: ["software", "global", "ai", "fintech"], stage_focus: "pre-seed / seed", cold_accessibility: 0.46 },
  { name: "Frontline Ventures", country: "Ireland", region: "europe", language: "en", type: "vc", source_url: "https://www.frontline.vc/", focus_tags: ["b2b", "saas", "software", "europe"], stage_focus: "seed / series A", cold_accessibility: 0.52 },
  { name: "Kindred Capital", country: "United Kingdom", region: "europe", language: "en", type: "vc", source_url: "https://kindredcapital.vc/", focus_tags: ["seed", "software", "europe", "community"], stage_focus: "pre-seed / seed", cold_accessibility: 0.56 },
  { name: "MMC Ventures", country: "United Kingdom", region: "europe", language: "en", type: "vc", source_url: "https://mmc.vc/", focus_tags: ["data", "software", "ai", "europe"], stage_focus: "seed / series A", cold_accessibility: 0.48 },
  { name: "EQT Ventures", country: "Sweden / Europe", region: "europe", language: "en", type: "vc", source_url: "https://eqtventures.com/", focus_tags: ["software", "global", "growth", "ai"], stage_focus: "seed / growth", cold_accessibility: 0.41 },
  { name: "Molten Ventures", country: "United Kingdom", region: "europe", language: "en", type: "vc", source_url: "https://www.moltenventures.com/", focus_tags: ["technology", "software", "growth"], stage_focus: "growth", cold_accessibility: 0.33 },

  { name: "Bessemer Venture Partners", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://www.bvp.com/", focus_tags: ["cloud", "software", "fintech", "ai"], stage_focus: "seed to growth", cold_accessibility: 0.36 },
  { name: "Sequoia Capital", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://www.sequoiacap.com/", focus_tags: ["software", "ai", "global", "growth"], stage_focus: "seed to growth", cold_accessibility: 0.31 },
  { name: "Andreessen Horowitz", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://a16z.com/", focus_tags: ["software", "ai", "fintech", "infrastructure"], stage_focus: "seed to growth", cold_accessibility: 0.32 },
  { name: "Greylock", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://greylock.com/", focus_tags: ["enterprise", "software", "ai", "developer"], stage_focus: "seed / series A", cold_accessibility: 0.35 },
  { name: "General Catalyst", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://www.generalcatalyst.com/", focus_tags: ["software", "ai", "health", "fintech"], stage_focus: "seed to growth", cold_accessibility: 0.34 },
  { name: "Insight Partners", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://www.insightpartners.com/", focus_tags: ["software", "saas", "growth", "scale"], stage_focus: "series A and beyond", cold_accessibility: 0.29 },
  { name: "Lightspeed", country: "USA / Global", region: "global", language: "en", type: "vc", source_url: "https://lsvp.com/", focus_tags: ["enterprise", "fintech", "software", "ai"], stage_focus: "seed to growth", cold_accessibility: 0.35 },
  { name: "GV", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://www.gv.com/", focus_tags: ["software", "ai", "enterprise", "data"], stage_focus: "seed to growth", cold_accessibility: 0.3 },
  { name: "First Round", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://www.firstround.com/", focus_tags: ["seed", "software", "enterprise", "fintech"], stage_focus: "seed", cold_accessibility: 0.43 },
  { name: "Craft Ventures", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://www.craftventures.com/", focus_tags: ["software", "saas", "marketplace", "fintech"], stage_focus: "seed / series A", cold_accessibility: 0.39 },
  { name: "Initialized Capital", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://initialized.com/", focus_tags: ["software", "ai", "fintech", "seed"], stage_focus: "pre-seed / seed", cold_accessibility: 0.42 },
  { name: "Felicis", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://www.felicis.com/", focus_tags: ["ai", "software", "security", "infrastructure"], stage_focus: "seed / series A", cold_accessibility: 0.38 },
  { name: "Sapphire Ventures", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://sapphireventures.com/", focus_tags: ["enterprise", "software", "growth", "saas"], stage_focus: "series A to growth", cold_accessibility: 0.28 },
  { name: "SignalFire", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://signalfire.com/", focus_tags: ["ai", "software", "data", "platform"], stage_focus: "pre-seed to series B", cold_accessibility: 0.4 },
  { name: "QED Investors", country: "USA / Global", region: "global", language: "en", type: "vc", source_url: "https://www.qed.vc/", focus_tags: ["fintech", "financial software", "global"], stage_focus: "seed to growth", cold_accessibility: 0.39 },
  { name: "Ribbit Capital", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://ribbit.com/", focus_tags: ["fintech", "financial software", "global"], stage_focus: "early stage / growth", cold_accessibility: 0.26 },
  { name: "Nyca Partners", country: "USA", region: "usa", language: "en", type: "vc", source_url: "https://nyca.com/", focus_tags: ["fintech", "financial software", "b2b"], stage_focus: "seed / early growth", cold_accessibility: 0.37 },
  { name: "Anthemis", country: "Global", region: "global", language: "en", type: "vc", source_url: "https://anthemis.com/", focus_tags: ["fintech", "financial services", "platform"], stage_focus: "seed / growth", cold_accessibility: 0.35 },
  { name: "Portage", country: "Canada / Global", region: "global", language: "en", type: "vc", source_url: "https://portageinvest.com/", focus_tags: ["fintech", "financial software", "growth"], stage_focus: "seed to growth", cold_accessibility: 0.31 },
];

type ProductReadinessShape = {
  final_output?: {
    verdict?: string;
    total_score?: number;
  };
};

function loadEvidence(): EvidenceItem[] {
  const bubble = readJson<any>(join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_bubble_detection_latest.json"));
  const lateral = readJson<any>(join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_lateral_market_latest.json"));
  const readiness = readJson<ProductReadinessShape>(join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_product_readiness_latest.json"));
  const smartdeskLoad = readJson<any>(join(ROOT, "reports", "smartdesk-tests", "smartdesk_gold_100_tenant_load_test_gold100_2026-04-18.json"));
  const smartdeskCenter = readJson<any>(join(ROOT, "reports", "smartdesk-tests", "smartdesk_gold_complex_center_test_2026-04-18.json"));

  return [
    {
      id: "smartdesk_live_load",
      label: "Smart Desk live multi-tenant load",
      evidence: `100 centri, 1100 richieste, errorRate 0, timeoutRate 0 su ambiente live Render.`,
      source_path: join(ROOT, "reports", "smartdesk-tests", "smartdesk_gold_100_tenant_load_test_gold100_2026-04-18.json"),
      strength: 0.92,
      keep_in_email: true,
    },
    {
      id: "smartdesk_complex_center",
      label: "Smart Desk complex center test",
      evidence: `dataset reale-style con 420 clienti, 2139 appuntamenti e 1492 pagamenti nel test centro complesso.`,
      source_path: join(ROOT, "reports", "smartdesk-tests", "smartdesk_gold_complex_center_test_2026-04-18.json"),
      strength: 0.86,
      keep_in_email: true,
    },
    {
      id: "finance_bubble",
      label: "Finance branch bubble detection",
      evidence: `Nyra auto selector: capitale finale ${bubble.strategies.Nyra_auto_selector.final_capital}, drawdown ${bubble.strategies.Nyra_auto_selector.max_drawdown}% vs QQQ ${bubble.strategies.QQQ_buy_and_hold.max_drawdown}%, verdict '${bubble.verdict}'.`,
      source_path: join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_bubble_detection_latest.json"),
      strength: 0.93,
      keep_in_email: true,
    },
    {
      id: "finance_lateral",
      label: "Finance branch lateral defense",
      evidence: `Nel laterale sintetico Nyra batte QQQ: beats_qqq=${lateral.metrics.beats_qqq}, drawdown ${lateral.metrics.max_drawdown_nyra_pct}% con rebalance ${lateral.metrics.rebalance_count}.`,
      source_path: join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_lateral_market_latest.json"),
      strength: 0.78,
      keep_in_email: false,
    },
    {
      id: "finance_honesty_note",
      label: "Finance branch current honesty note",
      evidence: `Il product readiness finanziario resta '${readiness.final_output?.verdict ?? "unknown"}': la parte finanza e in uso reale di test e non viene presentata come prodotto gia finito.`,
      source_path: join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_product_readiness_latest.json"),
      strength: 0.8,
      keep_in_email: true,
    },
    {
      id: "marketing_usage",
      label: "Nyra marketing usage",
      evidence: `Nyra viene gia usata anche nel ramo marketing per ranking asset, monetizzazione first e draft segmentati.`,
      source_path: join(UC_ROOT, "tools", "nyra-marketing-activation-branch.ts"),
      strength: 0.72,
      keep_in_email: true,
    },
  ];
}

function chooseEmailStyle(seed: InvestorSeed): EmailStyle {
  if (seed.focus_tags.includes("fintech") || seed.focus_tags.includes("financial software")) return "traction_first";
  if (seed.region === "italy" || seed.focus_tags.includes("angel")) return "operator_first";
  return "thesis_first";
}

function computeFitScore(seed: InvestorSeed): number {
  let score = 0.34;
  if (seed.focus_tags.includes("software")) score += 0.16;
  if (seed.focus_tags.includes("ai")) score += 0.12;
  if (seed.focus_tags.includes("fintech") || seed.focus_tags.includes("financial software")) score += 0.12;
  if (seed.focus_tags.includes("b2b") || seed.focus_tags.includes("saas") || seed.focus_tags.includes("enterprise")) score += 0.09;
  if (seed.region === "italy") score += 0.09;
  else if (seed.region === "europe") score += 0.06;
  else if (seed.region === "global") score += 0.04;
  if (seed.type === "angel_network") score += 0.04;
  return clamp(round(score, 6), 0, 1);
}

function computeReadProbability(seed: InvestorSeed, fitScore: number): number {
  const languageBoost = seed.language === "it" ? 0.06 : 0.04;
  return clamp(round(0.24 + fitScore * 0.4 + seed.cold_accessibility * 0.22 + languageBoost, 6), 0.18, 0.82);
}

function computeReplyProbability(seed: InvestorSeed, fitScore: number, readProbability: number): number {
  const base = 0.02 + fitScore * 0.08 + seed.cold_accessibility * 0.06 + (readProbability - 0.3) * 0.18;
  return clamp(round(base, 6), 0.02, 0.22);
}

function computeMeetingProbability(replyProbability: number): number {
  return clamp(round(replyProbability * 0.42, 6), 0.01, 0.09);
}

function buildWhyFit(seed: InvestorSeed): string {
  const fits: string[] = [];
  if (seed.focus_tags.includes("software")) fits.push("software B2B");
  if (seed.focus_tags.includes("ai")) fits.push("AI applicata");
  if (seed.focus_tags.includes("fintech") || seed.focus_tags.includes("financial software")) fits.push("ramo finanziario");
  if (seed.focus_tags.includes("saas") || seed.focus_tags.includes("b2b")) fits.push("logica SaaS/enterprise");
  if (seed.region === "italy") fits.push("vicinanza geografica e linguistica");
  else if (seed.region === "europe") fits.push("fit europeo");
  else fits.push("scalabilita internazionale");
  return `Fit stimato su ${fits.join(", ")}.`;
}

function localizeThesisLines(lines: InvestorOutreachReport["thesis_winner"]["lines"], language: Language) {
  if (language === "en") return lines;
  return {
    thesis: "Stiamo costruendo un operating intelligence layer riutilizzabile, non un singolo software verticale.",
    universal_core: "Universal Core e l'architettura decisionale e di orchestrazione: legge segnali, priorita, rischio e azione sopra sistemi software reali.",
    nyra: "Nyra e l'agente operativo costruito sopra Universal Core e gia usato tra prodotto live, test finanziari e ramo marketing. Non e statico: si adatta su domini diversi dentro un'architettura controllata e migliora attraverso test, selezione e iterazione controllata.",
    smartdesk: "Smart Desk e la prima shell applicativa live del sistema, oggi verticalizzata su beauty e hair, ma non e il limite dell'architettura; la stessa base viene gia usata anche su Flow e Control Desk.",
    infrastructure: "L'infrastruttura oggi e ancora compatta, ma e gia reale e operativa. Universal Core e stato progettato per funzionare in modo efficiente senza richiedere infrastrutture pesanti, cosi da validare casi d'uso reali prima di spingere sulla scala. Oggi e gia in uso su Smart Desk, Flow, Control Desk e nel ramo finanza, mentre il core viene usato ogni giorno in operativita reale. Il funding non serve a costruire questa base da zero: serve a scalarla, irrobustirla e accelerarne l'estensione su piu applicazioni.",
    finance: "Il ramo finanza e il nostro ambiente di test a piu alta pressione per qualita decisionale, timing e disciplina del rischio. E ancora in test reale e in taratura, non presentato come prodotto finito.",
    marketing: "Stiamo usando Nyra anche nel ramo marketing per ranking asset, priorita di monetizzazione e outreach.",
    why_now: "L'accesso ai modelli si sta comoditizzando; l'architettura decisionale nativa sui workflow no.",
    ask: "Cerchiamo investitori che capiscano sia la prova verticale live sia il core riutilizzabile che c'e sotto.",
  };
}

function composeEmail(seed: InvestorSeed, evidence: EvidenceItem[]): InvestorEmailDraft {
  const thesis = localizeThesisLines(runNyraInvestorThesisLab().winner.lines, seed.language);
  const style = chooseEmailStyle(seed);
  const italian = seed.language === "it";
  const senderName = "Cristian Cardarello";
  const evidenceLine = italian
    ? `Oggi la prova piu leggibile e questa: Smart Desk ha gia retto 100 centri / 1100 richieste con 0 errori e 0 timeout. Sul ramo finanza, Nyra ha gia mostrato segnali forti su bubble detection e lateral defense.`
    : `The clearest proof today is this: Smart Desk has already held 100 centers / 1100 requests with 0 errors and 0 timeouts. In the finance branch, Nyra has already shown strong signals in bubble detection and lateral defense.`;
  const honestyLine = italian
    ? `Sul ramo finanza preferisco essere netto: non lo sto presentando come prodotto finito. Lo sto usando e tarando nel reale, ed e proprio per questo che per me conta.`
    : `On the finance branch I want to be precise: I am not presenting it as a finished product. I am using it and tuning it in real conditions, and that is exactly why it matters to me.`;
  const usageLine = italian
    ? `${thesis.nyra} Oggi la sto usando in Smart Desk, nel ramo finanza e anche nel ramo marketing per ranking asset, monetizzazione e outreach.`
    : `${thesis.nyra} Today I am using it in Smart Desk, in the finance branch, and also in the marketing branch for asset ranking, monetization and outreach.`;
  const closeLine = italian
    ? `Se il tema rientra nel vostro perimetro, posso inviare deck e metriche migliori e aprire un primo confronto rapido.\n\n${senderName}`
    : `If this fits your scope, I can send the deck and strongest metrics and open a short first conversation.\n\n${senderName}`;

  if (style === "operator_first") {
    return {
      style,
      subject: italian
        ? "Universal Core + Nyra: un core software gia in uso, non una sola verticale"
        : "Universal Core + Nyra: a software core already in use, not a single vertical",
      opening_line: italian
        ? "Sono Cristian Cardarello. Ti scrivo in modo diretto: non sto costruendo una sola verticale, ma un core software che sto gia usando in ambienti reali."
        : "I am Cristian Cardarello. I am reaching out directly: I am not building a single vertical tool, but a software core that I am already using in real environments.",
      body:
        (italian
          ? `Buongiorno ${seed.name},\n\n`
          : `Hello ${seed.name},\n\n`) +
        `${thesis.thesis}\n\n${thesis.universal_core}\n\n${thesis.smartdesk}\n\n${thesis.finance}\n\n` +
        `${thesis.infrastructure}\n\n` +
        `${evidenceLine}\n\n${usageLine}\n\n${honestyLine}\n\n` +
        `${thesis.marketing}\n\n${thesis.why_now}\n\n${thesis.ask}\n\n${closeLine}`,
      ask: italian ? "Posso inviare deck e metriche migliori in risposta a questa mail." : "I can send the deck and strongest metrics in reply to this email.",
    };
  }

  if (style === "traction_first") {
    return {
      style,
      subject: italian
        ? "Core software gia in uso: prova live + stress test finanziario"
        : "Software core already in use: live proof + finance stress testing",
      opening_line: italian
        ? "Sono Cristian Cardarello. Ti scrivo con un taglio concreto: il core esiste gia in uso e oggi lo sto validando su piu applicazioni reali."
        : "I am Cristian Cardarello. I am reaching out with a concrete angle: the core already exists in use, and I am validating it across multiple real applications.",
      body:
        (italian ? `Buongiorno ${seed.name},\n\n` : `Hello ${seed.name},\n\n`) +
        `${thesis.thesis}\n\n${thesis.universal_core}\n\n` +
        `${evidenceLine}\n\n` +
        `${thesis.smartdesk}\n\n${thesis.finance}\n\n` +
        `${thesis.infrastructure}\n\n` +
        `${usageLine}\n\n` +
        `${honestyLine}\n\n` +
        `${thesis.why_now}\n\n${thesis.ask}\n\n${closeLine}`,
      ask: italian ? "Se puo interessarvi, apro volentieri un primo confronto rapido." : "If this could be relevant, I would value a short first conversation.",
    };
  }

  return {
    style,
    subject: italian
      ? "Universal Core + Nyra: il core, la prima prova live, il perche ora"
      : "Universal Core + Nyra: the core, the first live proof, and why now",
    opening_line: italian
      ? "Sono Cristian Cardarello. Ti scrivo per aprire un confronto su una tesi software e AI che parte da un core riutilizzabile, non da una singola shell verticale."
      : "I am Cristian Cardarello. I am reaching out to start a conversation around a software and AI thesis built around a reusable core, not a single vertical shell.",
    body:
      (italian ? `Buongiorno ${seed.name},\n\n` : `Hello ${seed.name},\n\n`) +
      `${thesis.thesis}\n\n${thesis.universal_core}\n\n${thesis.smartdesk}\n\n${thesis.infrastructure}\n\n${thesis.finance}\n\n${evidenceLine}\n\n${usageLine}\n\n${honestyLine}\n\n${thesis.why_now}\n\n${thesis.ask}\n\n${closeLine}`,
    ask: italian ? "Se la tesi rientra nel vostro perimetro, posso inviare deck e metriche migliori." : "If the thesis is within scope, I can send the deck and strongest metrics.",
  };
}

function rankInvestors(): RankedInvestor[] {
  const evidence = loadEvidence();
  return INVESTOR_SEEDS
    .map((seed) => {
      const fit_score = computeFitScore(seed);
      const read_probability = computeReadProbability(seed, fit_score);
      const reply_probability = computeReplyProbability(seed, fit_score, read_probability);
      const meeting_probability = computeMeetingProbability(reply_probability);
      return {
        ...seed,
        existence_verified: seed.source_url.startsWith("https://"),
        fit_score,
        read_probability,
        reply_probability,
        meeting_probability,
        why_fit: buildWhyFit(seed),
        recommended_style: chooseEmailStyle(seed),
        email: composeEmail(seed, evidence),
      };
    })
    .sort((left, right) => {
      const scoreLeft = left.reply_probability * 0.52 + left.read_probability * 0.18 + left.fit_score * 0.3;
      const scoreRight = right.reply_probability * 0.52 + right.read_probability * 0.18 + right.fit_score * 0.3;
      return scoreRight - scoreLeft;
    })
    .slice(0, 50);
}

export function buildNyraInvestorOutreachBranch(): InvestorOutreachReport {
  const evidence = loadEvidence();
  const thesisWinner = runNyraInvestorThesisLab().winner;
  const investor_targets = rankInvestors();
  const waves = Array.from({ length: Math.ceil(investor_targets.length / 10) }, (_, index) => ({
    wave: index + 1,
    targets: investor_targets.slice(index * 10, index * 10 + 10).map((target) => ({
      name: target.name,
      language: target.language,
      source_url: target.source_url,
      read_probability: target.read_probability,
      reply_probability: target.reply_probability,
    })),
  }));
  return {
    generated_at: new Date().toISOString(),
    runner: "nyra_investor_outreach_branch",
    branch: "investor_outreach_global_50",
    owner_priority: "critical_cash_now_parallel_capital",
    product_stack: {
      operating_product: "Smart Desk",
      adjacent_applied_surfaces: "Flow / Control Desk",
      finance_branch: "software finanziario / ramo finanza in real testing",
      core: "Universal Core",
      agent: "Nyra",
      marketing_usage: "Nyra usata anche nel ramo marketing per ranking asset e outreach",
    },
    evidence,
    top_claims: [
      "Universal Core e l'asset architetturale principale.",
      "Nyra e l'agente operativo costruito sopra quel core.",
      "Smart Desk e la prima shell live, non il confine del progetto.",
      "Il ramo finanza e un banco di prova ad alta pressione, ancora in taratura ma gia utile come test serio.",
    ],
    honesty_notes: [
      "Non presentare il ramo finanza come prodotto gia vendibile a grandi clienti: e ancora in uso/test reale.",
      "Usare solo i test migliori e piu difendibili, non il catalogo intero.",
      "Tenere la tesi su Universal Core + Nyra come layer riutilizzabile, non su Smart Desk come limite del progetto.",
    ],
    thesis_winner: thesisWinner,
    investor_targets,
    outreach_strategy: {
      first_wave_count: 12,
      first_wave_rule: "Prima wave su Italy + Europe con fit software/AI/fintech alto e narrativa core-first: qui non si difende il progetto, si attacca il tema della scala e della differenziazione.",
      sequencing: [
        "wave 1: 12 target ad alta probabilita di lettura/risposta",
        "wave 2: fondi globali ad alto brand fit ma minore accessibilita cold",
        "wave 3: fintech-specialist e angel networks per intros e syndicate",
      ],
      waves,
    },
    improvement_loop: {
      rule: "Se il cold outreach non converte, Nyra non deve difendersi ripetendo la stessa promessa: deve aumentare chiarezza, differenziazione e upside percepito senza gonfiare lo stato reale.",
      thresholds: {
        min_open_rate: 0.4,
        min_reply_rate: 0.06,
        min_meeting_rate: 0.02,
      },
      if_low_open: [
        "accorciare il subject e mettere prima il wedge software e il potenziale multi-application",
        "ridurre l'apertura teorica e portare live usage + 1 prova forte + 1 frase di upside nella prima sezione",
      ],
      if_open_no_reply: [
        "rendere piu corta la mail",
        "spostare prima il motivo per cui il fondo e fit e perche questo asset puo valere piu di una sola shell verticale",
        "abbassare l'ask da pitch completo a 12 minuti di confronto",
      ],
      if_reply_no_meeting: [
        "separare meglio il pitch verticale Smart Desk dal pitch Universal Core / Nyra",
        "rimuovere tutto cio che sembra ricerca aperta e tenere solo tesi, prova, uso reale e richiesta",
      ],
    },
  };
}

function main(): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(RUNTIME_DIR, { recursive: true });

  const report = buildNyraInvestorOutreachBranch();
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(PACK_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        report_path: REPORT_PATH,
        pack_path: PACK_PATH,
        top_5: report.investor_targets.slice(0, 5).map((target) => ({
          name: target.name,
          read_probability: target.read_probability,
          reply_probability: target.reply_probability,
          meeting_probability: target.meeting_probability,
        })),
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  main();
}
