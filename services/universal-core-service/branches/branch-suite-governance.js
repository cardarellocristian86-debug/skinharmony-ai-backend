export const branchSuiteGovernance = {
  id: "suite_governance",
  file: "branch-suite-governance.js",
  tier: "network",
  label: "Suite Governance",
  domain: "suite_waas_governance",
  production_status: "advisory",
  description: "Regole Suite per WaaS, licenze, moduli, claim, pricing, template, CRM B2B e rete commerciale.",
  rules: [
    "Suite governa la rete: clienti, brand, distributori, nodi, licenze, moduli, claim, prezzi e offerte.",
    "Non imporre prezzi finali pubblici ai rivenditori; usare prezzo consigliato, range, policy interna e owner approval.",
    "Claim Guard e Pricing Guard sono guardrail di governance, non sostituiscono consulenza legale o fiscale.",
    "Ogni nodo vede solo il proprio brand scope e le relazioni autorizzate dalla API key.",
    "Il sync verso Core resta snapshot/read-only salvo endpoint e scope espliciti.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "owner_controlled",
    blocked_actions: ["hard_block_public_site", "cross_brand_data_leak", "force_reseller_price", "auto_publish_template"],
  },
};
