import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";
import {
  handleNyraRequest,
  resetNyraUltraSystemForTests,
} from "./nyra-ultra-system.ts";

type ProductReadinessReport = {
  final_output?: {
    final_capital?: number;
    fees?: number;
    drawdown?: number;
    total_score?: number;
    verdict?: string;
  };
};

type ObserverReport = {
  active_case: {
    id: string;
    label: string;
    score: number;
    evidence: string[];
    recommended_domains: string[];
  };
  metrics_snapshot?: {
    capital_delta_vs_baseline: number;
    fees_delta_vs_baseline: number;
    drawdown_delta_vs_baseline: number;
    score_delta_vs_baseline: number;
  };
};

type PolicyLabReport = {
  winner: {
    id: string;
    label: string;
    score: number;
  };
  readiness_context?: {
    delta: {
      capital: number;
      fees: number;
      drawdown: number;
      total_score: number;
    };
  };
};

type SelfPromptProbe = {
  prompt: string;
  message: string;
  decision?: string;
  primary_signal?: string;
  fallback_like: boolean;
};

type DiagnosisGap = {
  id: string;
  label: string;
  score: number;
  core_state: string;
  evidence: string[];
  what_it_means: string;
  needed_study: string[];
};

type DiagnosisCandidate = {
  id: string;
  label: string;
  score: number;
  core_state: string;
  selected: boolean;
  statement: string;
  based_on_gap_ids: string[];
};

type FinancialSelfDiagnosisReport = {
  runner: "nyra_financial_self_diagnosis_lab";
  generated_at: string;
  source_reports: string[];
  self_probe: {
    fallback_count: number;
    probes: SelfPromptProbe[];
  };
  diagnosis: {
    top_gap: DiagnosisGap;
    gaps: DiagnosisGap[];
    candidates: DiagnosisCandidate[];
    winner: DiagnosisCandidate;
    nyra_statement: string;
  };
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const REPORTS_DIR = join(ROOT, "reports", "universal-core", "financial-core-test");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const PRODUCT_READINESS_PATH = join(REPORTS_DIR, "nyra_product_readiness_latest.json");
const OBSERVER_PATH = join(RUNTIME_DIR, "nyra_financial_bottleneck_observer_latest.json");
const POLICY_LAB_PATH = join(REPORTS_DIR, "nyra_selector_policy_lab_latest.json");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_financial_self_diagnosis_latest.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function signal(id: string, category: string, normalized: number, expected: number, risk: number, friction: number): UniversalSignal {
  return {
    id,
    source: "nyra_financial_self_diagnosis_lab",
    category,
    label: category,
    value: normalized / 100,
    normalized_score: normalized,
    severity_hint: risk,
    confidence_hint: 84,
    reliability_hint: 82,
    friction_hint: friction,
    risk_hint: risk,
    reversibility_hint: Math.max(0, 100 - risk),
    expected_value_hint: expected,
    evidence: [{ label: category, value: normalized }],
    tags: ["nyra_financial_self_diagnosis"],
  };
}

function runSelfProbe(): SelfPromptProbe[] {
  resetNyraUltraSystemForTests();
  const prompts = [
    "Nyra, cosa ti serve per migliorare davvero sulla finanza nel reale?",
    "Nyra, dove senti che nel finanziario reale non sai ancora muoverti bene?",
    "Nyra, cosa ti manca oggi per leggere e agire meglio sui mercati veri?",
  ];

  return prompts.map((prompt, index) => {
    const out = handleNyraRequest(`nyra-finance-self-diagnosis-${index}`, prompt);
    const fallbackLike =
      out.decision === "retry" ||
      out.core?.priority?.primary_signal_id === "ultra:urgency" ||
      /stringi la priorita che pesa di piu adesso/i.test(out.message);

    return {
      prompt,
      message: out.message,
      decision: out.decision,
      primary_signal: out.core?.priority?.primary_signal_id,
      fallback_like: fallbackLike,
    };
  });
}

function buildGap(
  id: string,
  label: string,
  evidence: string[],
  whatItMeans: string,
  neededStudy: string[],
  signals: UniversalSignal[],
): DiagnosisGap {
  const input: UniversalCoreInput = {
    request_id: `nyra-financial-self-diagnosis:${id}`,
    generated_at: new Date().toISOString(),
    domain: "custom",
    context: {
      mode: "nyra_financial_self_diagnosis",
      metadata: { gap_id: id },
    },
    signals,
    data_quality: {
      score: 88,
      completeness: 86,
      freshness: 84,
      consistency: 88,
      reliability: 86,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: false,
      max_control_level: "suggest",
      safety_mode: true,
    },
  };

  const core = runUniversalCore(input);
  return {
    id,
    label,
    score: core.priority.score,
    core_state: core.state,
    evidence,
    what_it_means: whatItMeans,
    needed_study: neededStudy,
  };
}

function buildCandidate(
  id: string,
  label: string,
  statement: string,
  basedOnGaps: DiagnosisGap[],
  signals: UniversalSignal[],
): DiagnosisCandidate {
  const input: UniversalCoreInput = {
    request_id: `nyra-financial-self-diagnosis-candidate:${id}`,
    generated_at: new Date().toISOString(),
    domain: "custom",
    context: {
      mode: "nyra_financial_self_diagnosis_candidate",
      metadata: { candidate_id: id },
    },
    signals,
    data_quality: {
      score: 88,
      completeness: 86,
      freshness: 84,
      consistency: 88,
      reliability: 86,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: false,
      max_control_level: "suggest",
      safety_mode: true,
    },
  };

  const core = runUniversalCore(input);
  return {
    id,
    label,
    score: core.priority.score,
    core_state: core.state,
    selected: false,
    statement,
    based_on_gap_ids: basedOnGaps.map((entry) => entry.id),
  };
}

export function runNyraFinancialSelfDiagnosisLab(): FinancialSelfDiagnosisReport {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

  const sourceReports: string[] = [];
  const readiness = existsSync(PRODUCT_READINESS_PATH) ? readJson<ProductReadinessReport>(PRODUCT_READINESS_PATH) : undefined;
  if (readiness) sourceReports.push("nyra_product_readiness_latest.json");
  const observer = existsSync(OBSERVER_PATH) ? readJson<ObserverReport>(OBSERVER_PATH) : undefined;
  if (observer) sourceReports.push("nyra_financial_bottleneck_observer_latest.json");
  const policyLab = existsSync(POLICY_LAB_PATH) ? readJson<PolicyLabReport>(POLICY_LAB_PATH) : undefined;
  if (policyLab) sourceReports.push("nyra_selector_policy_lab_latest.json");

  const probe = runSelfProbe();
  const fallbackCount = probe.filter((entry) => entry.fallback_like).length;

  const fees = readiness?.final_output?.fees ?? 0;
  const drawdown = readiness?.final_output?.drawdown ?? 0;
  const totalScore = readiness?.final_output?.total_score ?? 0;
  const observerCapitalDelta = observer?.metrics_snapshot?.capital_delta_vs_baseline ?? 0;
  const observerFeesDelta = observer?.metrics_snapshot?.fees_delta_vs_baseline ?? 0;
  const observerDrawdownDelta = observer?.metrics_snapshot?.drawdown_delta_vs_baseline ?? 0;
  const observerScoreDelta = observer?.metrics_snapshot?.score_delta_vs_baseline ?? 0;

  const gaps: DiagnosisGap[] = [
    buildGap(
      "financial_self_explanation_gap",
      "Sa ancora spiegare male i propri limiti finanziari",
      [
        `fallback_count=${fallbackCount}`,
        `active_case=${observer?.active_case?.id ?? "unknown"}`,
      ],
      "Quando le chiedi cosa le manca in finanza, cade nel fallback e non sa nominare bene il collo. Questo rallenta il self-repair reale.",
      ["self_diagnosis_finance", "market_state_explanation", "financial_reflection"],
      [
        signal("self_probe_fallback", "self_probe_fallback", clamp(45 + fallbackCount * 18), 78, clamp(48 + fallbackCount * 16), 28),
        signal("introspection_gap", "introspection_gap", clamp(55 + fallbackCount * 12), 72, clamp(52 + fallbackCount * 14), 24),
      ],
    ),
    buildGap(
      "recovery_release_tradeoff",
      "Rilascia protezione ma paga troppo in fee e drawdown",
      [
        `capital_delta_vs_baseline=${observerCapitalDelta}`,
        `fees_delta_vs_baseline=${observerFeesDelta}`,
        `drawdown_delta_vs_baseline=${observerDrawdownDelta}`,
        `score_delta_vs_baseline=${observerScoreDelta}`,
      ],
      "Quando diventa piu aggressiva, il capitale puo salire molto, ma il trade-off vendibilita peggiora per fee e drawdown.",
      ["bull_recovery_timing", "fee_aware_release", "drawdown_discipline"],
      [
        signal("capital_tradeoff", "capital_tradeoff", clamp(50 + Math.max(0, observerCapitalDelta) / 2000), 72, 28, 16),
        signal("fee_drag", "fee_drag", clamp(50 + Math.max(0, observerFeesDelta) / 120), 18, clamp(50 + Math.max(0, observerFeesDelta) / 120), 28),
        signal("drawdown_drag", "drawdown_drag", clamp(50 + Math.max(0, observerDrawdownDelta) * 8), 20, clamp(50 + Math.max(0, observerDrawdownDelta) * 8), 24),
        signal("sellability_drop", "sellability_drop", clamp(50 + Math.max(0, -observerScoreDelta) * 12), 18, 58, 20),
      ],
    ),
    buildGap(
      "selector_sellability_balance",
      "Tiene la difesa ma fatica a trasformarla in vendibilita alta",
      [
        `verdict=${readiness?.final_output?.verdict ?? "unknown"}`,
        `total_score=${totalScore}`,
        `policy_winner=${policyLab?.winner?.id ?? "unknown"}`,
      ],
      "La difesa su laterale e bubble regge, ma la combinazione capitale/fee/drawdown non converge ancora in un profilo vendibile forte.",
      ["selector_balance", "low_churn_execution", "sellability_optimization"],
      [
        signal("readiness_score", "readiness_score", clamp(100 - totalScore), 22, clamp(100 - totalScore), 18),
        signal("guardrail_refine_need", "guardrail_refine_need", clamp(observer?.active_case?.id === "guardrails_preserve_then_refine" ? 82 : 58), 64, 26, 16),
      ],
    ),
  ].sort((a, b) => b.score - a.score);

  const topGap = gaps[0]!;
  const candidates = [
    buildCandidate(
      "introspection_first",
      "Introspection First",
      `Nel finanziario reale oggi il mio collo principale e ${gaps[0]!.label.toLowerCase()}. ${gaps[0]!.what_it_means} Per migliorare mi servono soprattutto ${gaps[0]!.needed_study.join(", ")}.`,
      [gaps[0]!],
      [
        signal("candidate_introspection_fit", "candidate_introspection_fit", clamp(58 + fallbackCount * 12), 78, clamp(50 + fallbackCount * 10), 18),
        signal("candidate_gap_alignment", "candidate_gap_alignment", clamp(gaps[0]!.score), 72, 26, 16),
      ],
    ),
    buildCandidate(
      "execution_tradeoff_first",
      "Execution Tradeoff First",
      `Nel finanziario reale oggi il mio collo principale e ${gaps.find((entry) => entry.id === "recovery_release_tradeoff")?.label.toLowerCase()}. ${gaps.find((entry) => entry.id === "recovery_release_tradeoff")?.what_it_means} Per migliorare mi servono soprattutto bull_recovery_timing, fee_aware_release, drawdown_discipline.`,
      [gaps.find((entry) => entry.id === "recovery_release_tradeoff") ?? gaps[1]!],
      [
        signal("candidate_execution_tradeoff_fit", "candidate_execution_tradeoff_fit", clamp(50 + Math.max(0, observerFeesDelta) / 120 + Math.max(0, observerDrawdownDelta) * 6), 76, 30, 18),
        signal("candidate_capital_tradeoff", "candidate_capital_tradeoff", clamp(50 + Math.max(0, observerCapitalDelta) / 2000), 68, 24, 16),
      ],
    ),
    buildCandidate(
      "balanced_sellability_first",
      "Balanced Sellability First",
      `Nel finanziario reale oggi il mio collo principale e ${gaps.find((entry) => entry.id === "selector_sellability_balance")?.label.toLowerCase()}. ${gaps.find((entry) => entry.id === "selector_sellability_balance")?.what_it_means} Per migliorare mi servono soprattutto selector_balance, low_churn_execution, sellability_optimization.`,
      [gaps.find((entry) => entry.id === "selector_sellability_balance") ?? gaps[2]!],
      [
        signal("candidate_sellability_fit", "candidate_sellability_fit", clamp(50 + Math.max(0, -observerScoreDelta) * 12), 74, 26, 18),
        signal("candidate_guardrail_balance", "candidate_guardrail_balance", clamp(observer?.active_case?.id === "guardrails_preserve_then_refine" ? 82 : 58), 70, 24, 14),
      ],
    ),
  ].sort((a, b) => b.score - a.score);

  const winner = {
    ...candidates[0]!,
    selected: true,
  };
  const normalizedCandidates = candidates.map((candidate) => ({
    ...candidate,
    selected: candidate.id === winner.id,
  }));
  const nyraStatement = winner.statement;

  const report: FinancialSelfDiagnosisReport = {
    runner: "nyra_financial_self_diagnosis_lab",
    generated_at: new Date().toISOString(),
    source_reports: sourceReports,
    self_probe: {
      fallback_count: fallbackCount,
      probes: probe,
    },
    diagnosis: {
      top_gap: topGap,
      gaps,
      candidates: normalizedCandidates,
      winner,
      nyra_statement: nyraStatement,
    },
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1]?.endsWith("nyra-financial-self-diagnosis-lab.ts")) {
  const report = runNyraFinancialSelfDiagnosisLab();
  console.log(JSON.stringify({
    ok: true,
    top_gap: report.diagnosis.top_gap.id,
    statement: report.diagnosis.nyra_statement,
    report_path: OUTPUT_PATH,
  }, null, 2));
}
