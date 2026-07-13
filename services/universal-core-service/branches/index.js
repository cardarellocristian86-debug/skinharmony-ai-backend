import { branchDeskBase } from "./branch-desk-base.js";
import { branchOpsSilver } from "./branch-ops-silver.js";
import { branchExecGold } from "./branch-exec-gold.js";
import { branchSuiteGovernance } from "./branch-suite-governance.js";
import { branchBeautyMarket } from "./branch-beauty-market.js";
import { branchMarketingCopy } from "./branch-marketing-copy.js";
import { branchPaidAdsGuard } from "./branch-paid-ads-guard.js";
import { branchLifecycleCrmGuard } from "./branch-lifecycle-crm-guard.js";
import { branchCustomerBehaviorAnalysis } from "./branch-customer-behavior-analysis.js";
import { branchSegmentationOfferGuard } from "./branch-segmentation-offer-guard.js";
import { branchFunnelConversionGuard } from "./branch-funnel-conversion-guard.js";
import { branchEmailRecallGuard } from "./branch-email-recall-guard.js";
import { branchContentLocalizationGuard } from "./branch-content-localization-guard.js";
import { branchCosmeticChemistry } from "./branch-cosmetic-chemistry.js";
import { branchSkinHarmonyAnalyzer } from "./branch-skinharmony-analyzer.js";
import { branchTechnologyMarket } from "./branch-technology-market.js";
import { branchBusinessStrategy } from "./branch-business-strategy.js";
import { branchTranslationGovernance } from "./branch-translation-governance.js";
import { branchTranslatorMarketingGovernance } from "./branch-translator-marketing-governance.js";
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
import { branchDataIntegrationOrchestration } from "./branch-data-integration-orchestration.js";
import { branchCommerceFulfillmentGuard } from "./branch-commerce-fulfillment-guard.js";
import { branchObservabilityRoiGuard } from "./branch-observability-roi-guard.js";
import { branchLegalPrivacyComplianceGuard } from "./branch-legal-privacy-compliance-guard.js";
import { branchAgentOrchestrationGuard } from "./branch-agent-orchestration-guard.js";
import { branchRuntimeDeploymentScalingGuard } from "./branch-runtime-deployment-scaling-guard.js";
import { branchConsentLedgerGuard } from "./branch-consent-ledger-guard.js";
import { branchEventTaxonomyGuard } from "./branch-event-taxonomy-guard.js";
import { branchCustomer360Guard } from "./branch-customer-360-guard.js";
import { branchJourneyOrchestrationGuard } from "./branch-journey-orchestration-guard.js";
import { branchBillingContractGuard } from "./branch-billing-contract-guard.js";
import { branchSupportSuccessGuard } from "./branch-support-success-guard.js";
import { branchBeautyValueChainGuard } from "./branch-beauty-value-chain-guard.js";
import { branchBrandDistributorNetworkGuard } from "./branch-brand-distributor-network-guard.js";
import { branchProductInventoryGuard } from "./branch-product-inventory-guard.js";
import { branchSmartDeskOperationsGuard } from "./branch-smartdesk-operations-guard.js";
import { branchBeautyProtocolGuard } from "./branch-beauty-protocol-guard.js";
import { branchChangeImpactOrchestration } from "./branch-change-impact-orchestration.js";
import { branchSoftwareSystemsIntelligence } from "./branch-software-systems-intelligence.js";
import { branchSoftwareBinaryIntelligence } from "./branch-software-binary-intelligence.js";
import { branchHardwareSystemsIntelligence } from "./branch-hardware-systems-intelligence.js";
import { branchSoftwareSecurityIntelligence } from "./branch-software-security-intelligence.js";
import { branchNetworkSecurityIntelligence } from "./branch-network-security-intelligence.js";
import { branchInfrastructureRuntimeIntelligence } from "./branch-infrastructure-runtime-intelligence.js";
import { branchLearningKnowledgeIntelligence } from "./branch-learning-knowledge-intelligence.js";
import { branchWorkIntakeIntelligence } from "./branch-work-intake-intelligence.js";
import { branchResearchEvidenceIntelligence } from "./branch-research-evidence-intelligence.js";
import { branchPlanningPriorityIntelligence } from "./branch-planning-priority-intelligence.js";
import { branchExecutionCoordinationIntelligence } from "./branch-execution-coordination-intelligence.js";
import { branchQualityVerificationIntelligence } from "./branch-quality-verification-intelligence.js";
import { branchAdaptiveLearningIntelligence } from "./branch-adaptive-learning-intelligence.js";
import { branchBeautyVerticalOrchestration } from "./branch-beauty-vertical-orchestration.js";
import { buildBranchTaxonomyFromRegistry } from "./branch-taxonomy.js";
import { branchAllowedForDomainPack, resolveDomainPackForKey } from "../src/domainPacks.js";

const BRANCHES = [
  branchDeskBase,
  branchOpsSilver,
  branchExecGold,
  branchSuiteGovernance,
  branchBeautyMarket,
  branchMarketingCopy,
  branchPaidAdsGuard,
  branchLifecycleCrmGuard,
  branchCustomerBehaviorAnalysis,
  branchSegmentationOfferGuard,
  branchFunnelConversionGuard,
  branchEmailRecallGuard,
  branchContentLocalizationGuard,
  branchCosmeticChemistry,
  branchSkinHarmonyAnalyzer,
  branchTechnologyMarket,
  branchBusinessStrategy,
  branchTranslationGovernance,
  branchTranslatorMarketingGovernance,
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
  branchDataIntegrationOrchestration,
  branchCommerceFulfillmentGuard,
  branchObservabilityRoiGuard,
  branchLegalPrivacyComplianceGuard,
  branchAgentOrchestrationGuard,
  branchRuntimeDeploymentScalingGuard,
  branchConsentLedgerGuard,
  branchEventTaxonomyGuard,
  branchCustomer360Guard,
  branchJourneyOrchestrationGuard,
  branchBillingContractGuard,
  branchSupportSuccessGuard,
  branchBeautyValueChainGuard,
  branchBrandDistributorNetworkGuard,
  branchProductInventoryGuard,
  branchSmartDeskOperationsGuard,
  branchBeautyProtocolGuard,
  branchSoftwareSystemsIntelligence,
  branchSoftwareBinaryIntelligence,
  branchHardwareSystemsIntelligence,
  branchSoftwareSecurityIntelligence,
  branchNetworkSecurityIntelligence,
  branchInfrastructureRuntimeIntelligence,
  branchLearningKnowledgeIntelligence,
  branchWorkIntakeIntelligence,
  branchResearchEvidenceIntelligence,
  branchPlanningPriorityIntelligence,
  branchExecutionCoordinationIntelligence,
  branchQualityVerificationIntelligence,
  branchAdaptiveLearningIntelligence,
  branchBeautyVerticalOrchestration,
  branchChangeImpactOrchestration,
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
  "data_integration_orchestration",
  "commerce_fulfillment_guard",
  "observability_roi_guard",
  "legal_privacy_compliance_guard",
  "agent_orchestration_guard",
  "runtime_deployment_scaling_guard",
  "change_impact_orchestration",
];

const MARKETING_INTELLIGENCE_BRANCHES = [
  "marketing_copy",
  "paid_ads_guard",
  "lifecycle_crm_guard",
  "customer_behavior_analysis",
  "customer_360_guard",
  "consent_ledger_guard",
  "event_taxonomy_guard",
  "journey_orchestration_guard",
  "segmentation_offer_guard",
  "funnel_conversion_guard",
  "email_recall_guard",
  "content_localization_guard",
  "ramo_testo",
  "translation_governance",
  "translator_marketing_governance",
  "cosmetic_chemistry",
  "skinharmony_analyzer",
  "technology_market",
  "beauty_market",
];

const SOFTWARE_CORTEX_BRANCHES = [
  "software_systems_intelligence",
  "software_binary_intelligence",
  "codex_code_safety",
  "codex_architecture_guard",
  "codex_test_strategy",
  "codex_release_gate",
  "codex_product_logic",
  "codex_wordpress_platform_guard",
  "change_impact_orchestration",
];

const HARDWARE_CORTEX_BRANCHES = [
  "hardware_systems_intelligence",
  "infrastructure_runtime_intelligence",
  "runtime_deployment_scaling_guard",
  "observability_roi_guard",
  "change_impact_orchestration",
];

const SECURITY_CORTEX_BRANCHES = [
  "software_security_intelligence",
  "network_security_intelligence",
  "codex_security_guard",
  "legal_privacy_compliance_guard",
  "agent_orchestration_guard",
  "runtime_deployment_scaling_guard",
];

export const HORIZONTAL_WORK_BRANCHES = Object.freeze([
  "work_intake_intelligence",
  "research_evidence_intelligence",
  "planning_priority_intelligence",
  "execution_coordination_intelligence",
  "quality_verification_intelligence",
  "adaptive_learning_intelligence",
]);

const LEARNING_CORTEX_BRANCHES = [
  "adaptive_learning_intelligence",
  "research_evidence_intelligence",
  "quality_verification_intelligence",
  "learning_knowledge_intelligence",
  "observability_roi_guard",
  "change_impact_orchestration",
  "agent_orchestration_guard",
  "runtime_deployment_scaling_guard",
];

const BEAUTY_CORTEX_BRANCHES = [
  "beauty_vertical_orchestration",
  "skinharmony_analyzer",
  "beauty_protocol_guard",
  "beauty_market",
  "cosmetic_chemistry",
  "technology_market",
  "marketing_copy",
  "translator_marketing_governance",
  "ramo_testo",
  "customer_360_guard",
  "smartdesk_operations_guard",
];

export const BRANCH_GROUPS = Object.freeze({
  work_cortex: {
    label: "Horizontal Work Cortex",
    description: "Intake, ricerca, piano, coordinamento parallelo, verifica e apprendimento governato per qualsiasi dominio.",
    branches: HORIZONTAL_WORK_BRANCHES,
  },
  customer_intelligence: {
    label: "Customer Intelligence",
    description: "Profilo cliente/account, consensi, eventi, Customer 360, journey, lifecycle e next best action controllata.",
    branches: ["consent_ledger_guard", "event_taxonomy_guard", "customer_360_guard", "customer_behavior_analysis", "lifecycle_crm_guard", "journey_orchestration_guard", "email_recall_guard"],
  },
  content_intelligence: {
    label: "Content Intelligence",
    description: "Marketing, claim, traduzione, correzione testo, fonti e publish safety.",
    branches: ["marketing_copy", "content_localization_guard", "translation_governance", "translator_marketing_governance", "ramo_testo", "cosmetic_chemistry", "technology_market"],
  },
  marketing_intelligence: {
    label: "Marketing Intelligence",
    description: "Albero marketing: copy, ads, CRM lifecycle, comportamento clienti, segmenti/offerte, funnel, recall e localizzazione.",
    branches: MARKETING_INTELLIGENCE_BRANCHES,
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
      "data_integration_orchestration",
      "observability_roi_guard",
      "runtime_deployment_scaling_guard",
      "change_impact_orchestration",
    ],
  },
  site_factory: {
    label: "Site Factory",
    description: "Clonazione siti, creazione nodi, template WaaS, layout, UI responsive e brand kit.",
    branches: ["codex_site_factory_guard", "codex_website_visual_guard", "codex_ui_ux_guard", "data_integration_orchestration", "runtime_deployment_scaling_guard", "suite_governance"],
  },
  business_governance: {
    label: "Business Governance",
    description: "CRM, filiera, listini, pricing, strategia, offerte, contratti e governance commerciale.",
    branches: ["suite_governance", "beauty_market", "business_strategy", "codex_business_guard", "commerce_fulfillment_guard", "billing_contract_guard", "support_success_guard", "legal_privacy_compliance_guard", "observability_roi_guard", "lifecycle_crm_guard", "segmentation_offer_guard", "customer_behavior_analysis", "customer_360_guard"],
  },
  network_value_chain: {
    label: "Network Value Chain",
    description: "Filiera, brand/distributori, margini, territori, prodotti riservati, magazzino prodotti e privacy commerciale.",
    branches: ["beauty_value_chain_guard", "brand_distributor_network_guard", "product_inventory_guard", "segmentation_offer_guard", "commerce_fulfillment_guard", "billing_contract_guard", "legal_privacy_compliance_guard"],
  },
  smartdesk_vertical: {
    label: "Smart Desk Vertical",
    description: "Operativita centro, AI Gold, protocolli, agenda, cassa, magazzino, marketing e conferma operatore.",
    branches: ["smartdesk_operations_guard", "beauty_protocol_guard", "skinharmony_analyzer", "consent_ledger_guard", "customer_360_guard", "product_inventory_guard", "support_success_guard"],
  },
  software_cortex: {
    label: "Software Cortex",
    description: "Gerarchia software profonda: architettura, contratti, test, release, rollback, audit e consolidamento.",
    branches: SOFTWARE_CORTEX_BRANCHES,
  },
  software_intelligence_lab: {
    label: "Software Intelligence Lab",
    description: "Analisi incorporata di software autorizzato: prove binarie, compatibilita, specifica clean-room, sandbox e regressione.",
    branches: [
      "software_binary_intelligence",
      "software_systems_intelligence",
      "software_security_intelligence",
      "research_evidence_intelligence",
      "quality_verification_intelligence",
      "codex_code_safety",
      "codex_test_strategy",
      "codex_release_gate",
      "legal_privacy_compliance_guard",
    ],
  },
  hardware_cortex: {
    label: "Hardware Cortex",
    description: "Catena device-to-runtime: transport, sensor, pairing, readiness, safety, diagnostics e runtime feedback.",
    branches: HARDWARE_CORTEX_BRANCHES,
  },
  security_cortex: {
    label: "Security Cortex",
    description: "Difesa software e rete: identity, secrets, tenant isolation, segmentation, containment e compliance.",
    branches: SECURITY_CORTEX_BRANCHES,
  },
  learning_cortex: {
    label: "Learning Cortex",
    description: "Memoria viva, benchmark, distillazione, feedback loop, reweighting policy e consolidamento.",
    branches: LEARNING_CORTEX_BRANCHES,
  },
  beauty_cortex: {
    label: "Beauty Cortex",
    description: "Loop verticale beauty: analyzer, protocolli, narrativa commerciale, recall e valore operativo del centro.",
    branches: BEAUTY_CORTEX_BRANCHES,
  },
  security_defense: {
    label: "Security / Defensive Intelligence",
    description: "Tenant isolation, segreti, audit, policy, hardening e difesa da automazioni rischiose.",
    branches: ["codex_security_guard", "codex_code_safety", "codex_release_gate", "codex_architecture_guard", "legal_privacy_compliance_guard", "agent_orchestration_guard", "data_integration_orchestration", "runtime_deployment_scaling_guard", "observability_roi_guard"],
  },
  automation_control: {
    label: "Automation Control",
    description: "Codex, agenti, runbook, audit, action mediation, deploy e ROI delle automazioni.",
    branches: ["agent_orchestration_guard", "observability_roi_guard", "runtime_deployment_scaling_guard", "change_impact_orchestration", "data_integration_orchestration", "codex_code_safety", "codex_release_gate"],
  },
  nyra_interpretation: {
    label: "Nyra Interpretation Layer",
    description: "Nyra interpreta e spiega; Core giudica; Codex esegue entro i limiti.",
    branches: ["executive_gold", "business_strategy", "nyra_finance_beauty_test"],
  },
});

export const BRANCH_PACKAGES = Object.freeze({
  starter: ["front_desk_base", ...HORIZONTAL_WORK_BRANCHES],
  base: ["front_desk_base", ...HORIZONTAL_WORK_BRANCHES],
  pro: ["front_desk_base", ...HORIZONTAL_WORK_BRANCHES, "operations_silver", "executive_gold", "suite_governance", "marketing_copy", "email_recall_guard", "content_localization_guard", "translation_governance", "translator_marketing_governance", "ramo_testo", "consent_ledger_guard", "event_taxonomy_guard", "customer_360_guard"],
  silver: ["front_desk_base", ...HORIZONTAL_WORK_BRANCHES, "operations_silver", "consent_ledger_guard", "event_taxonomy_guard"],
  gold: ["front_desk_base", ...HORIZONTAL_WORK_BRANCHES, "operations_silver", "executive_gold", "smartdesk_operations_guard", "beauty_protocol_guard", "customer_360_guard", "consent_ledger_guard"],
  network: ["front_desk_base", ...HORIZONTAL_WORK_BRANCHES, "operations_silver", "executive_gold", "suite_governance", ...MARKETING_INTELLIGENCE_BRANCHES, "business_strategy", "beauty_value_chain_guard", "brand_distributor_network_guard", "product_inventory_guard", "billing_contract_guard", "support_success_guard", "smartdesk_operations_guard", "beauty_protocol_guard"],
  enterprise: ["front_desk_base", ...HORIZONTAL_WORK_BRANCHES, "operations_silver", "executive_gold", "suite_governance", ...MARKETING_INTELLIGENCE_BRANCHES, "business_strategy", "beauty_value_chain_guard", "brand_distributor_network_guard", "product_inventory_guard", "billing_contract_guard", "support_success_guard", "smartdesk_operations_guard", "beauty_protocol_guard", "change_impact_orchestration"],
  internal: ["front_desk_base", ...HORIZONTAL_WORK_BRANCHES, "operations_silver", "executive_gold", "suite_governance", ...MARKETING_INTELLIGENCE_BRANCHES, "business_strategy", "nyra_finance_beauty_test", "beauty_value_chain_guard", "brand_distributor_network_guard", "product_inventory_guard", "billing_contract_guard", "support_success_guard", "smartdesk_operations_guard", "beauty_protocol_guard", "software_systems_intelligence", "software_binary_intelligence", "hardware_systems_intelligence", "software_security_intelligence", "network_security_intelligence", "infrastructure_runtime_intelligence", "learning_knowledge_intelligence", "beauty_vertical_orchestration", ...CODEX_GUARD_BRANCHES],
  codex_guard: [...HORIZONTAL_WORK_BRANCHES, ...CODEX_GUARD_BRANCHES],
  omni_360: BRANCHES.map((branch) => branch.id),
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
        subbranches: branch.subbranches || [],
        file: branch.file,
      },
    ]),
  );
}

export function deterministicBranchGroups() {
  return BRANCH_GROUPS;
}

let CACHED_BRANCH_TAXONOMY = null;

export function deterministicBranchTaxonomy() {
  if (CACHED_BRANCH_TAXONOMY) return CACHED_BRANCH_TAXONOMY;
  CACHED_BRANCH_TAXONOMY = buildBranchTaxonomyFromRegistry({
    branches: BRANCHES,
    groups: BRANCH_GROUPS,
  });
  return CACHED_BRANCH_TAXONOMY;
}

export function getBranch(branchId) {
  return BRANCHES.find((branch) => branch.id === branchId) || null;
}

export function normalizeTier(tier) {
  const key = String(tier || "").toLowerCase().trim();
  return BRANCH_PACKAGES[key] ? key : "base";
}

export function resolveBranchesForKey(keyRecord, requestedBranches = []) {
  const domainPack = resolveDomainPackForKey(keyRecord);
  const metadata = keyRecord?.metadata && typeof keyRecord.metadata === "object" ? keyRecord.metadata : {};
  const presetTier =
    keyRecord?.preset === "suite_connector" || keyRecord?.preset === "wordpress_connector"
      ? "network"
      : keyRecord?.preset === "smartdesk_connector"
        ? "gold"
        : keyRecord?.preset === "codex_automation"
          ? "internal"
          : keyRecord?.preset === "nyra_core_360_connector"
            ? "omni_360"
            : "base";
  const tier = normalizeTier(metadata.tier || keyRecord?.tier || presetTier);
  const fromPackage = BRANCH_PACKAGES[tier] || BRANCH_PACKAGES.base;
  const explicitSource = Array.isArray(metadata.active_branch_groups) && metadata.active_branch_groups.length
    ? [...HORIZONTAL_WORK_BRANCHES, ...metadata.active_branch_groups, ...(Array.isArray(metadata.active_branches) ? metadata.active_branches : [])]
    : Array.isArray(metadata.active_branches)
      ? [...HORIZONTAL_WORK_BRANCHES, ...metadata.active_branches.map(String)]
      : fromPackage;
  const expandedAllowed = expandBranchIds(explicitSource);
  const allowed = [...new Set(expandedAllowed.expanded)]
    .filter((id) => Boolean(getBranch(id)))
    .filter((id) => branchAllowedForDomainPack(domainPack, id));
  const expandedRequested = expandBranchIds(requestedBranches);
  const requested = Array.isArray(requestedBranches) && requestedBranches.length
    ? expandedRequested.expanded.filter((id) => allowed.includes(id))
    : allowed;

  return {
    domain_pack: { id: domainPack.id, version: domainPack.version, domain: domainPack.domain },
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
    branch_taxonomy: deterministicBranchTaxonomy(),
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
