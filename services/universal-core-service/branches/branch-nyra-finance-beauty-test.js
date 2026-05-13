export const branchNyraFinanceBeautyTest = {
  id: "nyra_finance_beauty_test",
  file: "branch-nyra-finance-beauty-test.js",
  tier: "internal",
  label: "Nyra Finance Beauty Test",
  domain: "market_test",
  production_status: "test_only",
  description: "Area separata per leggere correlazioni mercato/beauty. Non entra nel prodotto operativo e non genera consigli finanziari.",
  rules: [
    "Ramo test-only separato dal prodotto vendibile.",
    "Nessuna automazione finanziaria, nessun trading, nessuna promessa di rendimento.",
    "Usare solo per ricerca interna e confronto con postura commerciale beauty.",
    "Qualunque output deve dichiarare che non e consulenza finanziaria.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "test_only",
    blocked_actions: ["trading_execution", "portfolio_advice", "client_financial_decision"],
  },
};
