export function bindGlobalEvents(deps) {
  const {
    state,
    renderView,
    renderAssistantDrawer,
    openAppointmentDialog,
    languageSelect,
    saveLanguage,
    assistantResponseNode,
    escapeHtml,
    t,
    entityForm,
    submitEntity,
    dialog
  } = deps;

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.currentView = button.dataset.view;
      state.selectedAppointmentId = null;
      state.selectedSlot = null;
      state.fullScreenAgenda = false;
      if (state.currentView === "profitability") {
        await deps.loadProfitabilityOverview();
      }
      if (state.currentView === "protocols") {
        await deps.loadTreatments();
      }
      renderView();
    });
  });

  document.getElementById("open-assistant").addEventListener("click", () => {
    state.assistantOpen = true;
    renderAssistantDrawer();
  });

  document.getElementById("close-assistant").addEventListener("click", () => {
    state.assistantOpen = false;
    renderAssistantDrawer();
  });

  document.getElementById("quick-appointment").addEventListener("click", () => openAppointmentDialog());
  languageSelect?.addEventListener("change", (event) => {
    void saveLanguage(event.target.value);
  });

  document.getElementById("assistant-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = document.getElementById("assistant-question").value.trim();
    if (!question) return;
    const response = await fetch("/api/assistant/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });
    state.assistantResponse = await response.json();
    assistantResponseNode.classList.remove("hidden");
    assistantResponseNode.innerHTML = `
      <div class="item-title">${escapeHtml(state.assistantResponse.title || t("assistantView.aiAnswer"))}</div>
      <div class="item-subtitle mt-16">${escapeHtml(state.assistantResponse.answer || "")}</div>
    `;
  });

  entityForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitEntity(new FormData(entityForm));
  });

  document.getElementById("dialog-close").addEventListener("click", () => dialog.close());
  document.getElementById("dialog-cancel").addEventListener("click", () => dialog.close());
}

export async function initApp(deps) {
  const {
    loadData,
    bindGlobalEvents,
    renderAssistantDrawer,
    renderView,
    startLazyRefreshLoop,
    lazyRefreshMs
  } = deps;

  await loadData();
  bindGlobalEvents();
  renderAssistantDrawer();
  renderView();
  startLazyRefreshLoop(lazyRefreshMs);
}
