import {
  deterministicBranchGroups,
  deterministicBranchRegistry,
} from "../../services/universal-core-service/branches/index.js";

export type NyraBranchId = string;

export type NyraBranchScore = {
  id: NyraBranchId;
  label: string;
  score: number;
  signals: string[];
  domain?: string;
  tier?: string;
  group_ids?: string[];
  source_kind?: "core_branch" | "nyra_meta";
};

export type NyraBranchOverlay = {
  mode: "branch_overlay";
  overlay_model: "omni_360_cortex";
  primary_branch: NyraBranchScore;
  active_branches: NyraBranchScore[];
  overlap_score: number;
  cross_domain: boolean;
  render_protected: boolean;
  action_boundary: "local_only" | "local_only_no_render" | "read_only";
  risk_flags: string[];
  active_group_ids: string[];
  available_branch_count: number;
  taxonomy_schema_version: string;
};

type RegistryBranch = {
  label?: string;
  domain?: string;
  tier?: string;
  description?: string;
  subbranches?: string[];
};

type BranchSpec = {
  id: NyraBranchId;
  label: string;
  domain?: string;
  tier?: string;
  group_ids: string[];
  source_kind: "core_branch" | "nyra_meta";
  terms: string[];
};

const CORE_BRANCH_REGISTRY = deterministicBranchRegistry() as Record<string, RegistryBranch>;
const CORE_BRANCH_GROUPS = deterministicBranchGroups() as Record<string, { label?: string; description?: string; branches?: string[] }>;

const NYRA_META_BRANCHES: BranchSpec[] = [
  {
    id: "nyra_voice",
    label: "Voce e dialogo Nyra",
    domain: "assistant",
    tier: "meta",
    group_ids: ["learning_cortex"],
    source_kind: "nyra_meta",
    terms: ["nyra", "voce", "dialogo", "parla", "rispondi", "chat", "tono", "spiegare meglio"],
  },
  {
    id: "memory_learning",
    label: "Memoria e apprendimento",
    domain: "learning",
    tier: "meta",
    group_ids: ["learning_cortex"],
    source_kind: "nyra_meta",
    terms: ["memoria", "learning", "apprendimento", "impara", "snapshot", "pack", "studio", "feedback"],
  },
  {
    id: "event_audit",
    label: "Eventi e audit",
    domain: "governance",
    tier: "meta",
    group_ids: ["learning_cortex"],
    source_kind: "nyra_meta",
    terms: ["evento", "audit", "log", "jsonl", "traccia", "report", "evidence"],
  },
  {
    id: "render_boundary",
    label: "Confine Render e produzione",
    domain: "governance",
    tier: "meta",
    group_ids: ["security_cortex"],
    source_kind: "nyra_meta",
    terms: ["render", "produzione", "deploy", "live", "release", "tenant", "api key", "chiave"],
  },
];

const MANUAL_HINTS: Record<string, string[]> = {
  software_systems_intelligence: ["software", "architettura", "codice", "sistema", "backend", "frontend", "api", "contratti"],
  hardware_systems_intelligence: ["hardware", "firmware", "device", "sensore", "tricocamera", "cf680", "camera", "router"],
  software_security_intelligence: ["sicurezza software", "vulnerabilita", "auth", "permessi", "segreti"],
  network_security_intelligence: ["rete", "network", "segmentazione", "firewall", "lan", "wifi", "routing"],
  infrastructure_runtime_intelligence: ["runtime", "deploy", "render", "infra", "observability", "rollback"],
  learning_knowledge_intelligence: ["learning", "memoria", "knowledge", "snapshot", "apprendimento", "distillazione"],
  beauty_vertical_orchestration: ["beauty", "protocollo", "analyzer", "smart desk", "suite", "centro", "marketing beauty"],
  translator_marketing_governance: ["traduttore", "traduzione", "microcopy", "cta", "localizzazione", "marketing copy"],
  translation_governance: ["traduzione", "translation", "chiavi", "stringhe", "fallback", "review linguistica"],
  ramo_testo: ["tono", "testo", "copy", "claim", "publish safety", "linguaggio"],
  branch_skingharmony_analyzer: ["analyzer", "pelle", "score", "marker", "tricocamera"],
  skinharmony_analyzer: ["analyzer", "pelle", "score", "marker", "tricocamera"],
  suite_governance: ["suite", "wordpress", "waas", "plugin", "clone", "page quality"],
  executive_gold: ["gold", "redditivita", "priorita", "centro sotto controllo"],
  business_strategy: ["strategia", "business", "commerciale", "offerta", "go to market"],
  marketing_copy: ["marketing", "copy", "headline", "cta", "landing", "commerciale"],
  beauty_market: ["beauty market", "mercato beauty", "posizionamento beauty"],
  cosmetic_chemistry: ["chimica cosmetica", "inci", "attivi", "formulazione"],
  technology_market: ["tecnologia", "macchinario", "device market", "competition"],
  nyra_finance_beauty_test: ["finanza", "trading", "capitale", "mercato", "beauty finance"],
  codex_code_safety: ["codex", "sicurezza codice", "dangerous edit", "write safety"],
  codex_architecture_guard: ["architettura", "guard", "ownership boundary", "contract"],
  codex_test_strategy: ["test strategy", "test", "coverage", "regression"],
  codex_release_gate: ["release", "canary", "preflight", "rollback"],
  codex_security_guard: ["security", "chiavi", "token", "segreti", "scope"],
  codex_product_logic: ["product logic", "workflow", "business rule"],
  codex_ui_ux_guard: ["ui", "ux", "layout", "mobile", "frontend"],
  codex_business_guard: ["pricing", "claim", "commerciale", "contratto"],
  codex_site_factory_guard: ["site factory", "clone", "template", "wordpress"],
  codex_website_visual_guard: ["visual", "brand", "pagina", "hero", "design"],
  change_impact_orchestration: ["impact", "change", "blast radius", "migration", "orchestration"],
};

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

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function branchIntentBonus(text: string, branchId: string): number {
  const hasTranslatorIntent =
    text.includes("traduttore") ||
    text.includes("traduzione") ||
    text.includes("translation") ||
    text.includes("microcopy") ||
    text.includes("cta") ||
    text.includes("localizzazione") ||
    text.includes("fallback") ||
    text.includes("key path") ||
    text.includes("plugin");

  if (hasTranslatorIntent) {
    if (branchId === "translator_marketing_governance") return 96;
    if (branchId === "translation_governance") return 68;
    if (branchId === "marketing_copy") return 24;
    if (branchId === "ramo_testo") return 18;
  }

  const hasAnalyzerIntent =
    text.includes("analyzer") ||
    text.includes("tricocamera") ||
    text.includes("marker") ||
    text.includes("rossore") ||
    text.includes("discromie") ||
    text.includes("payload");

  if (hasAnalyzerIntent) {
    if (branchId === "branch_skinharmony_analyzer" || branchId === "skinharmony_analyzer") return 48;
    if (branchId === "beauty_vertical_orchestration") return 20;
  }

  const hasSecurityIntent =
    text.includes("sicurezza") ||
    text.includes("security") ||
    text.includes("network") ||
    text.includes("rete") ||
    text.includes("vulnerabilita") ||
    text.includes("tenant isolation");

  if (hasSecurityIntent) {
    if (branchId === "software_security_intelligence" || branchId === "network_security_intelligence") return 42;
    if (branchId === "codex_security_guard") return 24;
  }

  return 0;
}

function branchGroupsFor(branchId: string): string[] {
  return Object.entries(CORE_BRANCH_GROUPS)
    .filter(([, group]) => Array.isArray(group.branches) && group.branches.includes(branchId))
    .map(([groupId]) => groupId);
}

function branchTerms(id: string, branch: RegistryBranch): string[] {
  const groupIds = branchGroupsFor(id);
  const groupTerms = groupIds.flatMap((groupId) => {
    const group = CORE_BRANCH_GROUPS[groupId];
    return [groupId, group?.label || "", group?.description || ""];
  });
  const autoTerms = [
    id,
    id.replace(/_/g, " "),
    branch.label || "",
    branch.domain || "",
    branch.tier || "",
    branch.description || "",
    ...(Array.isArray(branch.subbranches) ? branch.subbranches : []),
    ...groupTerms,
  ]
    .flatMap((value) => tokenize(String(value || "")));
  return unique([...(MANUAL_HINTS[id] || []).map(normalize), ...autoTerms]).slice(0, 48);
}

function buildCoreBranchSpecs(): BranchSpec[] {
  return Object.entries(CORE_BRANCH_REGISTRY).map(([id, branch]) => ({
    id,
    label: branch.label || id,
    domain: branch.domain,
    tier: branch.tier,
    group_ids: branchGroupsFor(id),
    source_kind: "core_branch" as const,
    terms: branchTerms(id, branch),
  }));
}

const BRANCHES: BranchSpec[] = [...buildCoreBranchSpecs(), ...NYRA_META_BRANCHES].sort((a, b) => a.id.localeCompare(b.id));

function scoreBranch(text: string, spec: BranchSpec): NyraBranchScore {
  const signals = spec.terms.filter((term) => text.includes(term));
  const groupedBonus = spec.group_ids.length ? 4 : 0;
  const score = Math.max(0,
    signals.length * 16 +
    Math.min(18, spec.group_ids.length * 4) +
    (signals.length > 1 ? 10 : 0) +
    groupedBonus +
    branchIntentBonus(text, spec.id),
  );
  return {
    id: spec.id,
    label: spec.label,
    score,
    signals,
    domain: spec.domain,
    tier: spec.tier,
    group_ids: spec.group_ids,
    source_kind: spec.source_kind,
  };
}

export function buildNyraBranchOverlay(userText: string): NyraBranchOverlay {
  const text = normalize(userText);
  const scored = BRANCHES
    .map((spec) => scoreBranch(text, spec))
    .filter((branch) => branch.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const activeBranches = scored.length
    ? scored.slice(0, 12)
    : [{
        id: "nyra_voice",
        label: "Voce e dialogo Nyra",
        score: 18,
        signals: ["fallback"],
        domain: "assistant",
        tier: "meta",
        group_ids: ["learning_cortex"],
        source_kind: "nyra_meta" as const,
      }];

  const activeGroupIds = unique(activeBranches.flatMap((branch) => branch.group_ids || []));
  const activeDomains = unique(activeBranches.map((branch) => branch.domain || "generic"));
  const renderProtected = activeBranches.some((branch) => branch.id === "render_boundary")
    || text.includes("render")
    || text.includes("produzione")
    || text.includes("deploy");
  const securityTouched = activeBranches.some((branch) => (branch.group_ids || []).includes("security_cortex"))
    || activeBranches.some((branch) => branch.id.includes("security"));
  const automationTouched = text.includes("automation") || text.includes("automatico") || text.includes("autonom");
  const overlapScore = clamp(
    activeBranches.slice(0, 6).reduce((sum, branch) => sum + branch.score, 0) / Math.max(1, activeBranches.slice(0, 6).length),
  );
  const riskFlags = [
    renderProtected ? "render_or_production_mentioned" : "",
    securityTouched ? "security_surface_mentioned" : "",
    automationTouched ? "automation_surface_mentioned" : "",
    activeDomains.length >= 3 ? "multi_domain_overlay" : "",
  ].filter(Boolean);

  return {
    mode: "branch_overlay",
    overlay_model: "omni_360_cortex",
    primary_branch: activeBranches[0]!,
    active_branches: activeBranches,
    overlap_score: overlapScore,
    cross_domain: activeDomains.length >= 3 || activeGroupIds.length >= 3 || overlapScore >= 54,
    render_protected: renderProtected,
    action_boundary: renderProtected ? "local_only_no_render" : "local_only",
    risk_flags: riskFlags,
    active_group_ids: activeGroupIds,
    available_branch_count: BRANCHES.length,
    taxonomy_schema_version: "branch_taxonomy_v2",
  };
}
