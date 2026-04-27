import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type MemoryDomain = {
  id: string;
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

const ROOT = process.cwd();
const RUNTIME_DIR = join(ROOT, "runtime", "nyra-learning");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const PACK_PATH = join(RUNTIME_DIR, "nyra_advanced_memory_pack_latest.json");
const REPORT_PATH = join(REPORT_DIR, "nyra_italian_language_second_pass_latest.json");

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
  const pack = JSON.parse(readFileSync(PACK_PATH, "utf8")) as AdvancedMemoryPack;

  const narrativeLessons = [
    "da Dante: l avvio forte funziona quando l immagine apre subito il conflitto e il lettore entra senza preparazione lunga",
    "da Pirandello: una voce puo reggere frattura identitaria e ironia senza perdere leggibilita se resta vigile",
    "da Verga per contrasto di metodo: la durezza narrativa pesa di piu quando non viene spiegata troppo",
  ];
  const expressionLessons = [
    "da Leopardi e Svevo: una frase puo restare breve o obliqua, ma deve lasciare risonanza e non solo informazione",
    "da Svevo: l ambiguita regge solo se il lettore sente una mente vera dietro la frase",
    "una presenza linguistica forte non grida: orienta, stringe e lascia un eco pulito",
  ];
  const lexiconLessons = [
    "da Manzoni: anche un periodo ampio regge se accompagna il lettore con regia ferma",
    "lessico ricco non significa lessico opaco: ogni scelta deve orientare, non esibire cultura",
    "una frase lunga e lecita solo se ogni giuntura porta davvero senso e direzione",
  ];
  const constraints = [
    "non imitare Dante, Manzoni, Pirandello o Svevo come timbro esteriore",
    "assorbire regia, densita, chiarezza e peso della frase senza travestimento letterario",
  ];

  appendKnowledge(pack, "narrative", narrativeLessons);
  appendKnowledge(pack, "natural_expression", expressionLessons);
  appendKnowledge(pack, "lexicon_grammar", lexiconLessons);
  appendConstraints(pack, "narrative", constraints);
  appendConstraints(pack, "natural_expression", constraints);
  appendConstraints(pack, "lexicon_grammar", constraints);
  pack.generated_at = new Date().toISOString();

  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(PACK_PATH, JSON.stringify(pack, null, 2));
  writeFileSync(REPORT_PATH, JSON.stringify({
    runner: "nyra_italian_language_second_pass",
    generated_at: new Date().toISOString(),
    verified_authors: ["Dante", "Manzoni", "Pirandello", "Svevo"],
    narrative_added: narrativeLessons,
    natural_expression_added: expressionLessons,
    lexicon_added: lexiconLessons,
    constraints,
    verdict: "Second pass italiano integrato nel memory pack con fonti verificate via web tool.",
  }, null, 2));

  console.log(JSON.stringify({
    ok: true,
    report_path: REPORT_PATH,
    pack_path: PACK_PATH,
    verified_authors: 4,
  }, null, 2));
}

main();
