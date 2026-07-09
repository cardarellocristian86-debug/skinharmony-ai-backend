import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { deterministicBranchRegistry } from "../../services/universal-core-service/branches/index.js";
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

const SOURCE_CACHE = new Map<string, NyraBranchLearningSource | null>();

const BRANCH_LEARNING_REGISTRY: Record<string, RegistrySource[]> = {
  core_decision: [
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "domain_verify_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_domain_verify_exercise_latest.json",
      kind: "json_pack",
    },
  ],
  codex_guidance: [
    {
      source_id: "codex_operational_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_codex_operational_learning_pack_v1.json",
      kind: "json_pack",
    },
    {
      source_id: "software_architecture_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_software_architecture_practice_pack_latest.json",
      kind: "json_pack",
    },
  ],
  developer_code: [
    {
      source_id: "software_architecture_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_software_architecture_practice_pack_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "codex_operational_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_codex_operational_learning_pack_v1.json",
      kind: "json_pack",
    },
  ],
  nyra_voice: [
    {
      source_id: "expression_memory_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_expression_memory_pack_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "communication_improvement_lab",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_communication_improvement_lab_latest.json",
      kind: "json_pack",
    },
  ],
  memory_learning: [
    {
      source_id: "learning_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_learning_pack_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "advanced_memory_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_advanced_memory_pack_latest.json",
      kind: "json_pack",
    },
  ],
  event_audit: [
    {
      source_id: "selector_autowrite_policy",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_selector_autowrite_policy_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "autonomous_learning_loop",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_autonomous_learning_loop_latest.json",
      kind: "json_pack",
    },
  ],
  branch_overlay: [
    {
      source_id: "global_router_benchmark",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_global_router_benchmark_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
  render_boundary: [
    {
      source_id: "render_shadow_hardening",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_render_shadow_hardening_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "render_defense",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_render_defense_1000_latest.json",
      kind: "json_pack",
    },
  ],
  runtime_deployment_scaling_guard: [
    {
      source_id: "developer_runtime_seed",
      path: "reports/codex-core/NYRA_DEVELOPER_RUNTIME_BRANCH_LEARNING_SEED_2026-07-09.md",
      kind: "markdown_report",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
  data_integration_orchestration: [
    {
      source_id: "developer_runtime_seed",
      path: "reports/codex-core/NYRA_DEVELOPER_RUNTIME_BRANCH_LEARNING_SEED_2026-07-09.md",
      kind: "markdown_report",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
  smartdesk_product: [
    {
      source_id: "smartdesk_vertical_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_smartdesk_strategic_vertical_branch_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "smartdesk_operational_report",
      path: "reports/smartdesk/SMARTDESK_GOLD_WHY_IT_WORKS_2026-05-19.md",
      kind: "markdown_report",
    },
    {
      source_id: "smartdesk_unified_engine_assessment",
      path: "reports/smartdesk/SMARTDESK_RENDER_GOLD_UNIFIED_ENGINE_ASSESSMENT_2026-05-19.md",
      kind: "markdown_report",
    },
  ],
  suite_wordpress: [
    {
      source_id: "suite_branch_learning_pack",
      path: "universal-core-2.0/universal-core/runtime/nyra-learning/nyra_suite_branch_learning_pack_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "suite_connector_contract",
      path: "reports/wordpress/SUITE_CORE_CODEX_CONNECTOR_ENFORCEMENT_CONTRACT_V1.md",
      kind: "markdown_report",
    },
    {
      source_id: "suite_branch_learning_report",
      path: "reports/wordpress/SUITE_5_3_18_NYRA_BRANCH_LEARNING_2026-06-01.md",
      kind: "markdown_report",
    },
  ],
  financial: [
    {
      source_id: "financial_learning_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_financial_learning_pack_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "financial_live_self_diagnosis",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_financial_self_diagnosis_live_latest.json",
      kind: "json_pack",
    },
  ],
  security: [
    {
      source_id: "cyber_learning_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_cyber_learning_pack_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "privacy_defense_study",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_privacy_defense_study_latest.json",
      kind: "json_pack",
    },
  ],
  software_systems_intelligence: [
    {
      source_id: "developer_runtime_seed",
      path: "reports/codex-core/NYRA_DEVELOPER_RUNTIME_BRANCH_LEARNING_SEED_2026-07-09.md",
      kind: "markdown_report",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
  infrastructure_runtime_intelligence: [
    {
      source_id: "developer_runtime_seed",
      path: "reports/codex-core/NYRA_DEVELOPER_RUNTIME_BRANCH_LEARNING_SEED_2026-07-09.md",
      kind: "markdown_report",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
  change_impact_orchestration: [
    {
      source_id: "developer_runtime_seed",
      path: "reports/codex-core/NYRA_DEVELOPER_RUNTIME_BRANCH_LEARNING_SEED_2026-07-09.md",
      kind: "markdown_report",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
  codex_security_guard: [
    {
      source_id: "security_seed",
      path: "reports/codex-core/NYRA_SECURITY_BRANCH_LEARNING_SEED_2026-07-09.md",
      kind: "markdown_report",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
  software_security_intelligence: [
    {
      source_id: "security_seed",
      path: "reports/codex-core/NYRA_SECURITY_BRANCH_LEARNING_SEED_2026-07-09.md",
      kind: "markdown_report",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
  network_security_intelligence: [
    {
      source_id: "security_seed",
      path: "reports/codex-core/NYRA_SECURITY_BRANCH_LEARNING_SEED_2026-07-09.md",
      kind: "markdown_report",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
  legal_privacy_compliance_guard: [
    {
      source_id: "security_seed",
      path: "reports/codex-core/NYRA_SECURITY_BRANCH_LEARNING_SEED_2026-07-09.md",
      kind: "markdown_report",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
  content_localization_guard: [
    {
      source_id: "marketing_activation_branch",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_marketing_activation_branch_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "expression_memory_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_expression_memory_pack_latest.json",
      kind: "json_pack",
    },
  ],
  skinharmony_analyzer: [
    {
      source_id: "analyzer_voice_library",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_skinharmony_analyzer_voice_library_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "analyzer_branch_learning_seed",
      path: "reports/nyra-analyzer/NYRA_ANALYZER_BRANCH_LEARNING_SEED_2026-07-09.md",
      kind: "markdown_report",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
  beauty_vertical_orchestration: [
    {
      source_id: "analyzer_voice_library",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_skinharmony_analyzer_voice_library_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "analyzer_branch_learning_seed",
      path: "reports/nyra-analyzer/NYRA_ANALYZER_BRANCH_LEARNING_SEED_2026-07-09.md",
      kind: "markdown_report",
    },
    {
      source_id: "marketing_activation_branch",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_marketing_activation_branch_latest.json",
      kind: "json_pack",
    },
  ],
  beauty_protocol_guard: [
    {
      source_id: "analyzer_voice_library",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_skinharmony_analyzer_voice_library_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "analyzer_branch_learning_seed",
      path: "reports/nyra-analyzer/NYRA_ANALYZER_BRANCH_LEARNING_SEED_2026-07-09.md",
      kind: "markdown_report",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
  cosmetic_chemistry: [
    {
      source_id: "analyzer_voice_library",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_skinharmony_analyzer_voice_library_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "marketing_activation_branch",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_marketing_activation_branch_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "decision_clarity_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
      kind: "json_pack",
    },
  ],
};

const CORE_BRANCH_REGISTRY = deterministicBranchRegistry() as Record<string, { domain?: string; label?: string }>;

function inferBranchLearningSources(branchId: string): RegistrySource[] {
  const branch = CORE_BRANCH_REGISTRY[branchId];
  const joined = `${branchId} ${branch?.domain || ""} ${branch?.label || ""}`.toLowerCase();
  if (joined.includes("software") || joined.includes("codex")) {
    return [
      {
        source_id: "software_architecture_pack",
        path: "universal-core-2.0/runtime/nyra-learning/nyra_software_architecture_practice_pack_latest.json",
        kind: "json_pack",
      },
      {
        source_id: "codex_operational_pack",
        path: "universal-core-2.0/runtime/nyra-learning/nyra_codex_operational_learning_pack_v1.json",
        kind: "json_pack",
      },
    ];
  }
  if (joined.includes("hardware") || joined.includes("technology")) {
    return [
      {
        source_id: "runtime_robustness_lab",
        path: "universal-core-2.0/runtime/nyra-learning/nyra_runtime_robustness_lab_latest.json",
        kind: "json_pack",
      },
      {
        source_id: "semantic_substrate",
        path: "universal-core-2.0/runtime/nyra-learning/nyra_semantic_substrate_latest.json",
        kind: "json_pack",
      },
    ];
  }
  if (joined.includes("security") || joined.includes("release") || joined.includes("impact")) {
    return [
      {
        source_id: "cyber_learning_pack",
        path: "universal-core-2.0/runtime/nyra-learning/nyra_cyber_learning_pack_latest.json",
        kind: "json_pack",
      },
      {
        source_id: "privacy_defense_study",
        path: "universal-core-2.0/runtime/nyra-learning/nyra_privacy_defense_study_latest.json",
        kind: "json_pack",
      },
    ];
  }
  if (joined.includes("learning") || joined.includes("memory") || joined.includes("nyra")) {
    return [
      {
        source_id: "learning_pack",
        path: "universal-core-2.0/runtime/nyra-learning/nyra_learning_pack_latest.json",
        kind: "json_pack",
      },
      {
        source_id: "autonomous_learning_loop",
        path: "universal-core-2.0/runtime/nyra-learning/nyra_autonomous_learning_loop_latest.json",
        kind: "json_pack",
      },
    ];
  }
  if (joined.includes("analyzer") || joined.includes("beauty") || joined.includes("cosmetic")) {
    return [
      {
        source_id: "analyzer_voice_library",
        path: "universal-core-2.0/runtime/nyra-learning/nyra_skinharmony_analyzer_voice_library_latest.json",
        kind: "json_pack",
      },
      {
        source_id: "analyzer_benchmark_pack",
        path: "universal-core-2.0/runtime/nyra-learning/nyra_skinharmony_analyzer_benchmark_pack_latest.json",
        kind: "json_pack",
      },
    ];
  }
  if (joined.includes("translator") || joined.includes("translation") || joined.includes("marketing") || joined.includes("suite")) {
    return [
      {
        source_id: "marketing_activation_branch",
        path: "universal-core-2.0/runtime/nyra-learning/nyra_marketing_activation_branch_latest.json",
        kind: "json_pack",
      },
      {
        source_id: "decision_clarity_pack",
        path: "universal-core-2.0/runtime/nyra-learning/nyra_decision_clarity_learning_pack_latest.json",
        kind: "json_pack",
      },
    ];
  }
  return [
    {
      source_id: "universal_scenario_pack",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_universal_scenario_pack_latest.json",
      kind: "json_pack",
    },
    {
      source_id: "semantic_substrate",
      path: "universal-core-2.0/runtime/nyra-learning/nyra_semantic_substrate_latest.json",
      kind: "json_pack",
    },
  ];
}

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function workspaceRootFrom(rootDir?: string): string {
  const base = resolve(rootDir || process.cwd());
  if (basename(base) === "universal-core-2.0") return dirname(base);
  if (basename(base) === "universal-core") return dirname(base);
  let probe = base;
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(join(probe, "universal-core"))) return probe;
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  return base;
}

function candidateSourcePaths(workspaceRoot: string, sourcePath: string): string[] {
  const variants = new Set<string>([
    sourcePath,
    sourcePath.replace(/^universal-core-2\.0\/universal-core\//, "universal-core/"),
    sourcePath.replace(/^universal-core-2\.0\//, "universal-core/"),
  ]);
  return Array.from(variants).map((relativePath) => join(workspaceRoot, relativePath));
}

function readJsonSummary(absPath: string): { title: string; summary: string } | null {
  try {
    const raw = JSON.parse(readFileSync(absPath, "utf8")) as Record<string, unknown>;
    const title = String(
      raw.id ||
      raw.pack_version ||
      raw.runner ||
      raw.branch ||
      basename(absPath, ".json")
    );
    const domains = Array.isArray(raw.domains)
      ? raw.domains
          .slice(0, 3)
          .map((entry) => {
            if (typeof entry === "string") return entry;
            if (entry && typeof entry === "object") {
              const id = String((entry as Record<string, unknown>).id || "");
              const label = String((entry as Record<string, unknown>).label || "");
              return label || id;
            }
            return "";
          })
          .filter(Boolean)
          .join(", ")
      : "";
    const summaryParts = [
      raw.purpose,
      raw.thesis,
      raw.rule,
      raw.summary,
      raw.smartdesk_positioning,
    ]
      .map((value) => (typeof value === "string" ? normalizeLine(value) : ""))
      .filter(Boolean);
    const counts: string[] = [];
    if (typeof raw.records_count === "number") counts.push(`records=${raw.records_count}`);
    if (Array.isArray(raw.targets)) counts.push(`targets=${raw.targets.length}`);
    if (Array.isArray(raw.sources)) counts.push(`sources=${raw.sources.length}`);
    if (Array.isArray(raw.humanizer_contract)) counts.push(`rules=${raw.humanizer_contract.length}`);
    const summary = [summaryParts[0] || "", domains ? `domini ${domains}` : "", counts.join(" ")]
      .filter(Boolean)
      .join(" | ");
    return {
      title,
      summary: summary || normalizeLine(JSON.stringify(raw).slice(0, 220)),
    };
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
    return {
      title,
      summary: normalizeLine(paragraph || title),
    };
  } catch {
    return null;
  }
}

function loadSource(workspaceRoot: string, branchId: NyraBranchId, spec: RegistrySource): NyraBranchLearningSource | null {
  const candidatePaths = candidateSourcePaths(workspaceRoot, spec.path);
  const cacheKey = `${branchId}::${spec.source_id}::${candidatePaths.join("::")}`;
  if (SOURCE_CACHE.has(cacheKey)) return SOURCE_CACHE.get(cacheKey) || null;
  const absPath = candidatePaths.find((candidate) => existsSync(candidate));
  if (!absPath) return null;
  const parsed = spec.kind === "json_pack" ? readJsonSummary(absPath) : readMarkdownSummary(absPath);
  if (!parsed) {
    SOURCE_CACHE.set(cacheKey, null);
    return null;
  }
  const source = {
    branch_id: branchId,
    source_id: spec.source_id,
    title: parsed.title,
    path: spec.path,
    kind: spec.kind,
    summary: parsed.summary,
  };
  SOURCE_CACHE.set(cacheKey, source);
  return source;
}

export function buildNyraBranchLearningBundle(input: {
  root_dir?: string;
  branch_overlay: NyraBranchOverlay;
}): NyraBranchLearningBundle {
  const workspaceRoot = workspaceRootFrom(input.root_dir);
  const entries: NyraBranchLearningEntry[] = input.branch_overlay.active_branches.slice(0, 6).map((branch) => {
    const registry = BRANCH_LEARNING_REGISTRY[branch.id] || inferBranchLearningSources(branch.id);
    const sources = registry
      .map((spec) => loadSource(workspaceRoot, branch.id, spec))
      .filter(Boolean) as NyraBranchLearningSource[];
    return {
      branch_id: branch.id,
      branch_label: branch.label,
      sources,
    };
  }).filter((entry) => entry.sources.length > 0);

  return {
    mode: "branch_learning",
    entries,
  };
}

export function buildNyraBranchLearningLine(bundle?: NyraBranchLearningBundle): string {
  const entries = Array.isArray(bundle?.entries) ? bundle!.entries : [];
  if (!entries.length) return "";
  return `Apprendimento rami: ${entries.slice(0, 3).map((entry) => (
    `${entry.branch_id} -> ${entry.sources.slice(0, 2).map((source) => source.title).join(" + ")}`
  )).join(" | ")}`;
}
