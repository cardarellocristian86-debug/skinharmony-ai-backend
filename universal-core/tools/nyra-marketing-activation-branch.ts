import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type AssetId = "smart_desk" | "skin_pro" | "o3_system";
type CommercialLaneId =
  | "hairdressers_it"
  | "beauticians_it"
  | "distributors_it"
  | "distributors_global"
  | "investors_it"
  | "investors_global";
type Language = "it" | "en";

type AssetProfile = {
  id: AssetId;
  label: string;
  positioning: string;
  cash_speed: number;
  close_probability: number;
  sales_effort: number;
  strategic_value: number;
  ideal_for: CommercialLaneId[];
};

type RankedAsset = AssetProfile & {
  score: number;
  rank: number;
};

type InvestorTarget = {
  name: string;
  country: string;
  language: Language;
  stage_focus: string;
  focus: string;
  source_url: string;
  why_fit: string;
};

type EmailDraft = {
  lane: CommercialLaneId;
  language: Language;
  audience: string;
  asset_priority: AssetId[];
  subject: string;
  opening_line: string;
  body: string;
  ask: string;
};

type LanePlan = {
  id: CommercialLaneId;
  language: Language;
  audience: string;
  priority: number;
  goal: string;
  why_now: string;
  primary_asset: AssetId;
  secondary_assets: AssetId[];
  email: EmailDraft;
};

type PitchSummary = {
  headline: string;
  problem: string;
  products: string[];
  why_now: string;
  wedge: string;
  moat: string;
  ask: string;
};

type MarketingActivationBranchReport = {
  generated_at: string;
  runner: string;
  branch: string;
  owner_danger_priority: "critical_cash_now";
  strategy: {
    rule: string;
    first_move: string;
    second_move: string;
    third_move: string;
  };
  assets_ranked: RankedAsset[];
  lane_plan: LanePlan[];
  investor_targets: InvestorTarget[];
  investor_pitch: PitchSummary;
  notes: string[];
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const UC_ROOT = join(ROOT, "universal-core");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "business");
const RUNTIME_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const REPORT_PATH = join(REPORT_DIR, "nyra_marketing_activation_branch_latest.json");
const PACK_PATH = join(RUNTIME_DIR, "nyra_marketing_activation_branch_latest.json");

const ASSETS: AssetProfile[] = [
  {
    id: "smart_desk",
    label: "Smart Desk",
    positioning: "centro operativo intelligente per saloni e centri estetici",
    cash_speed: 0.86,
    close_probability: 0.74,
    sales_effort: 0.48,
    strategic_value: 0.96,
    ideal_for: ["hairdressers_it", "beauticians_it", "distributors_it", "investors_it", "investors_global"],
  },
  {
    id: "skin_pro",
    label: "Skin Pro",
    positioning: "ecosistema premium per metodo, protocolli e attivazione commerciale",
    cash_speed: 0.7,
    close_probability: 0.66,
    sales_effort: 0.46,
    strategic_value: 0.78,
    ideal_for: ["beauticians_it", "hairdressers_it", "distributors_it", "distributors_global"],
  },
  {
    id: "o3_system",
    label: "O3 System",
    positioning: "sistema premium adatto a partnership e distribuzione strutturata",
    cash_speed: 0.56,
    close_probability: 0.49,
    sales_effort: 0.63,
    strategic_value: 0.84,
    ideal_for: ["distributors_it", "distributors_global", "investors_it", "investors_global"],
  },
];

const INVESTOR_TARGETS: InvestorTarget[] = [
  {
    name: "CDP Venture Capital",
    country: "Italy",
    language: "it",
    stage_focus: "venture capital / fondi strategici",
    focus: "settori strategici per la crescita dell'Italia",
    source_url: "https://www.cdpventurecapital.it/",
    why_fit: "utile per un progetto software/AI con ambizione industriale italiana e forte componente tecnologica.",
  },
  {
    name: "United Ventures",
    country: "Italy",
    language: "it",
    stage_focus: "venture capital early stage / growth tech",
    focus: "supporta imprenditori che reinventano industrie attraverso la tecnologia",
    source_url: "https://unitedventures.com/",
    why_fit: "fit alto per software, AI decision layer e prodotti B2B con wedge operativo chiaro.",
  },
  {
    name: "Seedcamp",
    country: "United Kingdom",
    language: "en",
    stage_focus: "seed",
    focus: "software-first, sector agnostic, Europe and Israel focus",
    source_url: "https://seedcamp.com/faqs/",
    why_fit: "fit buono per stack software + AI con ambizione europea e posizionamento software-first.",
  },
  {
    name: "Speedinvest",
    country: "Austria / Europe",
    language: "en",
    stage_focus: "pre-seed to growth",
    focus: "sector teams across AI & Infra, Fintech & DeFi, SaaS & Infra, Europe and beyond",
    source_url: "https://speedinvest.com/how-we-work",
    why_fit: "fit alto per combinazione fintech/software gestionale/AI infrastructure e go-to-market europeo.",
  },
  {
    name: "Antler",
    country: "Global",
    language: "en",
    stage_focus: "day zero / early-stage",
    focus: "global early-stage investing with validation and founder support",
    source_url: "https://www.antler.co/press-releases/fact-sheet",
    why_fit: "utile se serve investitore molto early con raggio internazionale e appetito per costruzione venture.",
  },
];

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scoreAsset(asset: AssetProfile): number {
  return round(
    asset.cash_speed * 0.38 +
      asset.close_probability * 0.34 +
      (1 - asset.sales_effort) * 0.18 +
      asset.strategic_value * 0.1,
    6,
  );
}

function rankAssets(): RankedAsset[] {
  return [...ASSETS]
    .map((asset) => ({ ...asset, score: scoreAsset(asset), rank: 0 }))
    .sort((left, right) => right.score - left.score)
    .map((asset, index) => ({ ...asset, rank: index + 1 }));
}

function composeCommercialEmail(
  lane: CommercialLaneId,
  language: Language,
  audience: string,
  assetPriority: AssetId[],
): EmailDraft {
  const primary = ASSETS.find((asset) => asset.id === assetPriority[0])!;
  const secondary = ASSETS.find((asset) => asset.id === assetPriority[1] ?? assetPriority[0])!;

  if (lane === "hairdressers_it") {
    return {
      lane,
      language,
      audience,
      asset_priority: assetPriority,
      subject: "Una proposta concreta per far lavorare meglio il tuo salone",
      opening_line: "Ti scrivo per capire se ha senso mostrarti una soluzione concreta, non teorica.",
      body:
        `Ciao,\n\n` +
        `sto aprendo un piccolo gruppo di contatti per ${primary.label}, un sistema pensato per dare piu controllo operativo al salone senza appesantire il lavoro quotidiano.\n\n` +
        `L'obiettivo non e raccontare tecnologia: e aiutare un salone a vedere meglio agenda, clienti, priorita e azioni che spostano davvero il lavoro. Se per te ha senso, posso farti vedere anche come ${secondary.label} puo affiancare il posizionamento premium e la continuita commerciale.\n\n` +
        `Se ti interessa, ti propongo una call breve o una demo mirata sul tuo contesto reale.`,
      ask: "Ti va di fissare 15 minuti questa settimana?",
    };
  }

  if (lane === "beauticians_it") {
    return {
      lane,
      language,
      audience,
      asset_priority: assetPriority,
      subject: "Per il tuo centro: piu continuita, piu controllo, meno dispersione",
      opening_line: "Ti scrivo con una proposta pratica, non con una mail generica.",
      body:
        `Ciao,\n\n` +
        `${primary.label} nasce per aiutare un centro a lavorare con piu ordine operativo, piu lettura delle priorita e piu continuita sui clienti. In parallelo, ${secondary.label} puo supportare metodo, protocolli e posizionamento in modo piu chiaro e premium.\n\n` +
        `Non sto facendo promesse astratte e non ti scrivo per venderti una piattaforma da guardare e basta. Ti scrivo per capire se oggi hai un collo su agenda, ritorno clienti, operativita o comunicazione commerciale, e se ha senso mostrarti una soluzione coerente con quel collo.\n\n` +
        `Se vuoi, preparo una demo breve centrata solo sul tuo caso.`,
      ask: "Se ti va, rispondi con il punto che oggi ti pesa di piu e ti propongo il taglio giusto.",
    };
  }

  if (lane === "distributors_it") {
    return {
      lane,
      language,
      audience,
      asset_priority: assetPriority,
      subject: "Valutiamo una collaborazione commerciale su un ecosistema beauty premium",
      opening_line: "Ti contatto per capire se ha senso aprire una conversazione commerciale seria.",
      body:
        `Buongiorno,\n\n` +
        `stiamo strutturando un ecosistema composto da ${primary.label}, ${secondary.label} e Smart Desk, con l'obiettivo di unire prodotto, metodo e controllo operativo in una proposta piu forte per il centro.\n\n` +
        `Per noi non avrebbe senso una distribuzione generica. Ci interessa capire se nel vostro canale c'e spazio per una proposta premium con logica di ecosistema, non solo di listino.\n\n` +
        `Se c'e interesse, possiamo condividere un one-pager serio e allineare subito criteri di fit, tempi e modalita di collaborazione.`,
      ask: "Se ha senso approfondire, possiamo sentirci per un confronto iniziale?",
    };
  }

  if (lane === "distributors_global") {
    return {
      lane,
      language,
      audience,
      asset_priority: assetPriority,
      subject: "Potential distribution partnership for a premium beauty operating ecosystem",
      opening_line: "I am reaching out to explore whether there is a real commercial fit, not to send a generic pitch.",
      body:
        `Hello,\n\n` +
        `we are building a premium beauty ecosystem combining ${primary.label}, ${secondary.label} and Smart Desk into one stronger commercial proposition for clinics, salons and beauty operators.\n\n` +
        `We are not looking for broad, undifferentiated distribution. We are looking for partners able to position a premium operating ecosystem with method, software and commercial continuity.\n\n` +
        `If there is a fit on your side, I can send a concise one-pager and align on target market, channel logic and first commercial steps.`,
      ask: "Would you be open to a short introductory call next week?",
    };
  }

  if (lane === "investors_it") {
    return {
      lane,
      language,
      audience,
      asset_priority: assetPriority,
      subject: "SkinHarmony / Universal Core / Nyra: richiesta confronto investitore",
      opening_line: "Ti scrivo per aprire un confronto serio su un progetto software e AI con ambizione industriale.",
      body:
        `Buongiorno,\n\n` +
        `sto costruendo un ecosistema che unisce tre livelli: software operativo verticale (Smart Desk), sistema finanziario/decisionale, e layer proprietario di orchestrazione e intelligenza (Universal Core + Nyra).\n\n` +
        `La tesi non e un chatbot generico: e trasformare dati operativi, priorita e decisioni in un sistema di lavoro piu leggibile, piu modulare e piu monetizzabile per mercati reali.\n\n` +
        `Oggi stiamo cercando confronto con investitori che capiscano software B2B, AI applicata e possibilita di estensione su piu verticali. Se il tema puo essere nel vostro perimetro, posso inviare un pitch deck sintetico e aprire una call introduttiva.`,
      ask: "Se puo avere senso per voi, posso inviare deck e nota strategica in risposta a questa mail.",
    };
  }

  return {
    lane,
    language,
    audience,
    asset_priority: assetPriority,
    subject: "SkinHarmony / Universal Core / Nyra: investor conversation",
    opening_line: "I am reaching out to open a serious investor conversation around a software and AI operating stack.",
    body:
      `Hello,\n\n` +
      `we are building a layered software business that combines a vertical operating system for beauty businesses (Smart Desk), a financial/decision software direction, and a proprietary orchestration and intelligence layer (Universal Core + Nyra).\n\n` +
      `The thesis is not a generic AI assistant. The thesis is a modular decision and operating layer that can turn operational data, prioritisation and action guidance into real workflow leverage across different verticals.\n\n` +
      `We are now looking for investors who understand B2B software, applied AI and the value of a reusable operating core beneath multiple products. If this is within scope, I can share a concise pitch deck and a short strategic note.`,
    ask: "If relevant, I would value a short introductory conversation.",
  };
}

function lanePriority(id: CommercialLaneId): number {
  switch (id) {
    case "hairdressers_it":
      return 100;
    case "beauticians_it":
      return 98;
    case "distributors_it":
      return 86;
    case "distributors_global":
      return 79;
    case "investors_it":
      return 74;
    case "investors_global":
      return 72;
  }
}

function buildLanePlan(): LanePlan[] {
  const plans: Array<Omit<LanePlan, "priority" | "email">> = [
    {
      id: "hairdressers_it",
      language: "it",
      audience: "parrucchieri",
      goal: "chiudere demo e primi pilot veloci",
      why_now: "leva piu rapida per cassa vicina",
      primary_asset: "smart_desk",
      secondary_assets: ["skin_pro"],
    },
    {
      id: "beauticians_it",
      language: "it",
      audience: "estetiste",
      goal: "aprire demo premium e conversione su ecosistema",
      why_now: "segmento con fit naturale su metodo e continuita",
      primary_asset: "smart_desk",
      secondary_assets: ["skin_pro", "o3_system"],
    },
    {
      id: "distributors_it",
      language: "it",
      audience: "distributori italiani",
      goal: "capire fit di partnership e canale",
      why_now: "moltiplica reach senza spostare tutta la cassa sul fundraising",
      primary_asset: "o3_system",
      secondary_assets: ["skin_pro", "smart_desk"],
    },
    {
      id: "distributors_global",
      language: "en",
      audience: "international distributors",
      goal: "aprire partnership cross-border",
      why_now: "espansione piu lenta ma scalabile",
      primary_asset: "o3_system",
      secondary_assets: ["smart_desk", "skin_pro"],
    },
    {
      id: "investors_it",
      language: "it",
      audience: "investitori italiani",
      goal: "aprire conversazioni su stack software + AI",
      why_now: "serve preparare capitale e credibilita in parallelo alla monetizzazione diretta",
      primary_asset: "smart_desk",
      secondary_assets: ["o3_system", "skin_pro"],
    },
    {
      id: "investors_global",
      language: "en",
      audience: "global investors",
      goal: "aprire pipeline internazionale per round o partnership strategiche",
      why_now: "Universal Core e Nyra hanno taglio piu esportabile del solo verticale beauty",
      primary_asset: "smart_desk",
      secondary_assets: ["o3_system", "skin_pro"],
    },
  ];

  return plans
    .map((plan) => {
      const assetPriority = [plan.primary_asset, ...plan.secondary_assets];
      return {
        ...plan,
        priority: lanePriority(plan.id),
        email: composeCommercialEmail(plan.id, plan.language, plan.audience, assetPriority),
      };
    })
    .sort((left, right) => right.priority - left.priority);
}

function buildInvestorPitch(): PitchSummary {
  return {
    headline: "A modular operating and decision stack for real-world businesses.",
    problem:
      "Most SMB and vertical operators still run on fragmented software, weak prioritisation and low decision support. The result is wasted time, weak continuity and poor monetisation discipline.",
    products: [
      "Smart Desk: vertical operating system for beauty businesses.",
      "Financial software direction: capital, risk and decision discipline layer.",
      "Universal Core + Nyra: reusable orchestration and intelligence layer.",
    ],
    why_now:
      "AI is becoming cheap to access but still weak when it is not tied to real workflows, decision logic and monetisation pressure. The gap is no longer model access. The gap is operational integration.",
    wedge:
      "Start with a vertical where operational pain is concrete, prove monetisation and workflow value, then extend the same decision core into adjacent software products.",
    moat:
      "Shared decision architecture, reusable operating logic, product-specific shells and a growing semantic/action layer tied to real tasks instead of generic chat.",
    ask:
      "Commercial introductions, pilot conversations and investor discussions with people who understand B2B software, applied AI and modular product expansion.",
  };
}

export function buildNyraMarketingActivationBranch(): MarketingActivationBranchReport {
  return {
    generated_at: new Date().toISOString(),
    runner: "nyra_marketing_activation_branch",
    branch: "owner_danger_monetization_first",
    owner_danger_priority: "critical_cash_now",
    strategy: {
      rule: "Prima cassa vicina, poi partnership, poi capitale.",
      first_move: "contatto diretto a parrucchieri ed estetiste per demo/pilot",
      second_move: "outreach mirato a distributori con proposta ecosistema",
      third_move: "investor outreach serio in Italia e all'estero con deck e nota strategica",
    },
    assets_ranked: rankAssets(),
    lane_plan: buildLanePlan(),
    investor_targets: INVESTOR_TARGETS,
    investor_pitch: buildInvestorPitch(),
    notes: [
      "nessun prezzo inserito: mancano listini confermati per ogni proposta commerciale",
      "nessuna promessa medica o terapeutica",
      "lingua italiana per Italia, inglese per estero",
      "fundraising tenuto in parallelo, ma non come prima leva di sopravvivenza",
    ],
  };
}

function main(): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(RUNTIME_DIR, { recursive: true });

  const report = buildNyraMarketingActivationBranch();
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(PACK_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report_path: REPORT_PATH, pack_path: PACK_PATH, top_lane: report.lane_plan[0], top_asset: report.assets_ranked[0] }, null, 2));
}

if (import.meta.main) {
  main();
}
