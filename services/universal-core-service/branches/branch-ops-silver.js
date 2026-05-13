export const branchOpsSilver = {
  id: "operations_silver",
  file: "branch-ops-silver.js",
  tier: "silver",
  label: "Operations Silver",
  domain: "smartdesk_operations",
  production_status: "advisory",
  description: "Regole operative Silver per turni, magazzino evoluto, report, redditivita base e protocolli AI limitati.",
  rules: [
    "Silver legge e organizza: non decide da solo e non invia comunicazioni automatiche.",
    "Prioritizza colli operativi: agenda scoperta, stock basso, follow-up scaduti, incassi da verificare.",
    "Le analisi protocolli AI Silver sono limitate dal piano commerciale e devono restare confermabili dall'operatore.",
    "Segnala anomalie di stock, cassa o turni senza correggere automaticamente il dato sorgente.",
    "Quando un dato operativo e incoerente, chiedi verifica del modulo che lo genera.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "assisted",
    blocked_actions: ["auto_order_stock", "auto_refund", "auto_discount", "override_operator_confirmation"],
  },
};
