export function bindAiGoldViewEvents(deps) {
  const { state, renderView } = deps;

  document.querySelectorAll('[data-action="select-client-gold-queue"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedClientId = button.dataset.id || "";
      const selected = state.clients.find((item) => item.id === state.selectedClientId);
      state.clientSearch = selected?.name || "";
      state.currentView = "clients";
      renderView();
    });
  });
}

export function bindMarketingViewEvents(deps) {
  const { state, renderView, showFeedback, t, marketingMessageForClient } = deps;

  document.querySelectorAll('[data-action="open-marketing-client"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedClientId = button.dataset.id || "";
      const selected = state.clients.find((item) => item.id === state.selectedClientId);
      state.clientSearch = selected?.name || "";
      state.currentView = "clients";
      renderView();
    });
  });
  document.querySelectorAll('[data-action="copy-marketing-message"]').forEach((button) => {
    button.addEventListener("click", async () => {
      const client = state.clients.find((item) => item.id === button.dataset.id);
      if (!client?.marketingConsent) {
        showFeedback(t("marketingView.consentMissing"));
        return;
      }
      if (!navigator.clipboard?.writeText) {
        showFeedback(t("common.copyUnavailable"));
        return;
      }
      await navigator.clipboard.writeText(marketingMessageForClient(client));
      showFeedback(t("marketingView.copiedFeedback", { name: client.name || t("agendaView.client") }));
    });
  });
}

export function bindInventoryViewEvents(deps) {
  const { API_SERVER_URL, loadData, renderView, showFeedback, t } = deps;

  document.querySelector('[data-action="refresh-inventory"]')?.addEventListener("click", async () => {
    await loadData(["inventoryItems", "inventoryMovements", "inventoryOverview", "goldDecisionContext", "goldCapabilities"]);
    renderView();
  });
  document.querySelector('[data-action="save-inventory-movement"]')?.addEventListener("click", async () => {
    const itemId = document.getElementById("inventory-item-id")?.value || "";
    const type = document.getElementById("inventory-movement-type")?.value || "load";
    const quantity = Number(document.getElementById("inventory-movement-quantity")?.value || 0);
    const operatorName = document.getElementById("inventory-movement-operator")?.value || "";
    const note = document.getElementById("inventory-movement-note")?.value || "";
    if (!itemId) {
      showFeedback(t("inventoryView.movementItemMissing"));
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      showFeedback(t("inventoryView.movementQuantityInvalid"));
      return;
    }
    await fetch(`${API_SERVER_URL}/api/inventory/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, type, quantity, operatorName, note })
    });
    await loadData(["inventoryItems", "inventoryMovements", "inventoryOverview", "goldDecisionContext", "goldCapabilities"]);
    renderView();
    showFeedback(t("inventoryView.movementSaved"));
  });
}

export function bindProfitabilityViewEvents(deps) {
  const { state, renderView, loadProfitabilityOverview } = deps;

  document.getElementById("profitability-start-date")?.addEventListener("change", async (event) => {
    state.profitabilityStartDate = event.target.value;
    await loadProfitabilityOverview();
    renderView();
  });
  document.getElementById("profitability-end-date")?.addEventListener("change", async (event) => {
    state.profitabilityEndDate = event.target.value;
    await loadProfitabilityOverview();
    renderView();
  });
  document.querySelector('[data-action="refresh-profitability"]')?.addEventListener("click", async () => {
    await loadProfitabilityOverview();
    renderView();
  });
}

export function bindProtocolsViewEvents(deps) {
  const { state, API_SERVER_URL, renderView, showFeedback, t, loadTreatments, loadData } = deps;

  document.querySelector('[data-action="refresh-protocols"]')?.addEventListener("click", async () => {
    await loadTreatments();
    await loadData(["goldCapabilities", "goldDecisionContext"]);
    renderView();
  });
  document.getElementById("treatment-client-id")?.addEventListener("change", (event) => {
    state.treatmentClientId = event.target.value;
  });
  document.getElementById("treatment-operator-name")?.addEventListener("input", (event) => {
    state.treatmentOperatorName = event.target.value;
  });
  document.getElementById("treatment-products-used")?.addEventListener("input", (event) => {
    state.treatmentProductsUsed = event.target.value;
  });
  document.getElementById("treatment-technology-used")?.addEventListener("input", (event) => {
    state.treatmentTechnologyUsed = event.target.value;
  });
  document.getElementById("treatment-protocol-used")?.addEventListener("input", (event) => {
    state.treatmentProtocolUsed = event.target.value;
  });
  document.getElementById("treatment-photo-path")?.addEventListener("input", (event) => {
    state.treatmentPhotoPath = event.target.value;
  });
  document.getElementById("treatment-result-notes")?.addEventListener("input", (event) => {
    state.treatmentResultNotes = event.target.value;
  });
  document.querySelector('[data-action="save-treatment"]')?.addEventListener("click", async () => {
    if (!state.treatmentClientId) return;
    await fetch(`${API_SERVER_URL}/api/treatments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: state.treatmentClientId,
        operatorName: state.treatmentOperatorName,
        productsUsed: state.treatmentProductsUsed,
        technologyUsed: state.treatmentTechnologyUsed,
        protocolUsed: state.treatmentProtocolUsed,
        resultNotes: state.treatmentResultNotes,
        photoPath: state.treatmentPhotoPath
      })
    });
    state.treatmentClientId = "";
    state.treatmentOperatorName = "";
    state.treatmentProductsUsed = "";
    state.treatmentTechnologyUsed = "";
    state.treatmentProtocolUsed = "";
    state.treatmentResultNotes = "";
    state.treatmentPhotoPath = "";
    await loadTreatments();
    await loadData(["goldCapabilities", "goldDecisionContext"]);
    renderView();
    showFeedback(t("protocolsView.treatmentSaved"));
  });
}

export function bindServicesViewEvents(deps) {
  const { state, openServiceDialog, openStaffDialog } = deps;

  document.querySelector('[data-action="new-service"]')?.addEventListener("click", () => openServiceDialog());
  document.querySelector('[data-action="new-staff"]')?.addEventListener("click", () => openStaffDialog());
  document.querySelectorAll('[data-action="edit-service"]').forEach((button) => {
    button.addEventListener("click", () => {
      const service = state.services.find((item) => item.id === button.dataset.id);
      if (service) openServiceDialog(service);
    });
  });
  document.querySelectorAll('[data-action="edit-staff"]').forEach((button) => {
    button.addEventListener("click", () => {
      const member = state.staff.find((item) => item.id === button.dataset.id);
      if (member) openStaffDialog(member);
    });
  });
}

export function bindReportsViewEvents(deps) {
  const { state, renderView } = deps;

  document.querySelectorAll('[data-action="set-report-period"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.reportPeriod = button.dataset.period || "day";
      renderView();
    });
  });
}

export function bindSettingsViewEvents(deps) {
  const { state, renderView, openCenterDialog, saveLanguage } = deps;

  document.querySelector('[data-action="edit-center"]')?.addEventListener("click", openCenterDialog);
  document.getElementById("settings-language-select")?.addEventListener("change", (event) => {
    void saveLanguage(event.target.value);
  });
  document.querySelectorAll('[data-action="set-settings-section"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.settingsSection = button.dataset.section || "modules";
      state.currentView = "settings";
      renderView();
    });
  });
}
