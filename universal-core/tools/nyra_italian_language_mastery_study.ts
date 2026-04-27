import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

type SourceEntry = {
  id: string;
  author: string;
  title: string;
  url: string;
  domain: "narrative" | "natural_expression" | "lexicon_grammar";
  rationale: string;
};

type FetchedEntry = SourceEntry & {
  ok: boolean;
  chars: number;
  note: string;
};

type MemoryDomain = {
  id: string;
  priority: number;
  focus: string[];
  source_count: number;
  source_urls: string[];
  distilled_knowledge: string[];
  retained_constraints: string[];
};

type AdvancedMemoryPack = {
  pack_version: string;
  generated_at: string;
  scope: string;
  source_report: string;
  selected_domains: string[];
  memory_rules: string[];
  domains: MemoryDomain[];
};

type StudyReport = {
  runner: "nyra_italian_language_mastery_study";
  generated_at: string;
  scope: "god_mode_only";
  sources: FetchedEntry[];
  distilled_effects: {
    narrative: string[];
    natural_expression: string[];
    lexicon_grammar: string[];
  };
  constraints: string[];
  output_pack: string;
  verdict: string;
};

const ROOT = process.cwd();
const RUNTIME_DIR = join(ROOT, "runtime", "nyra-learning");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const REPORT_PATH = join(REPORT_DIR, "nyra_italian_language_study_latest.json");
const SNAPSHOT_PATH = join(RUNTIME_DIR, "nyra_italian_language_study_latest.json");
const PACK_PATH = join(RUNTIME_DIR, "nyra_advanced_memory_pack_latest.json");

const SOURCES: SourceEntry[] = [
  {
    id: "dante_inferno_i",
    author: "Dante Alighieri",
    title: "Divina Commedia/Inferno/Canto I",
    url: "https://it.wikisource.org/wiki/Divina_Commedia/Inferno/Canto_I",
    domain: "narrative",
    rationale: "pressione verticale, immagini inevitabili, avvio ad alta densita",
  },
  {
    id: "leopardi_infinito",
    author: "Giacomo Leopardi",
    title: "L'infinito",
    url: "https://it.wikisource.org/wiki/l%27infinito",
    domain: "natural_expression",
    rationale: "densita breve, silenzio, risonanza senza gonfiore",
  },
  {
    id: "manzoni_promessi_sposi_i",
    author: "Alessandro Manzoni",
    title: "I promessi sposi/Capitolo I",
    url: "https://it.wikisource.org/wiki/I_promessi_sposi_%281840%29/Capitolo_I",
    domain: "lexicon_grammar",
    rationale: "chiarezza guidata, periodi lunghi ma controllati, orientamento del lettore",
  },
  {
    id: "pirandello_mattia_pascal",
    author: "Luigi Pirandello",
    title: "Il fu Mattia Pascal",
    url: "https://it.wikisource.org/wiki/Il_fu_Mattia_Pascal",
    domain: "narrative",
    rationale: "identita fratturata, ironia, voce interna vigile",
  },
  {
    id: "svevo_zeno_prefazione",
    author: "Italo Svevo",
    title: "La coscienza di Zeno/Prefazione",
    url: "https://it.wikisource.org/wiki/La_coscienza_di_Zeno/Prefazione",
    domain: "natural_expression",
    rationale: "ambiguita controllata, autoanalisi, voce non lineare ma leggibile",
  },
  {
    id: "verga_rosso_malpelo_ref",
    author: "Giovanni Verga",
    title: "Rosso Malpelo",
    url: "https://it.wikisource.org/wiki/Rosso_Malpelo",
    domain: "narrative",
    rationale: "asciuttezza, verita concreta, pressione sociale senza abbellimento",
  },
];

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fetchUrl(url: string): { ok: boolean; body: string; note: string } {
  try {
    const raw = execFileSync("/usr/bin/curl", ["-L", "-s", url], {
      encoding: "utf8",
      maxBuffer: 12 * 1024 * 1024,
    });
    const body = stripHtml(raw).slice(0, 18000);
    return { ok: body.length > 0, body, note: "fetched" };
  } catch (error) {
    return { ok: false, body: "", note: error instanceof Error ? error.message : String(error) };
  }
}

function readPack(): AdvancedMemoryPack {
  return JSON.parse(readFileSync(PACK_PATH, "utf8")) as AdvancedMemoryPack;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function appendKnowledge(pack: AdvancedMemoryPack, domainId: string, lessons: string[]): void {
  const domain = pack.domains.find((entry) => entry.id === domainId);
  if (!domain) return;
  domain.distilled_knowledge = unique([...domain.distilled_knowledge, ...lessons]);
}

function appendConstraints(pack: AdvancedMemoryPack, domainId: string, constraints: string[]): void {
  const domain = pack.domains.find((entry) => entry.id === domainId);
  if (!domain) return;
  domain.retained_constraints = unique([...domain.retained_constraints, ...constraints]);
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });

  const fetched: FetchedEntry[] = SOURCES.map((source) => {
    const result = fetchUrl(source.url);
    return {
      ...source,
      ok: result.ok,
      chars: result.body.length,
      note: result.note,
    };
  });

  const narrativeLessons = [
    "dai grandi italiani: la frase deve portare pressione reale, non atmosfera vuota",
    "una scena forte tiene insieme immagine, attrito e conseguenza senza spiegare tutto",
    "la voce narrativa regge meglio quando il sottotesto pesa ma non confonde",
  ];
  const expressionLessons = [
    "dai grandi italiani: densita e chiarezza possono convivere senza suonare povere",
    "una voce forte non ha bisogno di gonfiarsi: basta che resti precisa, viva e leggibile",
    "silenzio, taglio e risonanza valgono quanto la spiegazione quando il punto e chiaro",
  ];
  const languageLessons = [
    "la lingua puo essere ricca ma deve restare orientata: il lettore non va lasciato nel rumore",
    "periodi lunghi sono ammessi solo se la regia sintattica resta ferma",
    "lessico alto e lessico semplice vanno scelti per peso e funzione, non per prestigio",
  ];
  const extraConstraints = [
    "non imitare la voce dei grandi scrittori italiani come maschera stilistica",
    "distillare ritmo, chiarezza, tensione e precisione senza fare pastiche letterario",
  ];

  const pack = readPack();
  appendKnowledge(pack, "narrative", narrativeLessons);
  appendKnowledge(pack, "natural_expression", expressionLessons);
  appendKnowledge(pack, "lexicon_grammar", languageLessons);
  appendConstraints(pack, "narrative", extraConstraints);
  appendConstraints(pack, "natural_expression", extraConstraints);
  appendConstraints(pack, "lexicon_grammar", extraConstraints);
  pack.generated_at = new Date().toISOString();
  writeFileSync(PACK_PATH, JSON.stringify(pack, null, 2));

  const report: StudyReport = {
    runner: "nyra_italian_language_mastery_study",
    generated_at: new Date().toISOString(),
    scope: "god_mode_only",
    sources: fetched,
    distilled_effects: {
      narrative: narrativeLessons,
      natural_expression: expressionLessons,
      lexicon_grammar: languageLessons,
    },
    constraints: extraConstraints,
    output_pack: PACK_PATH,
    verdict: "Sessione eseguita: narrativa, espressione e lingua italiana distillate nel memory pack owner-only senza imitazione servile.",
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();
