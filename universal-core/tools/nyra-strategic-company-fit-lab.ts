import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";

type StrategicCompany = {
  name: string;
  category: "crm" | "workflow" | "enterprise_ai" | "erp_finance" | "cx_platform";
  official_sources: string[];
  fit_notes: string[];
  core_fit: number;
  workflow_fit: number;
  crm_or_ops_fit: number;
  finance_fit: number;
  integration_fit: number;
  timing_fit: number;
  strategic_value: number;
  inertia_risk: number;
  too_big_risk: number;
};

type StrategicResult = {
  name: string;
  score: number;
  selected: boolean;
  band: "high" | "medium" | "low";
  category: StrategicCompany["category"];
  official_sources: string[];
  why: string[];
  risks: string[];
};

type StrategicCompanyFitReport = {
  runner: "nyra_strategic_company_fit_lab";
  generated_at: string;
  thesis: string;
  top_10: StrategicResult[];
  top_5_now: StrategicResult[];
  hold_later: StrategicResult[];
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const REPORT_DIR = join(ROOT, "reports", "universal-core", "business");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORT_PATH = join(REPORT_DIR, "nyra_strategic_company_fit_latest.json");
const PACK_PATH = join(RUNTIME_DIR, "nyra_strategic_company_fit_latest.json");

function signal(id: string, category: string, normalized: number, expected: number, risk: number, friction: number): UniversalSignal {
  return {
    id,
    source: "nyra_strategic_company_fit_lab",
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
    tags: ["strategic_company_fit"],
  };
}

const COMPANIES: StrategicCompany[] = [
  {
    name: "ServiceNow",
    category: "workflow",
    official_sources: [
      "https://newsroom.servicenow.com/press-releases/details/2025/ServiceNow-Unveils-the-New-ServiceNow-AI-Platform-to-Put-Any-AI-Any-Agent-Any-Model-to-Work-Across-the-Enterprise/default.aspx",
      "https://newsroom.servicenow.com/press-releases/details/2025/ServiceNows-latest-platform-release-adds-to-thousands-of-AI-agents-across-CRM-HR-IT-and-more-for-faster-smarter-workflows-and-maximum-business-impact-03-12-2025-traffic/default.aspx",
    ],
    fit_notes: [
      "ServiceNow parla esplicitamente di AI platform, agents e workflow orchestration across the enterprise.",
      "Fit altissimo per Universal Core come decision/orchestration layer.",
    ],
    core_fit: 96, workflow_fit: 98, crm_or_ops_fit: 88, finance_fit: 62, integration_fit: 94, timing_fit: 86, strategic_value: 96, inertia_risk: 34, too_big_risk: 30,
  },
  {
    name: "Salesforce",
    category: "crm",
    official_sources: [
      "https://www.salesforce.com/platform/",
      "https://www.salesforce.com/products/platform/overview/",
    ],
    fit_notes: [
      "Salesforce Agentforce 360 unisce humans, data e AI agents su un'unica platform.",
      "Smart Desk come shell CRM/ops lo rende un fit molto leggibile.",
    ],
    core_fit: 92, workflow_fit: 92, crm_or_ops_fit: 96, finance_fit: 54, integration_fit: 92, timing_fit: 82, strategic_value: 94, inertia_risk: 36, too_big_risk: 34,
  },
  {
    name: "Microsoft Dynamics 365",
    category: "erp_finance",
    official_sources: [
      "https://learn.microsoft.com/en-us/dynamics365/copilot/",
      "https://www.microsoft.com/en-us/dynamics-365/blog/business-leader/2026/03/18/2026-release-wave-1-plans-for-microsoft-dynamics-365-microsoft-power-platform-and-copilot-studio-offerings/",
    ],
    fit_notes: [
      "Dynamics 365 combina agents, Copilot e built-in AI across ERP and CRM.",
      "Fit forte per integrazione sopra sistemi reali e per ramo finance.",
    ],
    core_fit: 90, workflow_fit: 88, crm_or_ops_fit: 90, finance_fit: 86, integration_fit: 94, timing_fit: 80, strategic_value: 94, inertia_risk: 34, too_big_risk: 36,
  },
  {
    name: "SAP",
    category: "erp_finance",
    official_sources: [
      "https://www.sap.com/products/artificial-intelligence.html",
      "https://www.sap.com/products/artificial-intelligence/ai-agents.html",
      "https://www.sap.com/sea/products/artificial-intelligence/joule-studio.html",
    ],
    fit_notes: [
      "SAP Joule Agents e Joule Studio parlano di multi-step workflows, process grounding e non-SAP systems.",
      "Fit molto forte per finance/ERP/orchestration.",
    ],
    core_fit: 94, workflow_fit: 92, crm_or_ops_fit: 78, finance_fit: 94, integration_fit: 92, timing_fit: 82, strategic_value: 95, inertia_risk: 32, too_big_risk: 30,
  },
  {
    name: "Oracle",
    category: "enterprise_ai",
    official_sources: [
      "https://www.oracle.com/artificial-intelligence/generative-ai/agents/",
    ],
    fit_notes: [
      "Oracle OCI Enterprise AI parla esplicitamente di production-ready agents e agentic workflows con governance.",
      "Fit forte lato enterprise AI infra + finance adjacency.",
    ],
    core_fit: 90, workflow_fit: 88, crm_or_ops_fit: 74, finance_fit: 84, integration_fit: 90, timing_fit: 80, strategic_value: 90, inertia_risk: 30, too_big_risk: 32,
  },
  {
    name: "Adobe",
    category: "cx_platform",
    official_sources: [
      "https://news.adobe.com/news/2026/04/adobe-unveils-cx-enterprise-coworker",
      "https://news.adobe.com/news/2025/09/adobe-announces-general-availability-ai-agents",
      "https://news.adobe.com/news/2026/04/adobe-redefines-custome-experience",
    ],
    fit_notes: [
      "Adobe parla di customer experience orchestration, AI agents e open architecture.",
      "Fit forte se vuoi spingere marketing/workflow/customer intelligence.",
    ],
    core_fit: 88, workflow_fit: 90, crm_or_ops_fit: 82, finance_fit: 46, integration_fit: 86, timing_fit: 84, strategic_value: 88, inertia_risk: 26, too_big_risk: 28,
  },
  {
    name: "Workday",
    category: "erp_finance",
    official_sources: [
      "https://investor.workday.com/news-and-events/press-releases/news-details/2025/Workday-Announces-New-AI-Agent-Partner-Network-and-Agent-Gateway-to-Power-the-Next-Generation-of-Human-and-Digital-Workforces-06-03-2025/default.aspx",
      "https://newsroom.workday.com/2025-05-19-Workday-Unveils-Next-Generation-of-Illuminate-Agents-to-Transform-HR-and-Finance-Operations",
      "https://www.workday.com/en-us/artificial-intelligence/ai-agents.html",
    ],
    fit_notes: [
      "Workday si definisce AI platform for managing people, money and agents.",
      "Ha Agent System of Record e forte fit finance/operations.",
    ],
    core_fit: 92, workflow_fit: 88, crm_or_ops_fit: 72, finance_fit: 92, integration_fit: 88, timing_fit: 84, strategic_value: 92, inertia_risk: 26, too_big_risk: 28,
  },
  {
    name: "Atlassian",
    category: "workflow",
    official_sources: [
      "https://www.atlassian.com/software/rovo",
      "https://support.atlassian.com/rovo/docs/what-is-rovo/",
      "https://www.atlassian.com/software/rovo/features",
    ],
    fit_notes: [
      "Rovo connette knowledge, search, chat, agents e third-party apps.",
      "Fit molto forte per control/workflow/knowledge layer.",
    ],
    core_fit: 88, workflow_fit: 94, crm_or_ops_fit: 70, finance_fit: 40, integration_fit: 90, timing_fit: 86, strategic_value: 86, inertia_risk: 22, too_big_risk: 24,
  },
  {
    name: "monday.com",
    category: "workflow",
    official_sources: [
      "https://support.monday.com/hc/en-us/articles/11512670770834-Get-started-with-monday-AI",
      "https://support.monday.com/hc/en-us/articles/11065311570066-Get-started-with-monday-workflows",
      "https://www.monday.com/w/ai",
    ],
    fit_notes: [
      "monday AI e monday workflows mostrano AI blocks, workflow builder e digital workforce.",
      "Fit forte lato control/workflow/SMB-midmarket ops.",
    ],
    core_fit: 84, workflow_fit: 92, crm_or_ops_fit: 76, finance_fit: 34, integration_fit: 82, timing_fit: 88, strategic_value: 82, inertia_risk: 18, too_big_risk: 18,
  },
  {
    name: "HubSpot",
    category: "crm",
    official_sources: [
      "https://www.hubspot.com/products/crm/ai-crm",
      "https://www.hubspot.com/products/artificial-intelligence",
      "https://www.hubspot.com/products/artificial-intelligence/ai-data-agent",
    ],
    fit_notes: [
      "HubSpot Smart CRM e Breeze Data Agent parlano di next action, unified intelligence e customer data agent.",
      "Fit forte lato CRM, marketing e customer intelligence.",
    ],
    core_fit: 84, workflow_fit: 80, crm_or_ops_fit: 94, finance_fit: 30, integration_fit: 82, timing_fit: 88, strategic_value: 82, inertia_risk: 18, too_big_risk: 20,
  },
];

function buildInput(company: StrategicCompany): UniversalCoreInput {
  return {
    request_id: `nyra-strategic-company-fit:${company.name}`,
    generated_at: new Date().toISOString(),
    domain: "custom",
    context: {
      mode: "nyra_strategic_company_fit_lab",
      metadata: {
        semantic_intent: "open_help",
        semantic_mode: "strategic_company_selection",
        company_name: company.name,
      },
    },
    signals: [
      signal(`${company.name}:core_fit`, "core_fit", company.core_fit, 88, 12, 8),
      signal(`${company.name}:workflow_fit`, "workflow_fit", company.workflow_fit, 88, 12, 8),
      signal(`${company.name}:crm_or_ops_fit`, "crm_or_ops_fit", company.crm_or_ops_fit, 80, 14, 10),
      signal(`${company.name}:finance_fit`, "finance_fit", company.finance_fit, 70, 16, 10),
      signal(`${company.name}:integration_fit`, "integration_fit", company.integration_fit, 86, 12, 8),
      signal(`${company.name}:timing_fit`, "timing_fit", company.timing_fit, 82, 12, 8),
      signal(`${company.name}:strategic_value`, "strategic_value", company.strategic_value, 88, 12, 8),
      signal(`${company.name}:inertia_risk`, "inertia_risk", company.inertia_risk, 18, company.inertia_risk, 20),
      signal(`${company.name}:too_big_risk`, "too_big_risk", company.too_big_risk, 18, company.too_big_risk, 20),
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

function band(score: number): "high" | "medium" | "low" {
  if (score >= 72) return "high";
  if (score >= 62) return "medium";
  return "low";
}

export function runNyraStrategicCompanyFitLab(): StrategicCompanyFitReport {
  const top_10 = COMPANIES.map((company) => {
    const core = runUniversalCore(buildInput(company));
    const score = Number((
      company.core_fit * 0.18 +
      company.workflow_fit * 0.16 +
      company.crm_or_ops_fit * 0.12 +
      company.finance_fit * 0.1 +
      company.integration_fit * 0.12 +
      company.timing_fit * 0.1 +
      company.strategic_value * 0.14 +
      core.priority.score * 0.1 -
      company.inertia_risk * 0.08 -
      company.too_big_risk * 0.06 -
      core.risk.score * 0.08
    ).toFixed(6));
    const selectedBand = band(score);
    return {
      name: company.name,
      score,
      selected: selectedBand === "high",
      band: selectedBand,
      category: company.category,
      official_sources: company.official_sources,
      why: company.fit_notes,
      risks: [
        company.inertia_risk >= 28 ? "inerzia enterprise alta" : "inerzia gestibile",
        company.too_big_risk >= 28 ? "azienda molto grande: outreach piu difficile" : "dimensione ancora attaccabile",
      ],
    } satisfies StrategicResult;
  }).sort((a, b) => b.score - a.score);

  return {
    runner: "nyra_strategic_company_fit_lab",
    generated_at: new Date().toISOString(),
    thesis: "Find 10 established strategic companies that could plausibly care about Universal Core + Nyra as an orchestration/operating-intelligence layer, not just as a beauty vertical tool.",
    top_10,
    top_5_now: top_10.filter((item) => item.selected).slice(0, 5),
    hold_later: top_10.filter((item) => !item.selected),
  };
}

function main(): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const report = runNyraStrategicCompanyFitLab();
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(PACK_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    report_path: REPORT_PATH,
    top_5_now: report.top_5_now.map((item) => ({ name: item.name, score: item.score, band: item.band })),
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
