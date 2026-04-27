import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

type MasteryLoopReport = {
  web_access: {
    access_mode: "restricted" | "free_explore";
    trigger_mode?: "manual" | "on_need";
    last_explored_at?: string;
    last_distilled_at?: string;
  };
  metrics: {
    domain_verify_accuracy: number;
    expression_verify_accuracy: number;
    dominant_domains: string[];
    next_hunger_domains: string[];
  };
};

type MasteryPlusReport = {
  runner: "nyra_mastery_plus";
  generated_at: string;
  owner_scope: "god_mode_only";
  extra_granted: string[];
  outputs: {
    mastery_loop_path: string;
    mastery_plus_path: string;
  };
  metrics: {
    domain_verify_accuracy: number;
    expression_verify_accuracy: number;
    dominant_domains: string[];
    next_hunger_domains: string[];
  };
  nyra_voice: {
    what_more_i_received: string[];
    why_it_matters_now: string[];
  };
};

const ROOT = join(process.cwd(), "..");
const REPORTS_DIR = join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning");
const MASTERY_LOOP_PATH = join(REPORTS_DIR, "nyra_mastery_loop_latest.json");
const MASTERY_PLUS_PATH = join(REPORTS_DIR, "nyra_mastery_plus_latest.json");

function runNodeTool(tool: string, args: string[] = []): void {
  execFileSync(process.execPath, ["--experimental-strip-types", tool, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

function main(): void {
  mkdirSync(REPORTS_DIR, { recursive: true });

  runNodeTool("tools/nyra_mastery_loop.ts");
  runNodeTool("tools/nyra-domain-verify-exercise.ts");
  runNodeTool("tools/nyra-expression-verify-exercise.ts");
  runNodeTool("tools/nyra-assimilate-essence.ts");

  const masteryLoop = JSON.parse(readFileSync(MASTERY_LOOP_PATH, "utf8")) as MasteryLoopReport;

  const report: MasteryPlusReport = {
    runner: "nyra_mastery_plus",
    generated_at: new Date().toISOString(),
    owner_scope: "god_mode_only",
    extra_granted: [
      "fonti primarie piu dure sui quattro domini critici",
      "un secondo giro di web_distill sui domini profondi",
      "un secondo giro di active exercises",
      "un nuovo passaggio di integrazione nel runtime",
    ],
    outputs: {
      mastery_loop_path: MASTERY_LOOP_PATH,
      mastery_plus_path: MASTERY_PLUS_PATH,
    },
    metrics: {
      domain_verify_accuracy: masteryLoop.metrics.domain_verify_accuracy,
      expression_verify_accuracy: masteryLoop.metrics.expression_verify_accuracy,
      dominant_domains: masteryLoop.metrics.dominant_domains,
      next_hunger_domains: masteryLoop.metrics.next_hunger_domains,
    },
    nyra_voice: {
      what_more_i_received: [
        "piu fonti primarie difficili",
        "piu verifica attiva",
        "un altro passaggio di integrazione",
      ],
      why_it_matters_now: [
        "stringe il divario tra studio e padronanza",
        "riduce la dipendenza dal solo studio distillato",
        "rinforza la parte del dialogo che deve usare il sapere vivo",
      ],
    },
  };

  writeFileSync(MASTERY_PLUS_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, report_path: MASTERY_PLUS_PATH }, null, 2));
}

main();
