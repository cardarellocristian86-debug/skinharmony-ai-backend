import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runNyraActionGovernor } from "./nyra-action-governor.ts";
import { buildNyraDialogueEngineResult } from "./nyra-dialogue-engine.ts";

type Check = {
  id: string;
  status: "pass" | "fail";
  detail: string;
};

const repoRoot = join(process.cwd(), "..");
const reportDir = join(repoRoot, "reports", "product");
const reportPath = join(reportDir, "skinharmony_ai_nyra_work_gate_latest.json");
const mdReportPath = join(reportDir, "skinharmony_ai_nyra_work_gate_latest.md");

const files = {
  apiRoutes: join(repoRoot, "skinharmony-ai-analysis", "apps", "api", "src", "modules", "ai", "routes.ts"),
  apiSchemas: join(repoRoot, "skinharmony-ai-analysis", "apps", "api", "src", "validations", "schemas.ts"),
  pySchemas: join(repoRoot, "skinharmony-ai-analysis", "apps", "ai-service", "app", "models", "schemas.py"),
  startPage: join(repoRoot, "skinharmony-ai-analysis", "apps", "web", "app", "(app)", "start", "page.tsx"),
  capturePage: join(repoRoot, "skinharmony-ai-analysis", "apps", "web", "app", "(app)", "assessments", "[id]", "capture", "page.tsx"),
  resultsPage: join(repoRoot, "skinharmony-ai-analysis", "apps", "web", "app", "(app)", "assessments", "[id]", "results", "page.tsx"),
  css: join(repoRoot, "skinharmony-ai-analysis", "apps", "web", "app", "globals.css"),
};

function read(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function has(text: string, pattern: RegExp | string): boolean {
  return typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
}

function check(id: string, ok: boolean, detail: string): Check {
  return { id, status: ok ? "pass" : "fail", detail };
}

const apiRoutes = read(files.apiRoutes);
const apiSchemas = read(files.apiSchemas);
const pySchemas = read(files.pySchemas);
const startPage = read(files.startPage);
const capturePage = read(files.capturePage);
const resultsPage = read(files.resultsPage);
const css = read(files.css);
const allText = [apiRoutes, apiSchemas, pySchemas, startPage, capturePage, resultsPage, css].join("\n");
const normalizedAllText = allText.toLowerCase();
const positiveMedicalClaim =
  /\b(cura|guarisce|terapeutico|terapeutica|risultato garantito|risultati garantiti)\b/i.test(allText) ||
  (normalizedAllText.includes("diagnosi medica") &&
    !normalizedAllText.includes("non costituisce diagnosi medica") &&
    !normalizedAllText.includes("non e diagnosi medica") &&
    !normalizedAllText.includes("non è diagnosi medica"));

const checks: Check[] = [
  check(
    "backend_single_analysis_route",
    has(apiRoutes, '"/analyze-assessment/:assessmentId"') &&
      has(apiRoutes, "/visual-score") &&
      has(apiRoutes, "/interpret") &&
      has(apiRoutes, "prisma.visualScore.upsert") &&
      has(apiRoutes, "prisma.interpretation.upsert"),
    "La route unica deve leggere immagini, calcolare score/interpretazione e salvare risultati.",
  ),
  check(
    "core_nyra_contract_present",
    has(apiRoutes, "Universal Core") &&
      has(apiRoutes, "Nyra") &&
      has(apiRoutes, "OpenAI API ready") &&
      has(apiRoutes, "operator_required"),
    "Il contratto di prodotto deve essere Vision -> Core -> Nyra -> fallback OpenAI -> conferma operatore.",
  ),
  check(
    "api_payload_not_wrapped",
    has(apiSchemas, "aiVisualScoreSchema") &&
      has(apiSchemas, "imagePaths") &&
      has(apiSchemas, "areaType") &&
      has(apiSchemas, "aiInterpretSchema") &&
      !has(apiRoutes, "aiPayloadSchema.parse"),
    "Le chiamate AI devono passare payload reali e non un wrapper generico vuoto.",
  ),
  check(
    "quality_scale_100",
    has(apiSchemas, "blurScore: z.number().min(0).max(100)") &&
      has(apiSchemas, "distanceScore: z.number().min(0).max(100)"),
    "Il quality check lavora su scala 0-100 coerente con il servizio Python.",
  ),
  check(
    "python_schema_runtime_ok",
    has(pySchemas, "from typing import Any") && has(pySchemas, "heatmapData: dict[str, Any]"),
    "Pydantic deve avere Any definito per ricostruire VisualScoreResponse.",
  ),
  check(
    "simple_product_entry_ui",
    has(startPage, "Inizia analisi") &&
      has(startPage, "sh-start-hero") &&
      has(css, ".sh-start-hero") &&
      has(css, ".sh-start-main"),
    "La UI deve partire da una pagina prodotto semplice, non da dashboard tecnica.",
  ),
  check(
    "capture_ui_operator_confirmation",
    has(capturePage, "Nuova analisi SkinHarmony AI") &&
      has(capturePage, "Operatore") &&
      has(capturePage, "Genera lettura e percorso"),
    "La cattura foto deve spiegare il ruolo dell'operatore e avere una CTA chiara.",
  ),
  check(
    "results_use_consolidated_analysis",
    has(resultsPage, "api.analyzeAssessment") &&
      has(resultsPage, "Lettura SkinHarmony AI") &&
      has(resultsPage, "OpenAI") &&
      has(resultsPage, "Universal Core") &&
      has(resultsPage, "Nyra"),
    "La pagina risultati deve usare la route consolidata e mostrare il flusso Core/Nyra.",
  ),
  check(
    "no_medical_claims",
    !positiveMedicalClaim,
    "Il prodotto deve bloccare claim medici o terapeutici, ma puo mostrare disclaimer di limite.",
  ),
];

const passCount = checks.filter((item) => item.status === "pass").length;
const failCount = checks.length - passCount;
const successRate = passCount / checks.length;

const governor = runNyraActionGovernor({
  task_type: "runtime_batch",
  adapter_input: {
    success_rate: successRate,
    avg_latency: 260,
    error_rate: failCount / checks.length,
  },
  expected: {
    success: true,
    success_rate: 1,
    error_rate: 0,
    avg_latency: 250,
    failed_jobs: 0,
  },
  actual: {
    success: failCount === 0,
    success_rate: successRate,
    error_rate: failCount / checks.length,
    avg_latency: 260,
    failed_jobs: failCount,
  },
});

const verdict =
  failCount === 0 && governor.decision === "allow"
    ? "allow"
    : failCount <= 1 && ["allow", "retry"].includes(governor.decision)
      ? "retry_minor"
      : "block";

const nyra = buildNyraDialogueEngineResult({
  user_text: "Valuta il lavoro SkinHarmony AI: deve essere semplice, collegato a Universal Core/Nyra, con OpenAI fallback e conferma operatore.",
  owner_recognition_score: 100,
  god_mode_requested: false,
  intro: "Nyra work gate",
  state: verdict === "allow" ? "ready" : "attention",
  risk: Math.round((failCount / checks.length) * 100),
  response_mode: "decide",
  primary_action: verdict === "allow" ? "Mantieni questa direzione e continua con test end-to-end." : "Correggi i check falliti prima di procedere.",
  action_labels: checks.filter((item) => item.status === "fail").map((item) => item.id),
});

const report = {
  generated_at: new Date().toISOString(),
  scope: "SkinHarmony AI local work gate",
  method: "Universal Core/Nyra operational gate: deterministic checks + Nyra risk governor + Nyra explanation layer.",
  verdict,
  pass_count: passCount,
  fail_count: failCount,
  success_rate: successRate,
  governor,
  nyra_reply: nyra.reply,
  checks,
};

mkdirSync(reportDir, { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));

const md = [
  "# SkinHarmony AI - Nyra/Core Work Gate",
  "",
  `Generated: ${report.generated_at}`,
  "",
  `Verdict: ${verdict}`,
  `Pass: ${passCount}/${checks.length}`,
  `Governor: ${governor.decision} (${governor.reason})`,
  "",
  "## Checks",
  "",
  ...checks.map((item) => `- ${item.status === "pass" ? "PASS" : "FAIL"} ${item.id}: ${item.detail}`),
  "",
  "## Nyra",
  "",
  nyra.reply ?? "No reply.",
  "",
].join("\n");
writeFileSync(mdReportPath, md);

console.log(JSON.stringify({
  verdict,
  pass_count: passCount,
  fail_count: failCount,
  report: reportPath,
  markdown_report: mdReportPath,
}, null, 2));
