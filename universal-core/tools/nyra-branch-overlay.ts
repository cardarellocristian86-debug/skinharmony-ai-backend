export type NyraBranchId =
  | "core_decision"
  | "codex_guidance"
  | "developer_code"
  | "nyra_voice"
  | "memory_learning"
  | "event_audit"
  | "branch_overlay"
  | "render_boundary"
  | "smartdesk_product"
  | "suite_wordpress"
  | "translator_marketing"
  | "financial"
  | "security";

export type NyraBranchScore = {
  id: NyraBranchId;
  label: string;
  score: number;
  signals: string[];
};

export type NyraBranchOverlay = {
  mode: "branch_overlay";
  primary_branch: NyraBranchScore;
  active_branches: NyraBranchScore[];
  overlap_score: number;
  cross_domain: boolean;
  render_protected: boolean;
  action_boundary: "local_only" | "local_only_no_render" | "read_only";
  risk_flags: string[];
};

type BranchSpec = {
  id: NyraBranchId;
  label: string;
  terms: string[];
};

const BRANCHES: BranchSpec[] = [
  {
    id: "core_decision",
    label: "Core decide e seleziona",
    terms: ["core", "decision", "decidere", "scegli", "giudice", "selettore", "ranking", "opzione migliore"],
  },
  {
    id: "codex_guidance",
    label: "Guida Codex AI",
    terms: ["codex", "ai codex", "guidare codex", "comando", "comandi", "setup", "connector", "automation"],
  },
  {
    id: "developer_code",
    label: "Programmatore / codice",
    terms: [
      "programmatore",
      "developer",
      "codice",
      "debug",
      "bug",
      "fix",
      "patch",
      "test",
      "refactor",
      "typescript",
      "javascript",
      "funzione",
      "errore",
      "compila",
      "build",
      "lint",
      "file",
      "implementa",
      "sistema",
      "correggi",
      "correggere",
    ],
  },
  {
    id: "nyra_voice",
    label: "Voce e dialogo Nyra",
    terms: ["nyra", "parla", "parlare", "chat", "voce", "rispondi", "dialogo", "generativa"],
  },
  {
    id: "memory_learning",
    label: "Memoria e apprendimento",
    terms: ["memoria", "apprendimento", "learning", "impara", "appreso", "snapshot", "pack", "conoscenza"],
  },
  {
    id: "event_audit",
    label: "Eventi e audit",
    terms: ["evento", "eventi", "audit", "jsonl", "traccia", "log", "report", "evidence"],
  },
  {
    id: "branch_overlay",
    label: "Sovrapposizione rami",
    terms: ["rami", "ramo", "sovrapp", "overlay", "overlap", "branch", "incrocia", "collega"],
  },
  {
    id: "render_boundary",
    label: "Confine Render/produzione",
    terms: ["render", "produzione", "deploy", "live", "checkout", "tenant", "api key", "chiave", "prod"],
  },
  {
    id: "smartdesk_product",
    label: "Smart Desk",
    terms: ["smart desk", "smartdesk", "gestionale", "agenda", "gold", "silver", "base", "centro"],
  },
  {
    id: "suite_wordpress",
    label: "Suite/WordPress",
    terms: ["suite", "wordpress", "site suite", "plugin", "waas", "sito", "template clone"],
  },
  {
    id: "translator_marketing",
    label: "Traduttore marketing / localizzazione app",
    terms: ["traduttore", "translator", "traduzione", "translation", "localizzazione", "microcopy", "cta", "ui label", "help text", "onboarding", "plugin translator"],
  },
  {
    id: "financial",
    label: "Finanza/protezione capitale",
    terms: ["finanza", "trading", "capitale", "mercato", "profitto", "short", "qqq", "borsa"],
  },
  {
    id: "security",
    label: "Sicurezza e segreti",
    terms: ["segreto", "token", "password", "chiavi", "api key", "rotazione", "security", "permessi"],
  },
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function scoreBranch(text: string, spec: BranchSpec): NyraBranchScore {
  const signals = spec.terms.filter((term) => text.includes(normalize(term)));
  const score = clamp(signals.length * 22 + (signals.length > 1 ? 10 : 0));
  return {
    id: spec.id,
    label: spec.label,
    score,
    signals,
  };
}

export function buildNyraBranchOverlay(userText: string): NyraBranchOverlay {
  const text = normalize(userText);
  const scored = BRANCHES
    .map((spec) => scoreBranch(text, spec))
    .filter((branch) => branch.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const activeBranches = scored.length
    ? scored
    : [{
        id: "nyra_voice" as const,
        label: "Voce e dialogo Nyra",
        score: 18,
        signals: ["fallback"],
      }];

  const renderProtected = activeBranches.some((branch) => branch.id === "render_boundary");
  const securityTouched = activeBranches.some((branch) => branch.id === "security");
  const automationTouched = text.includes("automation") || text.includes("automatico") || text.includes("autonom");
  const overlapScore = clamp(
    activeBranches.slice(0, 4).reduce((sum, branch) => sum + branch.score, 0) / Math.max(1, activeBranches.slice(0, 4).length),
  );
  const riskFlags = [
    renderProtected ? "render_or_production_mentioned" : "",
    securityTouched ? "secret_or_key_surface_mentioned" : "",
    automationTouched ? "automation_surface_mentioned" : "",
  ].filter(Boolean);

  return {
    mode: "branch_overlay",
    primary_branch: activeBranches[0]!,
    active_branches: activeBranches,
    overlap_score: overlapScore,
    cross_domain: activeBranches.length >= 3 || overlapScore >= 50,
    render_protected: renderProtected,
    action_boundary: renderProtected ? "local_only_no_render" : "local_only",
    risk_flags: riskFlags,
  };
}
