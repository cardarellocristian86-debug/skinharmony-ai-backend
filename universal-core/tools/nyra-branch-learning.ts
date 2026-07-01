import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { NyraBranchId, NyraBranchOverlay } from "./nyra-branch-overlay.ts";

export type NyraBranchLearningSource = {
  branch_id: NyraBranchId;
  source_id: string;
  title: string;
  path: string;
  kind: "json_pack" | "markdown_report";
  summary: string;
};

export type NyraBranchLearningEntry = {
  branch_id: NyraBranchId;
  branch_label: string;
  sources: NyraBranchLearningSource[];
};

export type NyraBranchLearningBundle = {
  mode: "branch_learning";
  entries: NyraBranchLearningEntry[];
};

type RegistrySource = {
  source_id: string;
  path: string;
  kind: "json_pack" | "markdown_report";
};

const BRANCH_LEARNING_REGISTRY: Record<NyraBranchId, RegistrySource[]> = {
  core_decision: [
    { source_id: "decision_clarity_pack", path: "universal-core/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json", kind: "json_pack" },
    { source_id: "software_architecture_pack", path: "universal-core/runtime/nyra-learning/nyra_software_architecture_practice_pack_latest.json", kind: "json_pack" },
  ],
  codex_guidance: [
    { source_id: "software_architecture_pack", path: "universal-core/runtime/nyra-learning/nyra_software_architecture_practice_pack_latest.json", kind: "json_pack" },
  ],
  developer_code: [
    { source_id: "software_architecture_pack", path: "universal-core/runtime/nyra-learning/nyra_software_architecture_practice_pack_latest.json", kind: "json_pack" },
  ],
  nyra_voice: [
    { source_id: "expression_memory_pack", path: "universal-core/runtime/nyra-learning/nyra_expression_memory_pack_latest.json", kind: "json_pack" },
    { source_id: "communication_improvement_lab", path: "universal-core/runtime/nyra-learning/nyra_communication_improvement_lab_latest.json", kind: "json_pack" },
  ],
  memory_learning: [
    { source_id: "learning_pack", path: "universal-core/runtime/nyra-learning/nyra_learning_pack_latest.json", kind: "json_pack" },
    { source_id: "advanced_memory_pack", path: "universal-core/runtime/nyra-learning/nyra_advanced_memory_pack_latest.json", kind: "json_pack" },
  ],
  event_audit: [
    { source_id: "decision_clarity_pack", path: "universal-core/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json", kind: "json_pack" },
  ],
  branch_overlay: [
    { source_id: "decision_clarity_pack", path: "universal-core/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json", kind: "json_pack" },
  ],
  render_boundary: [
    { source_id: "render_shadow_hardening", path: "universal-core/runtime/nyra-learning/nyra_render_shadow_hardening_latest.json", kind: "json_pack" },
    { source_id: "render_defense", path: "universal-core/runtime/nyra-learning/nyra_render_defense_1000_latest.json", kind: "json_pack" },
  ],
  smartdesk_product: [
    { source_id: "smartdesk_vertical_pack", path: "universal-core/runtime/nyra-learning/nyra_smartdesk_strategic_vertical_branch_latest.json", kind: "json_pack" },
    { source_id: "smartdesk_seed", path: "reports/smartdesk/SMARTDESK_OPERATIONAL_SEMANTIC_SEED_2026-07-01.md", kind: "markdown_report" },
  ],
  suite_wordpress: [
    { source_id: "suite_seed", path: "reports/wordpress/SUITE_WAAS_CRM_SEMANTIC_SEED_2026-07-01.md", kind: "markdown_report" },
    { source_id: "decision_clarity_pack", path: "universal-core/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json", kind: "json_pack" },
  ],
  financial: [
    { source_id: "financial_learning_pack", path: "universal-core/runtime/nyra-learning/nyra_financial_learning_pack_latest.json", kind: "json_pack" },
    { source_id: "financial_self_diagnosis", path: "universal-core/runtime/nyra-learning/nyra_financial_self_diagnosis_latest.json", kind: "json_pack" },
  ],
  security: [
    { source_id: "cyber_learning_pack", path: "universal-core/runtime/nyra-learning/nyra_cyber_learning_pack_latest.json", kind: "json_pack" },
    { source_id: "privacy_defense_study", path: "universal-core/runtime/nyra-learning/nyra_privacy_defense_study_latest.json", kind: "json_pack" },
  ],
};

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function workspaceRootFrom(rootDir?: string): string {
  const base = resolve(rootDir || process.cwd());
  if (basename(base) === "universal-core") return dirname(base);
  return base;
}

function readJsonSummary(absPath: string): { title: string; summary: string } | null {
  try {
    const raw = JSON.parse(readFileSync(absPath, "utf8")) as Record<string, unknown>;
    const title = String(raw.id || raw.pack_version || raw.runner || raw.branch || basename(absPath, ".json"));
    const domains = Array.isArray(raw.domains)
      ? raw.domains.slice(0, 3).map((entry) => {
          if (typeof entry === "string") return entry;
          if (entry && typeof entry === "object") {
            const id = String((entry as Record<string, unknown>).id || "");
            const label = String((entry as Record<string, unknown>).label || "");
            return label || id;
          }
          return "";
        }).filter(Boolean).join(", ")
      : "";
    const summaryParts = [raw.purpose, raw.thesis, raw.rule, raw.summary, raw.smartdesk_positioning]
      .map((value) => (typeof value === "string" ? normalizeLine(value) : ""))
      .filter(Boolean);
    const counts: string[] = [];
    if (typeof raw.records_count === "number") counts.push(`records=${raw.records_count}`);
    if (Array.isArray(raw.targets)) counts.push(`targets=${raw.targets.length}`);
    if (Array.isArray(raw.sources)) counts.push(`sources=${raw.sources.length}`);
    if (Array.isArray(raw.humanizer_contract)) counts.push(`rules=${raw.humanizer_contract.length}`);
    const summary = [summaryParts[0] || "", domains ? `domini ${domains}` : "", counts.join(" ")].filter(Boolean).join(" | ");
    return { title, summary: summary || normalizeLine(JSON.stringify(raw).slice(0, 220)) };
  } catch {
    return null;
  }
}

function readMarkdownSummary(absPath: string): { title: string; summary: string } | null {
  try {
    const raw = readFileSync(absPath, "utf8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim());
    const titleLine = lines.find((line) => line.startsWith("#")) || basename(absPath, ".md");
    const title = normalizeLine(titleLine.replace(/^#+\s*/, ""));
    const paragraph = lines.find((line) => line && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("```"));
    return { title, summary: normalizeLine(paragraph || title) };
  } catch {
    return null;
  }
}

function loadSource(workspaceRoot: string, branchId: NyraBranchId, spec: RegistrySource): NyraBranchLearningSource | null {
  const absPath = join(workspaceRoot, spec.path);
  if (!existsSync(absPath)) return null;
  const parsed = spec.kind === "json_pack" ? readJsonSummary(absPath) : readMarkdownSummary(absPath);
  if (!parsed) return null;
  return { branch_id: branchId, source_id: spec.source_id, title: parsed.title, path: spec.path, kind: spec.kind, summary: parsed.summary };
}

export function buildNyraBranchLearningBundle(input: { root_dir?: string; branch_overlay: NyraBranchOverlay; }): NyraBranchLearningBundle {
  const workspaceRoot = workspaceRootFrom(input.root_dir);
  const entries: NyraBranchLearningEntry[] = input.branch_overlay.active_branches.slice(0, 4).map((branch) => {
    const sources = (BRANCH_LEARNING_REGISTRY[branch.id] || []).map((spec) => loadSource(workspaceRoot, branch.id, spec)).filter(Boolean) as NyraBranchLearningSource[];
    return { branch_id: branch.id, branch_label: branch.label, sources };
  }).filter((entry) => entry.sources.length > 0);
  return { mode: "branch_learning", entries };
}
