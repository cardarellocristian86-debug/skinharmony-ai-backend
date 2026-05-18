export function createDataOrchestrator(deps) {
  const {
    state,
    API_SERVER_URL,
    safeJsonFetch,
    normalizeClient,
    normalizeAppointment,
    normalizeService,
    normalizeStaff,
    normalizeInventoryItem,
    normalizeInventoryMovement,
    normalizeProfitabilityOverview,
    normalizeTreatment,
    normalizeGoldCapabilities,
    normalizeGoldDecisionContext,
    REFRESH_POLICY,
    renderView
  } = deps;

  async function loadProfitabilityOverview() {
    const params = new URLSearchParams({
      startDate: state.profitabilityStartDate,
      endDate: state.profitabilityEndDate
    });
    const payload = await safeJsonFetch(`${API_SERVER_URL}/api/profitability/overview?${params.toString()}`, null).catch(() => null);
    state.profitabilityOverview = normalizeProfitabilityOverview(payload);
  }

  async function loadTreatments() {
    const payload = await safeJsonFetch(`${API_SERVER_URL}/api/treatments`, null).catch(() => []);
    state.treatments = Array.isArray(payload) ? payload.map(normalizeTreatment) : [];
  }

  const DATA_FETCHERS = {
    center: async () => fetch("/api/center").then((res) => res.json()),
    settings: async () => fetch("/api/settings").then((res) => res.json()),
    runtimeMeta: async () => fetch("/api/runtime-meta").then((res) => res.json()),
    dashboard: async () => safeJsonFetch(`${API_SERVER_URL}/dashboard`, "/api/dashboard"),
    report: async () => safeJsonFetch(`${API_SERVER_URL}/reports/operational`, null).catch(() => null),
    clients: async () => safeJsonFetch(`${API_SERVER_URL}/clients`, "/api/clients"),
    appointments: async () => safeJsonFetch(`${API_SERVER_URL}/appointments`, "/api/appointments"),
    services: async () => safeJsonFetch(`${API_SERVER_URL}/services`, "/api/services"),
    staff: async () => safeJsonFetch(`${API_SERVER_URL}/staff`, "/api/staff"),
    inventoryItems: async () => safeJsonFetch(`${API_SERVER_URL}/api/inventory/items`, "/api/inventory"),
    inventoryMovements: async () => safeJsonFetch(`${API_SERVER_URL}/api/inventory/movements`, null).catch(() => []),
    inventoryOverview: async () => safeJsonFetch(`${API_SERVER_URL}/api/inventory/overview`, null).catch(() => null),
    sales: async () => fetch("/api/sales").then((res) => res.json()),
    history: async () => fetch("/api/history").then((res) => res.json()),
    assistant: async () => fetch("/api/assistant/brief").then((res) => res.json()),
    goldCapabilities: async () => safeJsonFetch(`${API_SERVER_URL}/api/ai-gold/capabilities`, "/api/gold-state/decision").catch(() => null),
    goldDecisionContext: async () => safeJsonFetch(`${API_SERVER_URL}/api/ai-gold/decision-context`, "/api/gold-state/decision").catch(() => null)
  };

  function applyLoadedData(key, value) {
    if (key === "center") state.center = value;
    if (key === "settings") state.settings = value;
    if (key === "runtimeMeta") state.runtimeMeta = value;
    if (key === "dashboard") state.dashboard = value;
    if (key === "report") state.report = value;
    if (key === "clients") state.clients = (value.items || value).map(normalizeClient);
    if (key === "appointments") state.appointments = (value.items || value).map(normalizeAppointment);
    if (key === "services") state.services = (value.items || value).map(normalizeService);
    if (key === "staff") state.staff = (value.items || value).map(normalizeStaff);
    if (key === "inventoryItems") state.inventoryItems = (value.items || value).map(normalizeInventoryItem);
    if (key === "inventoryMovements") state.inventoryMovements = (value.items || value).map(normalizeInventoryMovement);
    if (key === "inventoryOverview") state.inventoryOverview = value;
    if (key === "sales") state.sales = value;
    if (key === "history") state.history = value;
    if (key === "assistant") state.assistant = value;
    if (key === "goldCapabilities") state.goldCapabilities = normalizeGoldCapabilities(value);
    if (key === "goldDecisionContext") state.goldDecisionContext = normalizeGoldDecisionContext(value);
  }

  async function loadData(keys = Object.keys(DATA_FETCHERS)) {
    const entries = await Promise.all(keys.map(async (key) => [key, await DATA_FETCHERS[key]()]));
    entries.forEach(([key, value]) => applyLoadedData(key, value));
  }

  function lazyModulesForCurrentView() {
    if (state.currentView === "dashboard" || state.currentView === "ecosystem") {
      return ["dashboard", "assistant", "goldCapabilities", "goldDecisionContext"];
    }
    if (state.currentView === "ai-gold") {
      return ["dashboard", "clients", "appointments", "sales", "goldCapabilities", "goldDecisionContext"];
    }
    if (state.currentView === "inventory") {
      return ["inventoryItems", "inventoryMovements", "inventoryOverview", "goldCapabilities", "goldDecisionContext"];
    }
    if (state.currentView === "profitability") {
      return ["goldCapabilities", "goldDecisionContext"];
    }
    if (state.currentView === "protocols") {
      return ["goldCapabilities", "goldDecisionContext"];
    }
    if (state.currentView === "reports") {
      return ["report", "goldCapabilities", "goldDecisionContext"];
    }
    return [];
  }

  async function refreshForUserEvent(domain) {
    const instantByDomain = {
      appointment: ["appointments", "dashboard"],
      client: ["clients", "dashboard"],
      service: ["services"],
      staff: ["staff", "dashboard"],
      center: ["center", "dashboard"]
    };
    const keys = [...new Set([...(instantByDomain[domain] || []), ...REFRESH_POLICY.lazy])];
    await loadData(keys);
  }

  async function runLazyRefresh() {
    if (document.hidden) return;
    const keys = lazyModulesForCurrentView();
    if (state.currentView === "profitability") {
      await loadProfitabilityOverview();
    }
    if (state.currentView === "protocols") {
      await loadTreatments();
    }
    if (!keys.length) return;
    await loadData(keys);
    renderView();
  }

  function startLazyRefreshLoop(lazyRefreshMs) {
    if (state.refreshTimer) window.clearInterval(state.refreshTimer);
    state.refreshTimer = window.setInterval(() => {
      void runLazyRefresh();
    }, lazyRefreshMs);
  }

  return {
    loadProfitabilityOverview,
    loadTreatments,
    loadData,
    refreshForUserEvent,
    runLazyRefresh,
    startLazyRefreshLoop
  };
}
