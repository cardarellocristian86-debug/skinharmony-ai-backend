export function renderInventoryView(deps) {
  const {
    moduleEnabled,
    renderLockedModule,
    t,
    currentLanguage,
    state,
    normalizeInventoryItem,
    normalizeInventoryMovement,
    inventoryTone,
    renderEnterpriseBanner,
    escapeHtml,
    euroFromCents,
    inventoryQuantityLabel,
    inventoryStateLabel,
    inventoryMovementLabel,
    currentLocale
  } = deps;

  if (!moduleEnabled("inventory")) {
    return renderLockedModule({
      title: t("inventoryView.title"),
      reason: currentLanguage() === "en" ? "Inventory is not active in this center configuration." : "Il magazzino non e attivo in questa configurazione centro.",
      hint: currentLanguage() === "en" ? "Enable the inventory module to work on stock, low stock and movements." : "Attiva il modulo magazzino per lavorare su stock, sottoscorta e movimenti."
    });
  }

  const overview = state.inventoryOverview || { summary: {}, lowStockItems: [], recentMovements: [] };
  const items = Array.isArray(state.inventoryItems) ? state.inventoryItems : [];
  const lowStockItems = Array.isArray(overview.lowStockItems) ? overview.lowStockItems.map(normalizeInventoryItem) : items.filter((item) => inventoryTone(item) !== "regular").slice(0, 8);
  const recentMovements = Array.isArray(overview.recentMovements) ? overview.recentMovements.map(normalizeInventoryMovement) : (state.inventoryMovements || []).slice(0, 8);

  return `
    <div class="stack">
      ${renderEnterpriseBanner()}
      <section class="card">
        <div class="dashboard-hero">
          <div>
            <div class="section-title">${t("inventoryView.title")}</div>
            <div class="page-subtitle">${t("inventoryView.subtitle")}</div>
          </div>
          <div class="hero-badges">
            <div class="module-pill active">${items.length} ${t("inventoryView.activeItems").toLowerCase()}</div>
            <button class="sh-button secondary-btn" data-action="refresh-inventory" type="button">${currentLanguage() === "en" ? "Refresh stock" : "Aggiorna stock"}</button>
          </div>
        </div>
        <div class="dashboard-focus-grid mt-16">
          <div class="dashboard-focus-item"><div class="stat-label">${t("inventoryView.activeItems")}</div><div class="focus-value">${overview.summary?.itemsCount ?? items.length}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("inventoryView.belowThreshold")}</div><div class="focus-value">${overview.summary?.lowStockCount ?? lowStockItems.length}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("inventoryView.stockCost")}</div><div class="focus-value">${euroFromCents(overview.summary?.stockValueCents ?? 0)}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("inventoryView.retailValue")}</div><div class="focus-value">${euroFromCents(overview.summary?.retailValueCents ?? 0)}</div></div>
        </div>
      </section>

      <div class="settings-grid">
        <section class="card">
          <div class="section-title mb-16">${t("inventoryView.lowStockTitle")}</div>
          <div class="list">
            ${lowStockItems.length ? lowStockItems.map((item) => `
              <div class="list-item inventory-item-row inventory-${inventoryTone(item)} priority-card priority-critical">
                <div>
                  <div class="item-title">${escapeHtml(item.name || t("inventoryView.movementFallbackItem"))}</div>
                  <div class="item-subtitle">${currentLanguage() === "en" ? `${inventoryQuantityLabel(item.stockQuantity, item.unit)} available · threshold ${inventoryQuantityLabel(item.thresholdQuantity, item.unit)}` : `${inventoryQuantityLabel(item.stockQuantity, item.unit)} disponibili · soglia ${inventoryQuantityLabel(item.thresholdQuantity, item.unit)}`}</div>
                </div>
                <div class="action-row">
                  <button class="sh-button danger-btn" data-action="prepare-inventory-load" data-id="${escapeHtml(item.id)}" type="button">${currentLanguage() === "en" ? "Prepare load" : "Prepara carico"}</button>
                  <button class="sh-button secondary-btn danger-outline-btn" data-action="open-inventory-item" data-id="${escapeHtml(item.id)}" type="button">${currentLanguage() === "en" ? "Open item" : "Apri articolo"}</button>
                </div>
              </div>
            `).join("") : `<div class="settings-note">${t("inventoryView.noCriticalItems")}</div>`}
          </div>
        </section>

        <section class="card">
          <div class="section-title mb-16">${t("inventoryView.stockItems")}</div>
          <div class="list">
            ${items.slice(0, 10).map((item) => `
              <div class="list-item inventory-item-row inventory-${inventoryTone(item)}">
                <div>
                  <div class="item-title">${escapeHtml(item.name || t("inventoryView.movementFallbackItem"))}</div>
                  <div class="item-subtitle">${escapeHtml(item.category || "General")} · ${inventoryQuantityLabel(item.stockQuantity, item.unit)}</div>
                  <div class="item-subtitle">${t("inventoryView.costRetailLine", { cost: euroFromCents(item.costPerUseCents || 0), retail: euroFromCents(item.retailPriceCents || 0) })}</div>
                </div>
                <div class="module-pill ${inventoryTone(item) === "regular" ? "" : "active"}">${inventoryStateLabel(item)}</div>
              </div>
            `).join("") || `<div class="settings-note">${t("inventoryView.noCriticalItems")}</div>`}
          </div>
        </section>
      </div>

      <div class="settings-grid">
        <section class="card">
          <div class="section-title mb-16">${t("inventoryView.registerMovement")}</div>
          <div class="settings-note mb-16">${t("inventoryView.stockControlCopy")}</div>
          <div class="stack">
            <select id="inventory-item-id" class="sh-select">
              <option value="">${t("inventoryView.selectItem")}</option>
              ${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}
            </select>
            <select id="inventory-movement-type" class="sh-select">
              <option value="load">${t("inventoryView.movementLoad")}</option>
              <option value="unload">${t("inventoryView.movementUnload")}</option>
              <option value="internal_use">${t("inventoryView.movementInternalUse")}</option>
              <option value="sale">${t("inventoryView.movementSale")}</option>
              <option value="return">${t("inventoryView.movementReturn")}</option>
              <option value="adjustment">${t("inventoryView.movementAdjustment")}</option>
            </select>
            <input id="inventory-movement-quantity" class="sh-input" type="number" min="0" step="0.01" placeholder="${escapeHtml(t("inventoryView.quantity"))}">
            <input id="inventory-movement-operator" class="sh-input" type="text" placeholder="${escapeHtml(t("inventoryView.operatorReference"))}">
            <input id="inventory-movement-note" class="sh-input" type="text" placeholder="${escapeHtml(t("inventoryView.movementNote"))}">
            <button class="sh-button" data-action="save-inventory-movement" type="button">${t("inventoryView.registerMovement")}</button>
          </div>
        </section>

        <section class="card">
          <div class="section-title mb-16">${t("inventoryView.stockControl")}</div>
          <div class="settings-note mb-16">${t("inventoryView.stockControlCopy")}</div>
          <div class="list">
            ${recentMovements.length ? recentMovements.map((movement) => {
              const item = items.find((entry) => entry.id === movement.itemId);
              return `
                <div class="list-item">
                  <div>
                    <div class="item-title">${inventoryMovementLabel(movement.type)} · ${escapeHtml(item?.name || t("inventoryView.movementFallbackItem"))}</div>
                    <div class="item-subtitle">${inventoryQuantityLabel(movement.quantity, item?.unit)} · ${escapeHtml(movement.operatorName || t("inventoryView.movementFallbackOperator"))}</div>
                    <div class="item-subtitle">${escapeHtml(new Date(movement.createdAt).toLocaleString(currentLocale()))}</div>
                  </div>
                </div>
              `;
            }).join("") : `<div class="settings-note">${t("inventoryView.stockControlCopy")}</div>`}
          </div>
        </section>
      </div>
    </div>
  `;
}
