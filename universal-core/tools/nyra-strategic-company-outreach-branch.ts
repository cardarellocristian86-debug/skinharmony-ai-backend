import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runNyraStrategicCompanyFitLab } from "./nyra-strategic-company-fit-lab.ts";

type ContactChannel = {
  type: "contact_sales" | "request_demo" | "contact_request" | "partner_request";
  official_url: string;
  note: string;
};

type StrategicDraft = {
  name: string;
  category: string;
  score: number;
  band: "high" | "medium" | "low";
  channel: ContactChannel;
  subject: string;
  body: string;
};

type StrategicOutreachReport = {
  runner: "nyra_strategic_company_outreach_branch";
  generated_at: string;
  purpose: string;
  drafts: StrategicDraft[];
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const REPORT_DIR = join(ROOT, "reports", "universal-core", "business");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORT_PATH = join(REPORT_DIR, "nyra_strategic_company_outreach_latest.json");
const PACK_PATH = join(RUNTIME_DIR, "nyra_strategic_company_outreach_latest.json");

const CHANNELS: Record<string, ContactChannel> = {
  "ServiceNow": {
    type: "contact_sales",
    official_url: "https://www.servicenow.com/contact-us/sales.html",
    note: "Form ufficiale sales; no email pubblica diretta emersa.",
  },
  "Salesforce": {
    type: "contact_sales",
    official_url: "https://www.salesforce.com/platform/",
    note: "Ingresso migliore: sales/platform path ufficiale, poi contact sales dalla pagina.",
  },
  "Microsoft Dynamics 365": {
    type: "contact_request",
    official_url: "https://www.microsoft.com/en-us/dynamics-365/contact-us",
    note: "Request-a-call ufficiale Dynamics.",
  },
  "SAP": {
    type: "contact_sales",
    official_url: "https://www.sap.com/products/artificial-intelligence.html",
    note: "Entry ufficiale prodotto/AI; contact sales da path SAP commerciale.",
  },
  "Oracle": {
    type: "contact_sales",
    official_url: "https://www.oracle.com/artificial-intelligence/generative-ai/agents/",
    note: "Entry ufficiale agents/OCI; usare sales/contact Oracle dal path prodotto.",
  },
  "Adobe": {
    type: "contact_request",
    official_url: "https://business.adobe.com/",
    note: "Entry enterprise/CX ufficiale; richiesta commerciale tramite percorso business.",
  },
  "Workday": {
    type: "contact_sales",
    official_url: "https://www.workday.com/en-us/artificial-intelligence/ai-agents.html",
    note: "Entry ufficiale AI agents; contact sales da percorso Workday commerciale.",
  },
  "Atlassian": {
    type: "request_demo",
    official_url: "https://www.atlassian.com/software/rovo",
    note: "Entry ufficiale Rovo; demo/contact dal sito Atlassian.",
  },
  "monday.com": {
    type: "request_demo",
    official_url: "https://www.monday.com/w/ai",
    note: "Entry ufficiale monday AI; demo/contact dal sito.",
  },
  "HubSpot": {
    type: "contact_sales",
    official_url: "https://offers.hubspot.com/contact-sales",
    note: "Form ufficiale contact sales con numeri locali.",
  },
};

function buildSubject(name: string): string {
  return `Universal Core + Nyra: possible fit for ${name}`;
}

function buildBody(name: string, category: string): string {
  const angle = (() => {
    switch (category) {
      case "crm":
        return "a reusable intelligence layer that can sit above CRM operations, customer workflows and next-action logic";
      case "workflow":
        return "a reusable intelligence layer that can sit above workflow systems, control surfaces and operational orchestration";
      case "erp_finance":
        return "a reusable intelligence layer that can sit above ERP, finance and operational decision workflows";
      case "enterprise_ai":
        return "a reusable intelligence layer that can sit above enterprise AI, orchestration and agent workflows";
      case "cx_platform":
        return "a reusable intelligence layer that can sit above customer experience, marketing and orchestration workflows";
      default:
        return "a reusable intelligence layer that can sit above real software workflows";
    }
  })();

  return [
    `Hello ${name},`,
    "",
    "I am Cristian Cardarello.",
    "",
    "I am building Universal Core and Nyra: a reusable operating intelligence layer, not a single vertical software product.",
    "",
    `The reason I am reaching out is simple: I believe there may be a fit between your current direction and ${angle}.`,
    "",
    "Today the system is already in use across Smart Desk, Flow, Control Desk and a finance testing branch. Smart Desk is the first live applied shell, but it is not the limit of the architecture.",
    "",
    "Universal Core is the decision and orchestration architecture. Nyra is the operative agent built on top of it. It is not static: it adapts across domains under a controlled architecture and improves through testing, selection and controlled iteration.",
    "",
    "The infrastructure is still compact, but already real and operational. Funding or strategic partnership would not be used to invent the base from zero, but to scale and harden a base that already exists.",
    "",
    "In the clearest live proof so far, Smart Desk has already held 100 centers / 1100 requests with 0 errors and 0 timeouts. In the finance branch, Nyra has already shown strong signals in bubble detection and lateral defense, while still being explicitly treated as a real testing branch, not a finished product.",
    "",
    "If this direction is relevant for your team, I can send a short deck and a tighter strategic note.",
    "",
    "Cristian Cardarello",
  ].join("\n");
}

export function buildNyraStrategicCompanyOutreachBranch(): StrategicOutreachReport {
  const fit = runNyraStrategicCompanyFitLab();
  const drafts: StrategicDraft[] = fit.top_10.map((company) => ({
    name: company.name,
    category: company.category,
    score: company.score,
    band: company.band,
    channel: CHANNELS[company.name],
    subject: buildSubject(company.name),
    body: buildBody(company.name, company.category),
  }));

  return {
    runner: "nyra_strategic_company_outreach_branch",
    generated_at: new Date().toISOString(),
    purpose: "Prepare personalized outreach packs for strategic companies where Universal Core + Nyra could fit as an orchestration/operating-intelligence layer.",
    drafts,
  };
}

function main(): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const report = buildNyraStrategicCompanyOutreachBranch();
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(PACK_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    report_path: REPORT_PATH,
    top_names: report.drafts.slice(0, 5).map((item) => item.name),
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
