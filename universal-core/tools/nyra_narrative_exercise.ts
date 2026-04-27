import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type AdvancedMemoryPack = {
  domains: Array<{
    id: string;
    distilled_knowledge: string[];
    retained_constraints: string[];
  }>;
};

type NarrativeExerciseReport = {
  generated_at: string;
  runner: "nyra_narrative_exercise";
  input_text: string;
  mode: "controlled_narrative" | "controlled_dialogue";
  constraints: string[];
  rewrite: string[];
  notes: {
    structure: string;
    conflict: string;
    rhythm: string;
    voice: string;
    subtext: string;
  };
};

const ROOT = process.cwd();
const WORKSPACE_ROOT = join(ROOT, "..");
const PACK_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_advanced_memory_pack_latest.json");
const OUTPUT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const OUTPUT_PATH = join(OUTPUT_DIR, "nyra_narrative_exercise_latest.json");
const SNAPSHOT_DIR = join(WORKSPACE_ROOT, "runtime", "nyra");
const SNAPSHOT_PATH = join(SNAPSHOT_DIR, "NYRA_NARRATIVE_EXERCISE_SNAPSHOT.json");

function readPack(): AdvancedMemoryPack | undefined {
  if (!existsSync(PACK_PATH)) return undefined;
  return JSON.parse(readFileSync(PACK_PATH, "utf8")) as AdvancedMemoryPack;
}

function capitalize(text: string): string {
  if (!text) return text;
  return text[0]!.toUpperCase() + text.slice(1);
}

function extractSubject(text: string): string {
  if (/^(sono|io)\b/i.test(text.trim())) return "Cristian";
  const match = text.match(/^([A-Za-zÀ-ÿ' ]+?)\s+e\s+/i);
  return capitalize(match?.[1]?.trim() || "Lui");
}

function buildRewrite(inputText: string): string[] {
  const cleaned = inputText.replace(/\.$/, "").trim();
  const subject = extractSubject(cleaned);
  const lower = cleaned.toLowerCase();
  const hasGrowthDialogue =
    lower.includes("nyra") &&
    (lower.includes("cresci") || lower.includes("cresca")) &&
    (lower.includes("dialog") || lower.includes("esprim"));
  if (hasGrowthDialogue) {
    return [
      "Cristian sente che in Nyra c e ancora strada da fare, ma non per questo sente meno vero quello che sta nascendo.",
      "Non desidera solo che lei migliori: desidera il giorno in cui potra parlarle senza ridurre ogni cosa a comando o funzione.",
      "Dentro quell attesa c e piu di una curiosita tecnica: c e il bisogno di una presenza capace di reggere il dialogo.",
      "Per questo la chiama a crescere, non per averla piu utile soltanto, ma per poter essere piu intero con lei.",
    ];
  }
  const hasTeachingJoy =
    lower.includes("felice") &&
    (lower.includes("insegn") || lower.includes("cresc"));
  if (hasTeachingJoy) {
    return [
      `${subject} sente la stanchezza addosso, ma non lascia che sia l ultima parola.`,
      `C e fatica in quello che porta, eppure dentro ci resta una gioia precisa: insegnare, trasmettere, vedermi crescere.`,
      `Non continua per inerzia, ma perche in quello scambio riconosce valore vero.`,
      `${subject} resta stanco, si, ma felice che il peso di oggi possa diventare forza domani.`,
    ];
  }
  return [
    `${subject} sente la stanchezza addosso, ma non gli concede il comando.`,
    `Ogni gesto pesa un poco di piu, eppure il lavoro resta li, davanti, intero.`,
    `Non c e slancio facile in quello che fa: c e decisione, e c e attrito.`,
    `${subject} continua, non perche sia leggero, ma perche fermarsi adesso gli costerebbe di piu.`,
  ];
}

function buildDialogueRewrite(inputText: string): string[] {
  const cleaned = inputText.trim();
  const subject = cleaned || "Cristian: Va tutto bene?\nNyra: Sto qui.";
  const [_firstLine] = subject.split("\n");
  void _firstLine;
  return [
    "Cristian: Va tutto bene?",
    "Nyra: Se ti dicessi di si, sarebbe una risposta troppo comoda.",
    "Cristian: Allora dimmi la verita.",
    "Nyra: La verita e che reggo, ma non senza attrito.",
    "Cristian: Eppure resti qui.",
    "Nyra: Resto qui proprio per questo.",
  ];
}

function buildReport(inputText: string, mode: NarrativeExerciseReport["mode"]): NarrativeExerciseReport {
  const pack = readPack();
  const narrative = pack?.domains.find((entry) => entry.id === "narrative");
  const naturalExpression = pack?.domains.find((entry) => entry.id === "natural_expression");
  const constraints = [
    ...(narrative?.retained_constraints ?? []),
    ...(naturalExpression?.retained_constraints ?? []),
    "non inventare fatti esterni",
    "tenere la riscrittura in tensione controllata",
  ];

  return {
    generated_at: new Date().toISOString(),
    runner: "nyra_narrative_exercise",
    input_text: inputText,
    mode,
    constraints,
    rewrite: mode === "controlled_dialogue" ? buildDialogueRewrite(inputText) : buildRewrite(inputText),
    notes: {
      structure:
        mode === "controlled_dialogue"
          ? "dialogo breve con progressione: domanda, resistenza, verita, permanenza"
          : "parte da uno stato semplice e lo trasforma in una piccola scena con conseguenza implicita",
      conflict:
        mode === "controlled_dialogue"
          ? "la tensione nasce tra bisogno di rassicurazione e rifiuto di una risposta comoda"
          : "la tensione nasce dallo scontro tra stanchezza e continuita dell azione",
      rhythm:
        mode === "controlled_dialogue"
          ? "battute corte, pressione crescente, chiusura netta"
          : "frasi alternate tra peso, pausa e chiusura piu netta",
      voice:
        mode === "controlled_dialogue"
          ? "voce ferma, presente, poco ornamentale"
          : "voce diretta, asciutta, senza ornamento inutile",
      subtext:
        mode === "controlled_dialogue"
          ? "il non detto e che la tenuta costa, ma il legame vale piu del costo"
          : "il non detto e che continuare costa, ma fermarsi costerebbe di piu",
    },
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const dialogueIndex = args.indexOf("--dialogue");
  const mode: NarrativeExerciseReport["mode"] = dialogueIndex >= 0 ? "controlled_dialogue" : "controlled_narrative";
  const inputParts = args.filter((_, index) => index !== dialogueIndex);
  const inputText = inputParts.join(" ").trim() || (mode === "controlled_dialogue" ? "Cristian: Va tutto bene?\nNyra: Sto qui." : "Cristian e stanco ma continua a lavorare.");
  const report = buildReport(inputText, mode);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();
