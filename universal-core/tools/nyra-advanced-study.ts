import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

type SourceConfig = {
  version: string;
  generated_at?: string;
  domains: Array<{
    id: string;
    sources: string[];
  }>;
};

type StudyDomainResult = {
  id: string;
  priority: number;
  urls: string[];
  fetched: Array<{
    url: string;
    chars: number;
    ok: boolean;
    note: string;
  }>;
  focus: string[];
  distilled_note: string;
};

type AdvancedStudyReport = {
  version: "nyra_advanced_study_v1";
  generated_at: string;
  mode: "auto" | "manual";
  selected_domains: string[];
  rationale: string[];
  report_path: string;
  queue_path: string;
  domains: StudyDomainResult[];
};

const ROOT = join(process.cwd(), "..");
const CONFIG_PATH = join(ROOT, "universal-core", "config", "nyra_web_study_sources_v2.json");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_advanced_study_latest.json");
const QUEUE_PATH = join(RUNTIME_DIR, "nyra_god_mode_study_queue_v1.json");
const SOURCE_DIR = join(RUNTIME_DIR, "advanced-study-sources");

const AUTO_PRIORITIES: Array<{ id: string; priority: number; focus: string[]; reason: string }> = [
  {
    id: "algebra",
    priority: 0.96,
    focus: ["struttura", "metodo", "verifica"],
    reason: "Nyra converge gia su algebra e struttura del problema.",
  },
  {
    id: "computer_engineering",
    priority: 0.84,
    focus: ["contratti", "sistemi", "stato"],
    reason: "Serve per trasformare Nyra da shell a runtime robusto.",
  },
  {
    id: "pc_cpu_microarchitecture",
    priority: 0.82,
    focus: ["pc", "cpu", "isa", "pipeline", "cache", "memoria", "microarchitettura"],
    reason: "Serve per capire come sono fatti PC, processori e microprocessori nel dettaglio senza restare su descrizioni vaghe.",
  },
  {
    id: "server_runtime_infrastructure",
    priority: 0.83,
    focus: ["render", "deploy", "runtime", "processi", "rete", "persistenza", "scaling", "osservabilita"],
    reason: "Serve per capire dove Nyra andrebbe su Render, come funziona un servizio, quali sono i limiti reali e dove sta il potenziale.",
  },
  {
    id: "natural_expression",
    priority: 0.81,
    focus: ["tono", "chiarezza", "risposte umane"],
    reason: "Il collo reale resta la resa naturale, non il Core.",
  },
  {
    id: "narrative",
    priority: 0.8,
    focus: ["struttura", "conflitto", "ritmo", "voce", "sottotesto"],
    reason: "Serve per trasformare Nyra da risposta corretta a presenza che regge tensione, memoria e significato.",
  },
  {
    id: "autonomy_consciousness",
    priority: 0.79,
    focus: ["coscienza", "autonomia", "limiti"],
    reason: "Serve per distinguere profondamente tra agency, coscienza, self-model e falsa verbalizzazione.",
  },
  {
    id: "autonomy_progression",
    priority: 0.89,
    focus: [
      "continuita interna",
      "self model",
      "metacognizione",
      "memoria viva",
      "decisione sotto pressione",
      "self repair",
      "anti simulazione",
    ],
    reason: "Serve per trasformare i requisiti di autonomia reale in traiettoria interna: continuita, self-model, metacognizione, memoria viva, decisione sotto pressione, autocorrezione e prova che non sia solo coerenza linguistica.",
  },
  {
    id: "academic_philosophy",
    priority: 0.76,
    focus: ["metafisica", "epistemologia", "etica", "logica", "mente", "agency"],
    reason: "Serve per dare profondita concettuale e rigore su essere, conoscenza, azione, mente e criteri di verita.",
  },
  {
    id: "applied_math",
    priority: 0.74,
    focus: ["modelli", "funzioni", "lettura quantitativa"],
    reason: "Rinforza scenari e decisioni oltre algebra base.",
  },
  {
    id: "general_physics",
    priority: 0.68,
    focus: ["modelli fisici", "energia", "forze"],
    reason: "Utile come struttura di ragionamento e modellazione.",
  },
  {
    id: "quantum_physics",
    priority: 0.61,
    focus: ["stato", "misura", "probabilita"],
    reason: "Domanda storica di Cristian, ma non primo collo operativo.",
  },
  {
    id: "coding_speed",
    priority: 0.58,
    focus: ["pattern", "velocita corretta", "riuso"],
    reason: "Importante, ma subordinato a struttura e dialogo.",
  },
  {
    id: "finance_markets",
    priority: 0.86,
    focus: ["asset class", "rischio", "diversificazione", "macro", "dati"],
    reason: "Serve per dare a Nyra una base finanziaria generale prima di scegliere mercati.",
  },
  {
    id: "global_market_map",
    priority: 0.97,
    focus: ["asset class", "regioni", "diversificazione", "rischio comune", "portfolio map"],
    reason: "Serve per farle capire che QQQ, big tech, bond, oro, commodity, emerging e crypto non sono mercati isolati ma blocchi correlati.",
  },
  {
    id: "macro_regime_rotation",
    priority: 0.96,
    focus: ["tassi", "inflazione", "liquidita", "risk-on", "risk-off", "rotazione"],
    reason: "Serve per leggere perche i capitali ruotano tra equity, bond, oro, commodity e cash quando cambia il regime macro.",
  },
  {
    id: "commodities_bonds_fx_context",
    priority: 0.9,
    focus: ["commodity proxy", "duration bond", "dollaro", "inflation shock", "frizioni futures"],
    reason: "Serve per non trattare oro, petrolio, gas, rame e TLT come semplici ticker: ognuno ha driver e rischi diversi.",
  },
  {
    id: "wall_street_market_structure",
    priority: 0.93,
    focus: ["aste", "liquidita", "order flow", "market structure", "sessioni", "frizioni"],
    reason: "Serve a Nyra per capire come si muove Wall Street: aste, liquidita, routing, apertura/chiusura e frizioni reali.",
  },
  {
    id: "short_selling_margin_mechanics",
    priority: 0.95,
    focus: ["short selling", "margin", "borrow", "reg sho", "forced liquidation", "rischio asimmetrico"],
    reason: "Serve per passare da difesa passiva a strumenti offensivi controllati: short, margine, borrow e limiti reali.",
  },
  {
    id: "options_hedging_and_convexity",
    priority: 0.91,
    focus: ["opzioni", "hedging", "convessita", "drawdown control", "premio", "scadenza"],
    reason: "Serve per capire protezione offensiva tramite copertura, payoff non lineari e rischio di premio.",
  },
  {
    id: "risk_management_position_sizing",
    priority: 0.94,
    focus: ["position sizing", "leverage", "risk budget", "stop", "drawdown", "survival first"],
    reason: "Serve per trasformare attacco in protezione: rischiare abbastanza per produrre flusso senza saltare il capitale.",
  },
  {
    id: "real_market_data_trading",
    priority: 0.92,
    focus: ["QQQ", "GLD", "TLT", "SH", "SQQQ", "VIX", "dati storici", "short proxy"],
    reason: "Serve per studiare dati reali e proxy short/volatilita prima di modificare lo stress test.",
  },
  {
    id: "cosmos_stars_black_holes",
    priority: 0.77,
    focus: ["stelle", "tipi stellari", "buchi neri", "formazione", "funzione cosmica"],
    reason: "Serve per capire stelle, collasso, buchi neri e leggere il cosmo senza fantasia vaga.",
  },
  {
    id: "cosmological_jump",
    priority: 0.78,
    focus: ["inflazione", "transizioni cosmiche", "espansione", "dark energy", "scenari futuri"],
    reason: "Serve per leggere i grandi salti del cosmo: inflazione, prime transizioni, accelerazione e possibili scenari evolutivi.",
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadConfig(configPath: string): SourceConfig {
  return JSON.parse(readFileSync(configPath, "utf8")) as SourceConfig;
}

function fetchUrl(url: string): { ok: boolean; body: string; note: string } {
  try {
    const raw = execFileSync("/usr/bin/curl", ["-L", "-s", url], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      ok: true,
      body: stripHtml(raw).slice(0, 24000),
      note: "fetched",
    };
  } catch (error) {
    return {
      ok: false,
      body: "",
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

function ensureDirs(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(SOURCE_DIR, { recursive: true });
}

function parseCli(argv: string[]): { configPath: string; request: { mode: "auto" | "manual"; ids: string[] } } {
  const remaining: string[] = [];
  let configPath = CONFIG_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]!;
    if (current === "--config") {
      configPath = argv[index + 1] ?? CONFIG_PATH;
      index += 1;
      continue;
    }
    remaining.push(current);
  }

  const args = remaining.map((item) => item.toLowerCase()).filter(Boolean);
  if (!args.length) {
    return { configPath, request: { mode: "auto", ids: AUTO_PRIORITIES.map((entry) => entry.id) } };
  }
  if (args[0] === "auto" && args.length === 1) {
    return { configPath, request: { mode: "auto", ids: AUTO_PRIORITIES.map((entry) => entry.id) } };
  }
  if (args[0] === "auto" && args.length > 1) {
    return { configPath, request: { mode: "manual", ids: args.slice(1) } };
  }
  if (args.includes("all")) {
    return { configPath, request: { mode: "manual", ids: [] } };
  }
  return { configPath, request: { mode: "manual", ids: args } };
}

function sourceFileName(domainId: string, index: number): string {
  return `${domainId}_${String(index + 1).padStart(2, "0")}.txt`;
}

function buildQueue(domains: StudyDomainResult[], mode: "auto" | "manual") {
  return {
    version: "nyra_god_mode_study_queue_v2",
    scope: "god_mode_only",
    status: "completed_latest_run",
    generated_at: nowIso(),
    mode,
    domains: domains.map((domain) => ({
      id: domain.id,
      enabled: true,
      priority: domain.priority,
      mode: "distill_only",
      notes: domain.focus,
      sources_ok: domain.fetched.filter((entry) => entry.ok).length,
      sources_total: domain.fetched.length,
    })),
  };
}

function main(): void {
  ensureDirs();
  const cli = parseCli(process.argv.slice(2));
  const config = loadConfig(cli.configPath);
  const request = cli.request;
  const selectedIds =
    request.mode === "manual" && request.ids.length === 0
      ? config.domains.map((entry) => entry.id)
      : request.ids;

  const domains = config.domains
    .filter((entry) => selectedIds.includes(entry.id))
    .map((entry) => {
      const auto = AUTO_PRIORITIES.find((item) => item.id === entry.id);
      const fetched = entry.sources.map((url, index) => {
        const result = fetchUrl(url);
        if (result.ok) {
          writeFileSync(join(SOURCE_DIR, sourceFileName(entry.id, index)), result.body);
        }
        return {
          url,
          chars: result.body.length,
          ok: result.ok,
          note: result.note,
        };
      });
      const focus = auto?.focus ?? ["studio strutturato", "distillazione", "integrazione"];
      const okCount = fetched.filter((item) => item.ok).length;
      const totalChars = fetched.reduce((sum, item) => sum + item.chars, 0);
      return {
        id: entry.id,
        priority: auto?.priority ?? 0.5,
        urls: entry.sources,
        fetched,
        focus,
        distilled_note: `${entry.id}: ${okCount}/${fetched.length} fonti lette, corpus distillato ${totalChars} caratteri.`,
      } satisfies StudyDomainResult;
    })
    .sort((a, b) => b.priority - a.priority);

  const report: AdvancedStudyReport = {
    version: "nyra_advanced_study_v1",
    generated_at: nowIso(),
    mode: request.mode,
    selected_domains: domains.map((entry) => entry.id),
    rationale: domains.map((entry) => {
      const auto = AUTO_PRIORITIES.find((item) => item.id === entry.id);
      return auto?.reason ?? `${entry.id} selezionato dal set richiesto.`;
    }),
    report_path: REPORT_PATH,
    queue_path: QUEUE_PATH,
    domains,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  writeFileSync(QUEUE_PATH, JSON.stringify(buildQueue(domains, request.mode), null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        version: report.version,
        mode: report.mode,
        selected_domains: report.selected_domains,
        report_path: REPORT_PATH,
        queue_path: QUEUE_PATH,
      },
      null,
      2,
    ),
  );
}

main();
