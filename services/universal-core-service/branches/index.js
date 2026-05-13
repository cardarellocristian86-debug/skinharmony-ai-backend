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
];

export const BRANCH_PACKAGES = Object.freeze({
  base: ["front_desk_base"],
  silver: ["front_desk_base", "operations_silver"],
  gold: ["front_desk_base", "operations_silver", "executive_gold"],
  network: ["front_desk_base", "operations_silver", "executive_gold", "suite_governance", "beauty_market", "marketing_copy", "cosmetic_chemistry", "technology_market", "business_strategy", "translation_governance", "ramo_testo"],
  enterprise: ["front_desk_base", "operations_silver", "executive_gold", "suite_governance", "beauty_market", "marketing_copy", "cosmetic_chemistry", "technology_market", "business_strategy", "translation_governance", "ramo_testo"],
  internal: ["front_desk_base", "operations_silver", "executive_gold", "suite_governance", "beauty_market", "marketing_copy", "cosmetic_chemistry", "technology_market", "business_strategy", "translation_governance", "ramo_testo", "nyra_finance_beauty_test"],
});

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
  const explicit = Array.isArray(metadata.active_branches) && metadata.active_branches.length
    ? metadata.active_branches.map(String)
    : fromPackage;
  const allowed = [...new Set(explicit)].filter((id) => Boolean(getBranch(id)));
  const requested = Array.isArray(requestedBranches) && requestedBranches.length
    ? requestedBranches.map(String).filter((id) => allowed.includes(id))
    : allowed;

  return {
    tier,
    allowed_branches: allowed,
    selected_branches: requested,
    denied_branches: Array.isArray(requestedBranches) ? requestedBranches.map(String).filter((id) => !allowed.includes(id)) : [],
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
    denied_branches: resolution.denied_branches,
    branch_profiles: branches.map((branch) => ({
      id: branch.id,
      label: branch.label,
      domain: branch.domain,
      tier: branch.tier,
      production_status: branch.production_status,
      description: branch.description,
    })),
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
      "Rispondi come assistente operativo SkinHarmony, non come chatbot generico.",
      "Usa solo i rami autorizzati.",
      "Distingui sempre fatto, ipotesi e dato mancante.",
      "Produci output breve, operativo, con prossima azione e guardrail.",
    ],
  };
}
