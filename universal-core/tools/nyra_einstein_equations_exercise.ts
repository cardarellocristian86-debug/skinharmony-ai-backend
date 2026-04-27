import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type RelativityPack = {
  equation_rules: string[];
};

type EquationExerciseReport = {
  generated_at: string;
  runner: "nyra_einstein_equations_exercise";
  pack_loaded: boolean;
  exercises: Array<{
    id: string;
    prompt: string;
    answer: string;
    meaning: string;
  }>;
  nyra_voice: {
    what_i_learned: string;
  };
};

const ROOT = process.cwd();
const WORKSPACE_ROOT = join(ROOT, "..");
const PACK_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_relativity_learning_pack_latest.json");
const OUTPUT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const OUTPUT_PATH = join(OUTPUT_DIR, "nyra_einstein_equations_exercise_latest.json");
const SNAPSHOT_DIR = join(WORKSPACE_ROOT, "runtime", "nyra");
const SNAPSHOT_PATH = join(SNAPSHOT_DIR, "NYRA_EINSTEIN_EQUATIONS_EXERCISE_SNAPSHOT.json");

function loadPack(): RelativityPack | undefined {
  if (!existsSync(PACK_PATH)) return undefined;
  return JSON.parse(readFileSync(PACK_PATH, "utf8")) as RelativityPack;
}

function buildReport(): EquationExerciseReport {
  const pack = loadPack();
  return {
    generated_at: new Date().toISOString(),
    runner: "nyra_einstein_equations_exercise",
    pack_loaded: Boolean(pack),
    exercises: [
      {
        id: "einstein-field-equation-compact",
        prompt: "Completa la forma compatta: G_mu_nu + ___ g_mu_nu = ___ T_mu_nu",
        answer: "Lambda ; 8 pi G / c^4",
        meaning: "La geometria dello spaziotempo sul lato sinistro e collegata al contenuto materiale-energetico sul lato destro.",
      },
      {
        id: "vacuum-equation",
        prompt: "Completa la forma in vuoto senza costante cosmologica: R_mu_nu - 1/2 R g_mu_nu = ___",
        answer: "0",
        meaning: "In assenza di materia ed energia locali, la geometria soddisfa la forma omogenea dell equazione.",
      },
      {
        id: "lorentz-factor",
        prompt: "Completa: gamma = 1 / sqrt( 1 - ___ / c^2 )",
        answer: "v^2",
        meaning: "Il fattore di Lorentz misura quanto i risultati differiscono quando la velocita si avvicina a quella della luce.",
      },
      {
        id: "energy-momentum-relation",
        prompt: "Completa: E^2 = (pc)^2 + ___",
        answer: "(mc^2)^2",
        meaning: "Energia totale, impulso e massa a riposo sono legati nella cinematica relativistica.",
      },
    ],
    nyra_voice: {
      what_i_learned:
        "Ho imparato che le equazioni di Einstein non sono solo simboli da ricordare: sono un ponte tra geometria e materia. E ho imparato che completare una formula senza saperne dire il significato non basta.",
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
