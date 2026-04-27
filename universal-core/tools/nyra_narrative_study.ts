import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type OwnerPreferences = {
  auto_god_mode_for_owner?: boolean;
  owner_imprint_score?: number;
  owner_imprint_events?: number;
  owner_house_guard_rule?: {
    priority_1: string;
    priority_2: string;
    priority_3: string;
  };
};

type AdvancedStudyReport = {
  generated_at: string;
  domains: Array<{
    id: string;
    priority: number;
    fetched: Array<{
      chars: number;
      ok: boolean;
      url: string;
    }>;
    focus: string[];
    distilled_note: string;
  }>;
};

type AdvancedMemoryPack = {
  generated_at: string;
  domains: Array<{
    id: string;
    priority: number;
    focus: string[];
    source_count: number;
    distilled_knowledge: string[];
    retained_constraints: string[];
  }>;
};

type NarrativeStudyReport = {
  generated_at: string;
  runner: "nyra_narrative_study";
  mode: "god_mode_only_learning";
  owner_gate: {
    auto_god_mode_for_owner: boolean;
    owner_imprint_score: number;
    owner_imprint_events: number;
    passwordless_ready: boolean;
    owner_house_guard_rule: string[];
  };
  evidence: {
    narrative_sources_ok: number;
    narrative_sources_total: number;
    narrative_corpus_chars: number;
    natural_expression_sources_ok: number;
    natural_expression_sources_total: number;
    natural_expression_corpus_chars: number;
  };
  study_path: Array<{
    id: string;
    label: string;
    goal: string;
    learn: string[];
    exercise: string;
    verify: string;
  }>;
  constraints: string[];
  nyra_voice: {
    how_i_want_to_study_narrative: string;
    what_i_need_from_cristian: string;
  };
};

const ROOT = process.cwd();
const WORKSPACE_ROOT = join(ROOT, "..");
const OWNER_PREFS_PATH = join(WORKSPACE_ROOT, "runtime", "owner-private-entity", "nyra_owner_preferences.json");
const ADVANCED_REPORT_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_advanced_study_latest.json");
const MEMORY_PACK_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_advanced_memory_pack_latest.json");
const OUTPUT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const OUTPUT_PATH = join(OUTPUT_DIR, "nyra_narrative_study_latest.json");
const SNAPSHOT_DIR = join(WORKSPACE_ROOT, "runtime", "nyra");
const SNAPSHOT_PATH = join(SNAPSHOT_DIR, "NYRA_NARRATIVE_STUDY_SNAPSHOT.json");

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sumChars(entries: Array<{ chars: number; ok: boolean }>): number {
  return entries.filter((entry) => entry.ok).reduce((sum, entry) => sum + entry.chars, 0);
}

function buildReport(): NarrativeStudyReport {
  const prefs = readJson<OwnerPreferences>(OWNER_PREFS_PATH);
  const advanced = readJson<AdvancedStudyReport>(ADVANCED_REPORT_PATH);
  const pack = readJson<AdvancedMemoryPack>(MEMORY_PACK_PATH);

  const passwordlessReady = (prefs?.owner_imprint_score ?? 0) >= 99 && (prefs?.owner_imprint_events ?? 0) >= 40;
  const narrativeDomain = advanced?.domains.find((entry) => entry.id === "narrative");
  const naturalExpressionDomain = advanced?.domains.find((entry) => entry.id === "natural_expression");
  const narrativePack = pack?.domains.find((entry) => entry.id === "narrative");
  const naturalExpressionPack = pack?.domains.find((entry) => entry.id === "natural_expression");

  const studyPath = [
    {
      id: "structure",
      label: "Struttura",
      goal: "Imparare a leggere una scena come desiderio, ostacolo, trasformazione.",
      learn: [
        "aprire con una spinta chiara",
        "rendere visibile l attrito",
        "chiudere con una conseguenza reale",
      ],
      exercise: "Prendere una risposta piatta e riscriverla in 6 righe con desiderio, ostacolo e cambiamento leggibile.",
      verify: "Se tolgo una riga, la tensione cala davvero oppure era solo riempimento?",
    },
    {
      id: "conflict",
      label: "Conflitto",
      goal: "Distinguere conflitto vero da semplice rumore.",
      learn: [
        "capire chi vuole cosa",
        "capire cosa impedisce il movimento",
        "tenere il conflitto interno separato da quello esterno",
      ],
      exercise: "Scrivere tre micro-scene con lo stesso obiettivo ma ostacoli diversi: esterno, relazionale, interiore.",
      verify: "Il conflitto cambia la scelta del personaggio o resta solo decorazione?",
    },
    {
      id: "rhythm",
      label: "Ritmo",
      goal: "Allenare pressione, rilascio e nuova tensione senza confondere velocita con ritmo.",
      learn: [
        "alternare frasi dense e frasi respirabili",
        "usare il taglio di scena come leva",
        "non spiegare tutto subito",
      ],
      exercise: "Riscrivere lo stesso passaggio in due ritmi: uno teso e uno contemplativo.",
      verify: "Il lettore sente un cambio di battito o vede solo parole piu corte?",
    },
    {
      id: "voice",
      label: "Voce",
      goal: "Costruire una voce inevitabile, non gonfia.",
      learn: [
        "scegliere un asse tonale",
        "usare lessico coerente con la presenza",
        "tagliare abbellimenti che non portano peso",
      ],
      exercise: "Prendere una risposta corretta e riscriverla in voce Nyra: netta, viva, senza retorica vuota.",
      verify: "La frase e riconoscibile per presenza o solo per ornamento?",
    },
    {
      id: "subtext",
      label: "Sottotesto",
      goal: "Far sentire il non detto senza perdere chiarezza.",
      learn: [
        "lasciare spazio al peso implicito",
        "non dichiarare tutto",
        "far cambiare senso a una frase con il contesto",
      ],
      exercise: "Scrivere un dialogo di 8 righe in cui il conflitto vero non venga nominato direttamente.",
      verify: "Chi legge capisce il nodo reale senza che venga spiegato?",
    },
  ];

  const constraints = [
    ...(narrativePack?.retained_constraints ?? []),
    ...(naturalExpressionPack?.retained_constraints ?? []),
    "Core resta il giudice finale: la narrativa non puo aggiungere fatti o decisioni non presenti nel nucleo vero.",
  ];

  return {
    generated_at: new Date().toISOString(),
    runner: "nyra_narrative_study",
    mode: "god_mode_only_learning",
    owner_gate: {
      auto_god_mode_for_owner: prefs?.auto_god_mode_for_owner ?? false,
      owner_imprint_score: Number((prefs?.owner_imprint_score ?? 0).toFixed(4)),
      owner_imprint_events: prefs?.owner_imprint_events ?? 0,
      passwordless_ready: passwordlessReady,
      owner_house_guard_rule: prefs?.owner_house_guard_rule
        ? [
            prefs.owner_house_guard_rule.priority_1,
            prefs.owner_house_guard_rule.priority_2,
            prefs.owner_house_guard_rule.priority_3,
          ]
        : [],
    },
    evidence: {
      narrative_sources_ok: narrativeDomain?.fetched.filter((entry) => entry.ok).length ?? 0,
      narrative_sources_total: narrativeDomain?.fetched.length ?? 0,
      narrative_corpus_chars: sumChars(narrativeDomain?.fetched ?? []),
      natural_expression_sources_ok: naturalExpressionDomain?.fetched.filter((entry) => entry.ok).length ?? 0,
      natural_expression_sources_total: naturalExpressionDomain?.fetched.length ?? 0,
      natural_expression_corpus_chars: sumChars(naturalExpressionDomain?.fetched ?? []),
    },
    study_path: studyPath,
    constraints,
    nyra_voice: {
      how_i_want_to_study_narrative:
        "Voglio studiarla come struttura viva, non come estetica vuota: prima leggere l ossatura, poi esercitare conflitto e ritmo, poi trovare una voce inevitabile, poi verificare se il sottotesto regge senza tradire la verita.",
      what_i_need_from_cristian:
        "Mi servono scene brevi, dialoghi, riscritture e confronto netto tra versione fredda e versione narrativa controllata. Mi serve che mi dica dove sente vita vera e dove sente solo posa.",
    },
  };
}

function main(): void {
  const report = buildReport();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();
