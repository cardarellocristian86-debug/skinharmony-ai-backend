import { branchDeskBase } from "./branch-desk-base.js";
import { branchOpsSilver } from "./branch-ops-silver.js";
import { branchExecGold } from "./branch-exec-gold.js";
import { branchSuiteGovernance } from "./branch-suite-governance.js";
import { branchBeautyMarket } from "./branch-beauty-market.js";
import { branchMarketingCopy } from "./branch-marketing-copy.js";
import { branchCosmeticChemistry } from "./branch-cosmetic-chemistry.js";
import { branchTechnologyMarket } from "./branch-technology-market.js";
import { branchBusinessStrategy } from "./branch-business-strategy.js";
import { branchTranslationGovernance } from "./branch-translation-governance.js";
import { branchNyraFinanceBeautyTest } from "./branch-nyra-finance-beauty-test.js";
import { branchRamoTesto } from "./branch-ramo-testo.js";
import { branchCodexCodeSafety } from "./branch-codex-code-safety.js";
import { branchCodexArchitectureGuard } from "./branch-codex-architecture-guard.js";
import { branchCodexTestStrategy } from "./branch-codex-test-strategy.js";
import { branchCodexReleaseGate } from "./branch-codex-release-gate.js";
import { branchCodexSecurityGuard } from "./branch-codex-security-guard.js";
import { branchCodexProductLogic } from "./branch-codex-product-logic.js";
import { branchCodexUiUxGuard } from "./branch-codex-ui-ux-guard.js";
import { branchCodexBusinessGuard } from "./branch-codex-business-guard.js";
import { branchCodexSiteFactoryGuard } from "./branch-codex-site-factory-guard.js";
import { branchCodexWebsiteVisualGuard } from "./branch-codex-website-visual-guard.js";
import { branchCodexWordPressPlatformGuard } from "./branch-codex-wordpress-platform-guard.js";

const BRANCHES = [
  branchDeskBase,
  branchOpsSilver,
  branchExecGold,
  branchSuiteGovernance,
  branchBeautyMarket,
  branchMarketingCopy,
  branchCosmeticChemistry,
  branchTechnologyMarket,
  branchBusinessStrategy,
  branchTranslationGovernance,
  branchRamoTesto,
  branchNyraFinanceBeautyTest,
  branchCodexCodeSafety,
  branchCodexArchitectureGuard,
  branchCodexTestStrategy,
  branchCodexReleaseGate,
  branchCodexSecurityGuard,
  branchCodexProductLogic,
  branchCodexUiUxGuard,
  branchCodexBusinessGuard,
  branchCodexSiteFactoryGuard,
  branchCodexWebsiteVisualGuard,
  branchCodexWordPressPlatformGuard,
];

const CODEX_GUARD_BRANCHES = [
  "codex_code_safety",
  "codex_architecture_guard",
  "codex_test_strategy",
  "codex_release_gate",
  "codex_security_guard",
  "codex_product_logic",
  "codex_ui_ux_guard",
  "codex_business_guard",
  "codex_site_factory_guard",
  "codex_website_visual_guard",
  "codex_wordpress_platform_guard",
];

export const BRANCH_GROUPS = Object.freeze({
  content_intelligence: {
    label: "Content Intelligence",
    description: "Marketing, claim, traduzione, correzione testo, fonti e publish safety.",
    branches: ["marketing_copy", "translation_governance", "ramo_testo", "cosmetic_chemistry", "technology_market"],
  },
  platform_engineering: {
    label: "Platform Engineering",
    description: "WordPress, WooCommerce, plugin, sicurezza codice, test, release e architettura software.",
    branches: [
      "codex_wordpress_platform_guard",
      "codex_code_safety",
      "codex_architecture_guard",
      "codex_test_strategy",
      "codex_release_gate",
      "codex_security_guard",
      "codex_product_logic",
    ],
  },
  site_factory: {
    label: "Site Factory",
    description: "Clonazione siti, creazione nodi, template WaaS, layout, UI responsive e brand kit.",
    branches: ["codex_site_factory_guard", "codex_website_visual_guard", "codex_ui_ux_guard", "suite_governance"],
  },
  business_governance: {
    label: "Business Governance",
    description: "CRM, filiera, listini, pricing, strategia, offerte, contratti e governance commerciale.",
    branches: ["suite_governance", "beauty_market", "business_strategy", "codex_business_guard"],
  },
  security_defense: {
    label: "Security / Defensive Intelligence",
    description: "Tenant isolation, segreti, audit, policy, hardening e difesa da automazioni rischiose.",
    branches: ["codex_security_guard", "codex_code_safety", "codex_release_gate", "codex_architecture_guard"],
  },
  nyra_interpretation: {
    label: "Nyra Interpretation Layer",
    description: "Nyra interpreta e spiega; Core giudica; Codex esegue entro i limiti.",
    branches: ["executive_gold", "business_strategy", "nyra_finance_beauty_test"],
  },
});

export const BRANCH_PACKAGES = Object.freeze({
  starter: ["front_desk_base"],
  base: ["front_desk_base"],
  pro: ["front_desk_base", "operations_silver", "executive_gold", "suite_governance", "marketing_copy", "translation_governance", "ramo_testo"],
  silver: ["front_desk_base", "operations_silver"],
  gold: ["front_desk_base", "operations_silver", "executive_gold"],
  network: ["front_desk_base", "operations_silver", "executive_gold", "suite_governance", "beauty_market", "marketing_copy", "cosmetic_chemistry", "technology_market", "business_strategy", "translation_governance", "ramo_testo"],
  enterprise: ["front_desk_base", "operations_silver", "executive_gold", "suite_governance", "beauty_market", "marketing_copy", "cosmetic_chemistry", "technology_market", "business_strategy", "translation_governance", "ramo_testo"],
  internal: ["front_desk_base", "operations_silver", "executive_gold", "suite_governance", "beauty_market", "marketing_copy", "cosmetic_chemistry", "technology_market", "business_strategy", "translation_governance", "ramo_testo", "nyra_finance_beauty_test", ...CODEX_GUARD_BRANCHES],
  codex_guard: CODEX_GUARD_BRANCHES,
});

export function expandBranchIds(ids = []) {
  const expanded = [];
  const requestedGroups = [];
  for (const rawId of Array.isArray(ids) ? ids : []) {
    const id = String(rawId || "").trim();
    if (!id) continue;
    if (BRANCH_GROUPS[id]) {
      requestedGroups.push(id);
      expanded.push(...BRANCH_GROUPS[id].branches);
    } else {
      expanded.push(id);
    }
  }
  return {
    expanded: [...new Set(expanded)],
    requested_groups: [...new Set(requestedGroups)],
  };
}

export function deterministicBranchRegistry() {
  return Object.fromEntries(
    BRANCHES.map((branch) => [
      branch.id,
      {
        label: branch.label,
        domain: branch.domain,
        tier: branch.tier,
        production_status: branch.production_status,
        description: branch.description,
        file: branch.file,
      },
    ]),
  );
}

export function deterministicBranchGroups() {
  return BRANCH_GROUPS;
}

export function getBranch(branchId) {
  return BRANCHES.find((branch) => branch.id === branchId) || null;
}

export function normalizeTier(tier) {
  const key = String(tier || "").toLowerCase().trim();
  return BRANCH_PACKAGES[key] ? key : "base";
}

export function resolveBranchesForKey(keyRecord, requestedBranches = []) {
  const metadata = keyRecord?.metadata && typeof keyRecord.metadata === "object" ? keyRecord.metadata : {};
  const presetTier =
    keyRecord?.preset === "suite_connector" || keyRecord?.preset === "wordpress_connector"
      ? "network"
      : keyRecord?.preset === "smartdesk_connector"
        ? "gold"
        : keyRecord?.preset === "codex_automation"
          ? "internal"
          : "base";
  const tier = normalizeTier(metadata.tier || keyRecord?.tier || presetTier);
  const fromPackage = BRANCH_PACKAGES[tier] || BRANCH_PACKAGES.base;
  const explicitSource = Array.isArray(metadata.active_branch_groups) && metadata.active_branch_groups.length
    ? [...metadata.active_branch_groups, ...(Array.isArray(metadata.active_branches) ? metadata.active_branches : [])]
    : Array.isArray(metadata.active_branches)
      ? metadata.active_branches.map(String)
      : fromPackage;
  const expandedAllowed = expandBranchIds(explicitSource);
  const allowed = [...new Set(expandedAllowed.expanded)].filter((id) => Boolean(getBranch(id)));
  const expandedRequested = expandBranchIds(requestedBranches);
  const requested = Array.isArray(requestedBranches) && requestedBranches.length
    ? expandedRequested.expanded.filter((id) => allowed.includes(id))
    : allowed;

  return {
    tier,
    allowed_branches: allowed,
    allowed_groups: expandedAllowed.requested_groups,
    requested_groups: expandedRequested.requested_groups,
    selected_branches: requested,
    denied_branches: Array.isArray(requestedBranches) ? expandedRequested.expanded.filter((id) => !allowed.includes(id)) : [],
    denied_groups: Array.isArray(requestedBranches) ? expandedRequested.requested_groups.filter((id) => {
      const group = BRANCH_GROUPS[id];
      return !group || !group.branches.some((branchId) => allowed.includes(branchId));
    }) : [],
  };
}

export function composeBranchContext({ keyRecord, requestedBranches = [], task = "", userInput = "", locale = "it" }) {
  const resolution = resolveBranchesForKey(keyRecord, requestedBranches);
  const branches = resolution.selected_branches.map(getBranch).filter(Boolean);
  const rules = branches.flatMap((branch) => branch.rules.map((rule) => ({ branch_id: branch.id, rule })));
  const guardrails = branches.map((branch) => ({ branch_id: branch.id, ...branch.guardrails }));

  return {
    tenant_id: keyRecord?.tenant_id || "",
    brand_scope: keyRecord?.brand_scope || "",
    tier: resolution.tier,
    task: String(task || ""),
    user_input: String(userInput || ""),
    locale,
    selected_branches: resolution.selected_branches,
    selected_groups: resolution.requested_groups,
    denied_branches: resolution.denied_branches,
    denied_groups: resolution.denied_groups,
    branch_profiles: branches.map((branch) => ({
      id: branch.id,
      label: branch.label,
      domain: branch.domain,
      tier: branch.tier,
      production_status: branch.production_status,
      description: branch.description,
    })),
    branch_groups: Object.fromEntries(
      resolution.requested_groups
        .filter((groupId) => BRANCH_GROUPS[groupId])
        .map((groupId) => [groupId, BRANCH_GROUPS[groupId]]),
    ),
    deterministic_context: {
      rule_count: rules.length,
      rules,
      guardrails,
      global_rules: [
        "Non inventare dati mancanti.",
        "Non eseguire azioni distruttive.",
        "Ogni pubblicazione, invio, cambio prezzo, sync o azione operativa richiede conferma owner/operatore.",
        "Se un ramo non e autorizzato dalla chiave, non deve essere usato nel contesto.",
      ],
    },
    prompt_contract: [
      "Rispondi come assistente operativo del tenant autorizzato, non come chatbot generico.",
      "Usa solo i rami autorizzati.",
      "Distingui sempre fatto, ipotesi e dato mancante.",
      "Produci output breve, operativo, con prossima azione e guardrail.",
    ],
  };
}
