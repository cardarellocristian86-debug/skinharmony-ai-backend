export const SUITE_MODULES = Object.freeze({
  dashboard: "Dashboard e stato sito",
  lead_intelligence: "Lead Intelligence",
  technology_ecommerce: "E-commerce tecnologie / prodotti",
  google_ads: "Google Ads / Conversion Manager",
  claim_price_guard: "Claim Guard + Price Guard",
  waas_templates: "Template WaaS replicabili",
  waas_onboarding: "Onboarding cliente WaaS",
  waas_project_builder: "Project Builder cliente",
  waas_commercial: "Pagamenti e contratti WaaS",
  analytics: "Analytics WaaS e attribuzione traffico",
  social_channels: "Social Channels / Powered by",
  crm_b2b: "CRM B2B filiera",
  b2b_engine: "B2B Order Bridge",
  commerce_policy: "Policy commercio configurabile",
  price_list_engine: "Listini e gruppi prezzo B2B",
  brand_governance: "Brand Governance",
  dam_assets: "DAM centrale asset",
  reputation: "Reputation Management",
  upsell_engine: "AI Upsell Engine controllato",
  smartdesk_bridge: "Smart Desk Bridge",
  ai_assistant: "AI Assistant / AI Engine",
  warehouse_barcode: "Magazzino, barcode e carico/scarico",
  fulfillment_control: "Fulfillment e stati evasione",
  payment_settlements: "Payment Settlements read-only",
  license_renewals: "Rinnovi licenze e promemoria",
  license_registry: "Registro licenze WaaS",
  update_server: "Update Server WaaS",
  multi_site_dashboard: "Dashboard multi-sito",
  codex_automation: "Codex controlled automation",
  core_reports: "Report Core/Nyra",
});

const PACKAGES = Object.freeze({
  starter: [
    "dashboard",
    "lead_intelligence",
    "technology_ecommerce",
    "google_ads",
    "claim_price_guard",
    "social_channels",
  ],
  base: [
    "dashboard",
    "lead_intelligence",
    "technology_ecommerce",
    "google_ads",
    "claim_price_guard",
    "social_channels",
  ],
  pro: [
    "dashboard",
    "lead_intelligence",
    "technology_ecommerce",
    "google_ads",
    "claim_price_guard",
    "social_channels",
    "waas_templates",
    "waas_onboarding",
    "waas_project_builder",
    "waas_commercial",
    "analytics",
  ],
  silver: [
    "dashboard",
    "lead_intelligence",
    "technology_ecommerce",
    "google_ads",
    "claim_price_guard",
    "social_channels",
    "waas_templates",
    "waas_onboarding",
    "waas_project_builder",
    "waas_commercial",
    "analytics",
  ],
  network: [
    "dashboard",
    "lead_intelligence",
    "technology_ecommerce",
    "google_ads",
    "claim_price_guard",
    "social_channels",
    "waas_templates",
    "waas_onboarding",
    "waas_project_builder",
    "waas_commercial",
    "analytics",
    "crm_b2b",
    "b2b_engine",
    "commerce_policy",
    "price_list_engine",
    "brand_governance",
    "dam_assets",
    "reputation",
    "upsell_engine",
    "smartdesk_bridge",
    "ai_assistant",
    "warehouse_barcode",
    "fulfillment_control",
    "payment_settlements",
    "license_renewals",
    "license_registry",
    "update_server",
    "multi_site_dashboard",
    "core_reports",
  ],
  gold: [
    "dashboard",
    "lead_intelligence",
    "technology_ecommerce",
    "google_ads",
    "claim_price_guard",
    "social_channels",
    "waas_templates",
    "waas_onboarding",
    "waas_project_builder",
    "waas_commercial",
    "analytics",
    "crm_b2b",
    "b2b_engine",
    "commerce_policy",
    "price_list_engine",
    "brand_governance",
    "dam_assets",
    "reputation",
    "upsell_engine",
    "smartdesk_bridge",
    "ai_assistant",
    "warehouse_barcode",
    "fulfillment_control",
    "payment_settlements",
    "license_renewals",
    "license_registry",
    "update_server",
    "multi_site_dashboard",
    "core_reports",
  ],
  enterprise: Object.keys(SUITE_MODULES),
  internal: Object.keys(SUITE_MODULES),
});

export function normalizeSuiteTier(tier) {
  const key = String(tier || "").toLowerCase().trim();
  return PACKAGES[key] ? key : "starter";
}

export function sanitizeSuiteModules(modules) {
  if (!Array.isArray(modules)) return [];
  return [...new Set(modules.map(String).map((item) => item.trim()).filter((item) => SUITE_MODULES[item]))];
}

export function normalizeSuiteLimits(input = {}) {
  const toInt = (value, fallback = 0) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  return {
    smartdesk_seats: toInt(input.smartdesk_seats ?? input.seat_limit, 0),
    wordpress_nodes: toInt(input.wordpress_nodes, 1),
    monthly_core_calls: toInt(input.monthly_core_calls, 0),
    codex_automation_runs: toInt(input.codex_automation_runs, 0),
  };
}

export function normalizeAllowedDomains(input) {
  if (Array.isArray(input)) {
    return [...new Set(input.map(String).map((item) => item.trim()).filter(Boolean))];
  }
  return String(input || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildSuitePolicy(keyRecord, branchResolution = {}) {
  const metadata = keyRecord?.metadata && typeof keyRecord.metadata === "object" ? keyRecord.metadata : {};
  const tier = normalizeSuiteTier(metadata.suite_tier || metadata.tier || branchResolution.tier);
  const explicitModules = sanitizeSuiteModules(metadata.suite_modules);
  const enabledModules = explicitModules.length ? explicitModules : (PACKAGES[tier] || PACKAGES.starter);
  const lockedModules = Object.keys(SUITE_MODULES).filter((moduleId) => !enabledModules.includes(moduleId));
  const suitePolicy = metadata.suite_policy && typeof metadata.suite_policy === "object" ? metadata.suite_policy : {};

  return {
    source: "universal_core",
    schema_version: "suite_policy_v1",
    tenant_id: keyRecord?.tenant_id || "",
    brand_scope: keyRecord?.brand_scope || "",
    key_id: keyRecord?.key_id || "",
    tier,
    suite_modules: enabledModules,
    locked_modules: lockedModules,
    module_labels: SUITE_MODULES,
    limits: normalizeSuiteLimits({
      ...(metadata.suite_limits || {}),
      seat_limit: metadata.seat_limit,
    }),
    allowed_domains: normalizeAllowedDomains(metadata.allowed_domains),
    soft_gate: suitePolicy.soft_gate !== false,
    hard_block: false,
    expires_at: keyRecord?.expires_at || null,
    recommended_action: "Applicare i moduli come soft gate: preview/upgrade/rinnovo, nessun blocco brutale automatico.",
  };
}
