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

  async function readJson(url, fallback = null) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (_error) {
      return fallback;
    }
  }

  function buildCenterFallback(settings = {}) {
    return {
      name: settings.centerName || settings.businessName || "Ecosistema Center",
      businessType: settings.businessModel || settings.businessType || "",
      centerType: settings.centerType || "Advanced Aesthetic Systems",
      email: settings.email || "",
      phone: settings.phone || "",
      hours: settings.hours || "",
      devices: Array.isArray(settings.devices) ? settings.devices : []
    };
  }

  function buildRuntimeMetaFallback(settings = {}, session = {}) {
    const plan = String(session.subscriptionPlan || session.plan || settings.subscriptionPlan || "gold").toLowerCase();
    const activeModules = [
      settings.enableMarketing,
      settings.enableTreatments,
      settings.enableCashdesk,
      settings.enableProtocolsHub,
      settings.inventoryBaseEnabled,
      settings.profitabilityEnabled,
      settings.operatorReportsEnabled,
      settings.aiActionsEnabled
    ].filter(Boolean).length;

    return {
      session: {
        state: session.accessState || session.state || "active",
        role: session.role || "admin_centro",
        confirmationMode: "required_for_sensitive_actions",
        note: session.supportMode
          ? "Sessione supporto: mantieni conferma sulle azioni sensibili."
          : "Le azioni sensibili richiedono conferma."
      },
      subscription: {
        plan,
        tier: plan,
        state: session.paymentStatus || "configured",
        centerType: settings.centerType || "Advanced Aesthetic Systems",
        activeModules
      },
      permissions: {
        canEditCenter: true,
        canEditOperationalData: true,
        canExecuteSensitiveActionsWithoutConfirmation: false
      }
    };
  }

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
    center: async () => {
      const centerPayload = await readJson("/api/center", null);
      if (centerPayload && typeof centerPayload === "object") return centerPayload;
      const settings = state.settings || await readJson("/api/settings", {});
      return buildCenterFallback(settings || {});
    },
    settings: async () => readJson("/api/settings", {}),
    runtimeMeta: async () => {
      const runtimePayload = await readJson("/api/runtime-meta", null);
      if (runtimePayload && typeof runtimePayload === "object") return runtimePayload;
      const session = await readJson("/api/auth/session", {});
      const settings = state.settings || await readJson("/api/settings", {});
      return buildRuntimeMetaFallback(settings || {}, session || {});
    },
    dashboard: async () => safeJsonFetch(`${API_SERVER_URL}/api/dashboard/stats`, "/api/dashboard/stats").catch(() => null),
    report: async () => safeJsonFetch(`${API_SERVER_URL}/api/reports/operational`, "/api/reports/operational").catch(() => null),
    clients: async () => safeJsonFetch(`${API_SERVER_URL}/clients`, "/api/clients"),
    appointments: async () => safeJsonFetch(`${API_SERVER_URL}/appointments`, "/api/appointments"),
    services: async () => safeJsonFetch(`${API_SERVER_URL}/api/catalog/services`, "/api/catalog/services"),
    staff: async () => safeJsonFetch(`${API_SERVER_URL}/api/catalog/staff`, "/api/catalog/staff"),
    inventoryItems: async () => safeJsonFetch(`${API_SERVER_URL}/api/inventory/items`, "/api/inventory"),
    inventoryMovements: async () => safeJsonFetch(`${API_SERVER_URL}/api/inventory/movements`, null).catch(() => []),
    inventoryOverview: async () => safeJsonFetch(`${API_SERVER_URL}/api/inventory/overview`, null).catch(() => null),
    sales: async () => readJson("/api/payments", []),
    history: async () => readJson("/api/history", []),
    assistant: async () => readJson("/api/assistant/brief", null),
    goldCapabilities: async () => safeJsonFetch(`${API_SERVER_URL}/api/ai-gold/capabilities`, "/api/gold-state/decision").catch(() => null),
    goldDecisionContext: async () => safeJsonFetch(`${API_SERVER_URL}/api/ai-gold/decision-context`, "/api/gold-state/decision").catch(() => null)
  };

  function applyLoadedData(key, value) {
    if (key === "center") state.center = value;
    if (key === "settings") state.settings = value;
    if (key === "runtimeMeta") state.runtimeMeta = value;
    if (key === "dashboard") state.dashboard = value;
    if (key === "report") state.report = value;
    if (key === "clients") state.clients = (Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : []).map(normalizeClient);
    if (key === "appointments") state.appointments = (Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : []).map(normalizeAppointment);
    if (key === "services") state.services = (Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : []).map(normalizeService);
    if (key === "staff") state.staff = (Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : []).map(normalizeStaff);
    if (key === "inventoryItems") state.inventoryItems = (Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : []).map(normalizeInventoryItem);
    if (key === "inventoryMovements") state.inventoryMovements = (Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : []).map(normalizeInventoryMovement);
    if (key === "inventoryOverview") state.inventoryOverview = value;
    if (key === "sales") state.sales = Array.isArray(value) ? value : [];
    if (key === "history") state.history = Array.isArray(value) ? value : [];
    if (key === "assistant") state.assistant = value;
    if (key === "goldCapabilities") state.goldCapabilities = normalizeGoldCapabilities(value);
    if (key === "goldDecisionContext") state.goldDecisionContext = normalizeGoldDecisionContext(value);
  }

  async function loadData(keys = Object.keys(DATA_FETCHERS)) {
    const entries = await Promise.all(keys.map(async (key) => {
      try {
        return [key, await DATA_FETCHERS[key]()];
      } catch (_error) {
        return [key, null];
      }
    }));
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
