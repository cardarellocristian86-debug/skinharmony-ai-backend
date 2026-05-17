export const branchProductInventoryGuard = {
  id: "product_inventory_guard",
  file: "branch-product-inventory-guard.js",
  tier: "network",
  label: "Product Inventory Guard",
  domain: "product_inventory",
  production_status: "advisory",
  description: "Guardrail per magazzino prodotti: barcode, stock, carico/scarico, sottoscorta, riserva e valore stock.",
  rules: [
    "Stock e movimenti devono essere tracciabili: prodotto, quantita, causale, origine, operatore e timestamp.",
    "Non scaricare stock senza ordine, movimento manuale approvato o riserva configurata.",
    "Sottoscorta, riordino e valore stock devono distinguere prodotto, distributore, centro e magazzino.",
    "Barcode e SKU devono essere univoci nel tenant o mappati con regole di alias.",
    "Le offerte non devono vendere stock inesistente senza regola di ordine su richiesta.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "inventory_review",
    blocked_actions: ["stock_decrement_without_event", "sell_unavailable_without_policy", "duplicate_sku_collision", "reserve_without_order"],
  },
};
