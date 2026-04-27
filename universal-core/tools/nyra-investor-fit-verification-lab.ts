import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";
import { buildNyraInvestorOutreachBranch } from "./nyra-investor-outreach-branch.ts";

type VerifiedCandidate = {
  name: string;
  region: "italy" | "europe" | "global" | "usa";
  language: "it" | "en";
  official_sources: string[];
  official_fit_notes: string[];
  stage_fit: number;
  ai_core_fit: number;
  workflow_fit: number;
  finance_fit: number;
  cold_channel_quality: number;
  differentiation_fit: number;
  broadness_risk: number;
  late_stage_risk: number;
};

type VerifiedResult = {
  name: string;
  selected: boolean;
  score: number;
  fit_band: "high" | "medium" | "low";
  region: VerifiedCandidate["region"];
  official_sources: string[];
  why_selected: string[];
  why_not_top: string[];
  outreach_probabilities: {
    read_probability: number;
    reply_probability: number;
    meeting_probability: number;
  };
};

type InvestorFitVerificationReport = {
  runner: "nyra_investor_fit_verification_lab";
  generated_at: string;
  purpose: string;
  methodology: {
    branch_input: string;
    verification_rule: string;
    selection_rule: string;
  };
  shortlisted_wave_1: VerifiedResult[];
  discarded_or_secondary: VerifiedResult[];
  summary: {
    keep_now: string[];
    keep_but_second_wave: string[];
    why: string[];
  };
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const REPORT_DIR = join(ROOT, "reports", "universal-core", "business");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORT_PATH = join(REPORT_DIR, "nyra_investor_fit_verification_latest.json");
const PACK_PATH = join(RUNTIME_DIR, "nyra_investor_fit_verification_latest.json");

function signal(id: string, category: string, normalized: number, expected: number, risk: number, friction: number): UniversalSignal {
  return {
    id,
    source: "nyra_investor_fit_verification_lab",
    category,
    label: category,
    value: normalized / 100,
    normalized_score: normalized,
    severity_hint: risk,
    confidence_hint: 86,
    reliability_hint: 86,
    friction_hint: friction,
    risk_hint: risk,
    reversibility_hint: Math.max(0, 100 - risk),
    expected_value_hint: expected,
    evidence: [{ label: category, value: normalized }],
    tags: ["investor_fit_verification"],
  };
}

const VERIFIED_CANDIDATES: VerifiedCandidate[] = [
  {
    name: "United Ventures",
    region: "italy",
    language: "it",
    official_sources: [
      "https://unitedventures.com/",
      "https://unitedventures.com/2025/02/11/our-investment-in-akamas-autonomous-optimization-for-modern-applications/",
      "https://unitedventures.com/2025/07/24/backing-identifai-to-restore-trust-in-digital-content/",
      "https://unitedventures.com/portfolio/cyberwave/",
      "https://unitedventures.com/contact/",
    ],
    official_fit_notes: [
      "United Ventures dichiara focus su people and technology e startup innovative tech.",
      "Ha investito in Akamas su optimization di cost/performance/reliability.",
      "Ha investito in IdentifAI su trust/detection nell'era AI.",
      "Ha guidato Cyberwave, operating layer tra AI e physical systems.",
      "Ha submission path founder diretto dal sito ufficiale.",
    ],
    stage_fit: 90,
    ai_core_fit: 91,
    workflow_fit: 90,
    finance_fit: 70,
    cold_channel_quality: 88,
    differentiation_fit: 87,
    broadness_risk: 18,
    late_stage_risk: 16,
  },
  {
    name: "Speedinvest",
    region: "europe",
    language: "en",
    official_sources: [
      "https://www.speedinvest.com/",
      "https://www.speedinvest.com/saas",
      "https://speedinvest.com/fintech/",
    ],
    official_fit_notes: [
      "Speedinvest dichiara team AI & Infra e agent platforms.",
      "Dichiara interesse per core layers, orchestration e AI-native applications.",
      "Ha verticale fintech dedicata con network strategico.",
    ],
    stage_fit: 88,
    ai_core_fit: 95,
    workflow_fit: 86,
    finance_fit: 84,
    cold_channel_quality: 76,
    differentiation_fit: 92,
    broadness_risk: 16,
    late_stage_risk: 20,
  },
  {
    name: "Lightspeed",
    region: "global",
    language: "en",
    official_sources: [
      "https://lsvp.com/about/",
      "https://lsvp.com/stories/announcing-our-investment-in-temporal-agents-make-mistakes-your-workflows-cant/",
      "https://lsvp.com/stories/observo-ai-the-ai-native-observability-data-pipeline/",
      "https://lsvp.com/company/stacks-ai/",
    ],
    official_fit_notes: [
      "Lightspeed dichiara heritage forte su enterprise e AI.",
      "Ha investito in Temporal con tesi esplicita su agents e workflows.",
      "Ha investito in Observo AI su AI-native observability pipeline.",
      "Ha portfolio finance workflow come Stacks AI.",
    ],
    stage_fit: 86,
    ai_core_fit: 95,
    workflow_fit: 94,
    finance_fit: 82,
    cold_channel_quality: 64,
    differentiation_fit: 93,
    broadness_risk: 24,
    late_stage_risk: 28,
  },
  {
    name: "Balderton Capital",
    region: "europe",
    language: "en",
    official_sources: [
      "https://www.balderton.com/sector/enterprise/",
      "https://www.balderton.com/news/attio-raises-52m-to-scale-the-first-ai-native-crm-for-go-to-market-builders/",
      "https://www.balderton.com/news/light-raises-30m-series-a-to-replace-legacy-finance-systems-with-ai-native-platform/",
      "https://www.balderton.com/news/dash0-raises-110m-series-b-at-1b-valuation-to-build-the-ai-nervous-system-for-production/",
      "https://www.balderton.com/news/escape-raises-18m-series-a-to-fight-ai-powered-cyberattacks-with-ai-agents/",
    ],
    official_fit_notes: [
      "Balderton enterprise track molto leggibile.",
      "Ha backed Attio, AI-native CRM.",
      "Ha backed Light, AI-native finance platform.",
      "Ha backed Dash0 e Escape su AI-native infra / agents.",
    ],
    stage_fit: 84,
    ai_core_fit: 92,
    workflow_fit: 90,
    finance_fit: 86,
    cold_channel_quality: 60,
    differentiation_fit: 90,
    broadness_risk: 22,
    late_stage_risk: 30,
  },
  {
    name: "Octopus Ventures",
    region: "europe",
    language: "en",
    official_sources: [
      "https://octopusventures.com/",
      "https://octopusventures.com/b2b-software-investments/",
    ],
    official_fit_notes: [
      "Octopus dichiara focus B2B software su digitisation and automation.",
      "Ha processo pitch aperto e team dedicato B2B software.",
    ],
    stage_fit: 82,
    ai_core_fit: 78,
    workflow_fit: 88,
    finance_fit: 54,
    cold_channel_quality: 78,
    differentiation_fit: 78,
    broadness_risk: 18,
    late_stage_risk: 18,
  },
  {
    name: "Seedcamp",
    region: "europe",
    language: "en",
    official_sources: [
      "https://seedcamp.com/our-team/",
      "https://seedcamp.com/associate-select/",
    ],
    official_fit_notes: [
      "Seedcamp si presenta come foundational early-stage venture firm.",
      "Materiali recenti mostrano forte fluency interna su AI tools e founder-facing research.",
    ],
    stage_fit: 92,
    ai_core_fit: 76,
    workflow_fit: 74,
    finance_fit: 56,
    cold_channel_quality: 74,
    differentiation_fit: 74,
    broadness_risk: 20,
    late_stage_risk: 12,
  },
  {
    name: "Accel",
    region: "usa",
    language: "en",
    official_sources: [
      "https://www.accel.com/people",
    ],
    official_fit_notes: [
      "Accel mostra persone con focus AI, Cloud/SaaS, Enterprise e Fintech.",
    ],
    stage_fit: 80,
    ai_core_fit: 82,
    workflow_fit: 80,
    finance_fit: 76,
    cold_channel_quality: 54,
    differentiation_fit: 78,
    broadness_risk: 28,
    late_stage_risk: 30,
  },
  {
    name: "Index Ventures",
    region: "global",
    language: "en",
    official_sources: [
      "https://www.indexventures.com/",
    ],
    official_fit_notes: [
      "Index mostra portfolio trasversale con Anthropic, Fireworks AI, Robinhood, Datadog.",
      "Fit alto per ambizione category-defining, ma sito pubblico e molto broad e meno specifico sul thesis match.",
    ],
    stage_fit: 78,
    ai_core_fit: 80,
    workflow_fit: 74,
    finance_fit: 74,
    cold_channel_quality: 44,
    differentiation_fit: 76,
    broadness_risk: 36,
    late_stage_risk: 34,
  },
  {
    name: "468 Capital",
    region: "global",
    language: "en",
    official_sources: [
      "https://468cap.com/about/",
      "https://468cap.com/vectorshift-raises-3m-to-build-ai-workflows/",
    ],
    official_fit_notes: [
      "468 dichiara investment themes su AI & automation, infrastructure and enterprise software.",
      "Ha backed VectorShift su AI workflows.",
    ],
    stage_fit: 84,
    ai_core_fit: 88,
    workflow_fit: 84,
    finance_fit: 58,
    cold_channel_quality: 62,
    differentiation_fit: 84,
    broadness_risk: 22,
    late_stage_risk: 22,
  },
  {
    name: "General Catalyst",
    region: "usa",
    language: "en",
    official_sources: [
      "https://www.generalcatalyst.com/team/hemant-taneja",
      "https://www.generalcatalyst.com/team/marc-bhargava",
      "https://www.generalcatalyst.com/team/cecilia-zhao",
    ],
    official_fit_notes: [
      "General Catalyst espone AI, Enterprise e Fintech a livello di team e thesis.",
      "Marc Bhargava cita esplicitamente AI meets fintech.",
      "Cecilia Zhao cita AI and fintech investments.",
    ],
    stage_fit: 80,
    ai_core_fit: 86,
    workflow_fit: 78,
    finance_fit: 86,
    cold_channel_quality: 46,
    differentiation_fit: 82,
    broadness_risk: 30,
    late_stage_risk: 32,
  },
];

function buildCandidateInput(candidate: VerifiedCandidate, outreachProbabilities: VerifiedResult["outreach_probabilities"]): UniversalCoreInput {
  return {
    request_id: `nyra-investor-fit:${candidate.name}`,
    generated_at: new Date().toISOString(),
    domain: "custom",
    context: {
      mode: "nyra_investor_fit_verification_lab",
      metadata: {
        candidate_name: candidate.name,
        semantic_intent: "open_help",
        semantic_mode: "investor_target_selection",
      },
    },
    signals: [
      signal(`${candidate.name}:stage_fit`, "stage_fit", candidate.stage_fit, 86, 12, 10),
      signal(`${candidate.name}:ai_core_fit`, "ai_core_fit", candidate.ai_core_fit, 90, 12, 8),
      signal(`${candidate.name}:workflow_fit`, "workflow_fit", candidate.workflow_fit, 88, 14, 10),
      signal(`${candidate.name}:finance_fit`, "finance_fit", candidate.finance_fit, 74, 16, 10),
      signal(`${candidate.name}:cold_channel_quality`, "cold_channel_quality", candidate.cold_channel_quality, 72, 18, 12),
      signal(`${candidate.name}:differentiation_fit`, "differentiation_fit", candidate.differentiation_fit, 86, 12, 8),
      signal(`${candidate.name}:read_probability`, "read_probability", outreachProbabilities.read_probability * 100, 60, 18, 10),
      signal(`${candidate.name}:reply_probability`, "reply_probability", outreachProbabilities.reply_probability * 100, 10, 18, 10),
      signal(`${candidate.name}:meeting_probability`, "meeting_probability", outreachProbabilities.meeting_probability * 100, 4, 18, 10),
      signal(`${candidate.name}:broadness_risk`, "broadness_risk", candidate.broadness_risk, 18, candidate.broadness_risk, 20),
      signal(`${candidate.name}:late_stage_risk`, "late_stage_risk", candidate.late_stage_risk, 16, candidate.late_stage_risk, 20),
    ],
    data_quality: {
      score: 88,
      completeness: 84,
      freshness: 84,
      consistency: 88,
      reliability: 90,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: false,
      max_control_level: "suggest",
      safety_mode: true,
    },
  };
}

function toBand(score: number): "high" | "medium" | "low" {
  if (score >= 68) return "high";
  if (score >= 58) return "medium";
  return "low";
}

export function runNyraInvestorFitVerificationLab(): InvestorFitVerificationReport {
  const outreach = buildNyraInvestorOutreachBranch();
  const byName = new Map(outreach.investor_targets.map((target) => [target.name, target] as const));

  const results: VerifiedResult[] = VERIFIED_CANDIDATES.map((candidate) => {
    const ranked = byName.get(candidate.name);
    if (!ranked) {
      throw new Error(`Missing ranked investor for ${candidate.name}`);
    }
    const core = runUniversalCore(buildCandidateInput(candidate, {
      read_probability: ranked.read_probability,
      reply_probability: ranked.reply_probability,
      meeting_probability: ranked.meeting_probability,
    }));
    const score = Number((
      candidate.stage_fit * 0.1 +
      candidate.ai_core_fit * 0.18 +
      candidate.workflow_fit * 0.16 +
      candidate.finance_fit * 0.08 +
      candidate.cold_channel_quality * 0.1 +
      candidate.differentiation_fit * 0.14 +
      ranked.read_probability * 100 * 0.06 +
      ranked.reply_probability * 100 * 0.08 +
      ranked.meeting_probability * 100 * 0.04 +
      core.priority.score * 0.08 -
      candidate.broadness_risk * 0.1 -
      candidate.late_stage_risk * 0.08 -
      core.risk.score * 0.06
    ).toFixed(6));
    const fit_band = toBand(score);
    const selected = fit_band === "high";
    const whySelected = candidate.official_fit_notes.slice(0, 3);
    const whyNotTop: string[] = [];
    if (candidate.broadness_risk >= 28) whyNotTop.push("fit troppo broad rispetto a un outreach cold iniziale");
    if (candidate.late_stage_risk >= 28) whyNotTop.push("rischio maggiore di essere troppo grande o troppo tardo per una prima apertura cold");
    if (candidate.cold_channel_quality < 55) whyNotTop.push("accesso cold meno leggibile rispetto ai target top");
    return {
      name: candidate.name,
      selected,
      score,
      fit_band,
      region: candidate.region,
      official_sources: candidate.official_sources,
      why_selected: whySelected,
      why_not_top: whyNotTop,
      outreach_probabilities: {
        read_probability: ranked.read_probability,
        reply_probability: ranked.reply_probability,
        meeting_probability: ranked.meeting_probability,
      },
    };
  }).sort((a, b) => b.score - a.score);

  const shortlisted = results.filter((item) => item.selected).slice(0, 8);
  const secondary = results.filter((item) => !shortlisted.some((kept) => kept.name === item.name));

  return {
    runner: "nyra_investor_fit_verification_lab",
    generated_at: new Date().toISOString(),
    purpose: "Verify whether the current investor targets are truly aligned with Universal Core + Nyra and select a cleaner first wave.",
    methodology: {
      branch_input: "Uses the current investor outreach branch probabilities as the starting layer.",
      verification_rule: "Keeps only targets with explicit official evidence of interest in AI, software, workflows, infrastructure, enterprise or fintech relevant to this thesis.",
      selection_rule: "Universal Core scores the verified field; keep now only the targets with the strongest thesis-fit plus realistic cold-access potential.",
    },
    shortlisted_wave_1: shortlisted,
    discarded_or_secondary: secondary,
    summary: {
      keep_now: shortlisted.map((item) => item.name),
      keep_but_second_wave: secondary.filter((item) => item.fit_band !== "low").map((item) => item.name),
      why: [
        "Keep wave 1 tight around AI/core/workflow investors with real official fit evidence.",
        "Do not waste early shots on funds that are too broad, too late-stage, or not explicit enough on this thesis.",
        "Use larger or more generic brands as wave 2 once narrative and response data are stronger.",
      ],
    },
  };
}

function main(): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const report = runNyraInvestorFitVerificationLab();
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(PACK_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    report_path: REPORT_PATH,
    shortlisted_wave_1: report.shortlisted_wave_1.map((item) => ({
      name: item.name,
      score: item.score,
      fit_band: item.fit_band,
    })),
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
