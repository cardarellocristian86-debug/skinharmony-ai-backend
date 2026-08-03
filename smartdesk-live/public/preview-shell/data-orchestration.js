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

  function isPreviewShell() {
    return typeof window !== "undefined" && String(window.location?.pathname || "").startsWith("/web-preview");
  }

  function applyPreviewSettings(settings = {}) {
    if (!isPreviewShell()) return settings;
    return {
      ...settings,
      centerName: settings.centerName || settings.businessName || "Ecosistema Center",
      centerType: settings.centerType || "Advanced Aesthetic Systems",
      businessModel: settings.businessModel || settings.businessType || "esthetic",
      subscriptionPlan: "gold",
      appLanguage: settings.appLanguage || "it",
      enableMarketing: true,
      enableTreatments: true,
      enableCashdesk: true,
      enableProtocolsHub: true,
      inventoryBaseEnabled: true,
      profitabilityEnabled: true,
      operatorReportsEnabled: true,
      aiActionsEnabled: true,
      shiftsBaseEnabled: true,
      shiftsTemplatesEnabled: true,
      shiftsClockEnabled: true
    };
  }

  function applyPreviewRuntimeMeta(runtimeMeta = {}) {
    if (!isPreviewShell()) return runtimeMeta;
    const subscription = runtimeMeta.subscription || {};
    const permissions = runtimeMeta.permissions || {};
    const session = runtimeMeta.session || {};
    return {
      ...runtimeMeta,
      session: {
        state: session.state || "active",
        role: session.role || "admin_centro",
        confirmationMode: session.confirmationMode || "required_for_sensitive_actions",
        note: session.note || "Le azioni sensibili richiedono conferma."
      },
      subscription: {
        ...subscription,
        plan: "gold",
        tier: "gold",
        centerType: subscription.centerType || "Advanced Aesthetic Systems",
        activeModules: Math.max(Number(subscription.activeModules || 0), 8)
      },
      permissions: {
        canEditCenter: permissions.canEditCenter !== false,
        canEditOperationalData: permissions.canEditOperationalData !== false,
        canExecuteSensitiveActionsWithoutConfirmation: false
      }
    };
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
    const preview = isPreviewShell();
    const plan = String(preview ? "gold" : session.subscriptionPlan || session.plan || settings.subscriptionPlan || "gold").toLowerCase();
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
        activeModules: preview ? Math.max(activeModules, 8) : activeModules
      },
      permissions: {
        canEditCenter: true,
        canEditOperationalData: true,
        canExecuteSensitiveActionsWithoutConfirmation: false
      }
    };
  }

  function getControlTenantFilter() {
    if (state.control?.role === "super_admin") {
      return String(state.control.selectedTenantId || "").trim();
    }
    return "";
  }

  function getWorkTenantFilter() {
    const role = state.control?.role;
    if (role === "super_admin") {
      const requestedTenantFilter = String(state.control?.filters?.work?.tenantId || "").trim();
      if (requestedTenantFilter) {
        return requestedTenantFilter;
      }
    }
    return getControlTenantFilter();
  }

  function toControlQuery(params = {}) {
    const next = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      const normalized = String(value == null ? "" : value).trim();
      if (normalized) next.set(key, normalized);
    });
    return next.toString();
  }

  function controlDataKeysForView(view) {
    const tenantFilter = getControlTenantFilter();
    const isSuper = state.control?.role === "super_admin";
    if (view === "control-executive") {
      return [
        ...(isSuper ? ["controlTenants"] : []),
        "controlExecutive",
        "controlConnectors",
        "controlGovernance",
        "controlWorkGallery"
      ];
    }
    if (view === "control-work-gallery") return ["controlWorkGallery"];
    if (view === "control-work-detail") {
      const workId = String(state.control?.selectedWorkId || "").trim();
      if (!workId) return ["controlWorkGallery"];
      return [tenantFilter ? "controlWork" : "controlWork", "controlWorkTimeline"];
    }
    if (view === "control-agents") return ["controlAgents"];
    if (view === "control-branches") return ["controlBranches"];
    if (view === "control-keys") return ["controlKeys"];
    if (view === "control-audit") return ["controlAudit"];
    if (view === "control-decision-ledger") return ["controlDecisionLedger"];
    if (view === "control-memory") return ["controlMemory"];
    if (view === "control-connectors") return ["controlConnectors"];
    if (view === "control-governance") return ["controlGovernance"];
    if (view === "control-demo") return ["controlDemo"];
    if (view === "control-super-admin") return ["controlTenants", "controlConnectors"];
    return [];
  }

  async function controlFetch(urlPath, params = {}, fallback = null) {
    const query = toControlQuery(params);
    const endpoint = `${urlPath}${query ? `?${query}` : ""}`;
    try {
      return await safeJsonFetch(`${API_SERVER_URL}${endpoint}`, endpoint);
    } catch (_error) {
      return fallback;
    }
  }

  function applyControlPayloadMeta(payload) {
    if (!payload || typeof payload !== "object") return;
    const controlPayload = payload.control;
    const nextRole = typeof controlPayload?.role === "string" && controlPayload.role
      ? String(controlPayload.role)
      : typeof payload.role === "string"
        ? String(payload.role)
        : "tenant_admin";
    const normalizedRole = nextRole === "super_admin" || nextRole === "tenant_operator" || nextRole === "tenant_admin"
      ? nextRole
      : "tenant_admin";
    state.control.role = normalizedRole;
  }

  function setControlDefaultsFromRuntime() {
    if (state.control && !state.control.role) {
      const nextRole = String(state.runtimeMeta?.control?.role || "tenant_admin");
      state.control.role = nextRole === "super_admin" || nextRole === "tenant_operator" || nextRole === "tenant_admin"
        ? nextRole
        : "tenant_admin";
    }
  }

  function readControlWorkFilters() {
    const filters = state.control?.filters?.work || {};
    const tenantFilter = getWorkTenantFilter();
    return {
      limit: 120,
      offset: 0,
      tenantId: tenantFilter,
      status: String(filters.status || "").trim(),
      risk: String(filters.risk || "").trim(),
      agent: String(filters.agent || "").trim(),
      projectId: String(filters.projectId || "").trim(),
      q: String(filters.q || "").trim(),
      date: String(filters.date || "").trim()
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
      const settings = applyPreviewSettings(state.settings || await readJson("/api/settings", {}));
      return buildCenterFallback(settings || {});
    },
    settings: async () => applyPreviewSettings(await readJson("/api/settings", {})),
    runtimeMeta: async () => {
      const runtimePayload = await readJson("/api/runtime-meta", null);
      if (runtimePayload && typeof runtimePayload === "object") return applyPreviewRuntimeMeta(runtimePayload);
      const session = await readJson("/api/auth/session", {});
      const settings = applyPreviewSettings(state.settings || await readJson("/api/settings", {}));
      return applyPreviewRuntimeMeta(buildRuntimeMetaFallback(settings || {}, session || {}));
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
    goldDecisionContext: async () => safeJsonFetch(`${API_SERVER_URL}/api/ai-gold/decision-context`, "/api/gold-state/decision").catch(() => null),
    controlTenants: async () => {
      const response = await controlFetch("/api/control-room/tenants", {});
      if (response && Array.isArray(response.data)) {
        return {
          ...response,
          tenants: response.data
        };
      }
      return response;
    },
    controlExecutive: async () => controlFetch("/api/control-room/executive", {
      tenantId: getControlTenantFilter(),
      refreshIntervalMs: 120000
    }, null),
    controlWorkGallery: async () => {
      const response = await controlFetch("/api/control-room/work-gallery", readControlWorkFilters(), {});
      if (response && Array.isArray(response.data)) {
        return {
          ...response,
          list: response.data
        };
      }
      return response;
    },
    controlWork: async () => {
      const workId = String(state.control?.selectedWorkId || "").trim();
      if (!workId) return null;
      return controlFetch(`/api/control-room/work/${encodeURIComponent(workId)}`, {
        tenantId: getWorkTenantFilter()
      }, null);
    },
    controlWorkTimeline: async () => {
      const workId = String(state.control?.selectedWorkId || "").trim();
      if (!workId) return null;
      return controlFetch(`/api/control-room/work/${encodeURIComponent(workId)}/timeline`, {
        tenantId: getWorkTenantFilter()
      }, null);
    },
    controlAgents: async () => controlFetch("/api/control-room/agents", {
      tenantId: getControlTenantFilter(),
      limit: 120,
      offset: 0
    }, null),
    controlBranches: async () => controlFetch("/api/control-room/branches", {
      tenantId: getControlTenantFilter(),
      limit: 120,
      offset: 0
    }, null),
    controlKeys: async () => controlFetch("/api/control-room/keys", {
      tenantId: getControlTenantFilter(),
      limit: 120,
      offset: 0
    }, null),
    controlAudit: async () => controlFetch("/api/control-room/audit", {
      tenantId: getControlTenantFilter(),
      limit: 120,
      offset: 0
    }, null),
    controlDecisionLedger: async () => controlFetch("/api/control-room/decision-ledger", {
      tenantId: getControlTenantFilter(),
      limit: 120,
      offset: 0
    }, null),
    controlMemory: async () => controlFetch("/api/control-room/memory", {
      tenantId: getControlTenantFilter(),
      limit: 120,
      offset: 0
    }, null),
    controlConnectors: async () => controlFetch("/api/control-room/connectors", {
      tenantId: getControlTenantFilter()
    }, null),
    controlGovernance: async () => controlFetch("/api/control-room/governance", {
      tenantId: getControlTenantFilter()
    }, null),
    controlDemo: async () => controlFetch("/api/demo/agent-workspace-governance", {}, null),
    controlSuperAdminSettings: async () => controlFetch("/api/control-room/tenants", {}, null)
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
    if (key === "runtimeMeta" && value && typeof value === "object") {
      applyControlPayloadMeta(value.control || value);
      setControlDefaultsFromRuntime();
      state.control = {
        ...state.control,
        role: String(state.control?.role || "tenant_admin")
      };
    }
    if (key === "controlTenants") {
      const isSuper = state.control?.role === "super_admin";
      const tenants = Array.isArray(value?.tenants)
        ? value.tenants
        : Array.isArray(value?.data)
          ? value.data
          : [];
      state.control.tenants = isSuper ? tenants : [];
      if (!state.control.selectedTenantId && isSuper && state.control.tenants.length > 0) {
        state.control.selectedTenantId = String(state.control.tenants[0].tenantId || "");
      }
    }
    if (key === "controlExecutive") state.control.executive = value || null;
    if (key === "controlWorkGallery") {
      state.control.workGallery = {
        data: Array.isArray(value?.list) ? value.list : Array.isArray(value?.data) ? value.data : [],
        ...value
      };
    }
    if (key === "controlWork") state.control.work = value || null;
    if (key === "controlWorkTimeline") state.control.workTimeline = value || null;
    if (key === "controlAgents") {
      state.control.agents = {
        data: Array.isArray(value?.data) ? value.data : [],
        ...value
      };
    }
    if (key === "controlBranches") {
      state.control.branches = {
        data: Array.isArray(value?.data) ? value.data : [],
        ...value
      };
    }
    if (key === "controlKeys") {
      state.control.keys = {
        keys: Array.isArray(value?.keys)
          ? value.keys
          : Array.isArray(value?.data)
            ? value.data
            : [],
        ...value
      };
    }
    if (key === "controlAudit") {
      state.control.audit = {
        data: Array.isArray(value?.data) ? value.data : [],
        ...value
      };
    }
    if (key === "controlDecisionLedger") {
      state.control.decisionLedger = {
        data: Array.isArray(value?.data) ? value.data : [],
        ...value
      };
    }
    if (key === "controlMemory") {
      state.control.memory = {
        data: Array.isArray(value?.data) ? value.data : [],
        ...value
      };
    }
    if (key === "controlConnectors") state.control.connectors = value || null;
    if (key === "controlGovernance") state.control.governance = value || null;
    if (key === "controlDemo") state.control.demo = value || null;
    if (key === "controlSuperAdminSettings") state.control.superAdminSettings = value || null;
    if (key.startsWith("control")) {
      state.control.lastLoadByView[key] = {
        loadedAt: new Date().toISOString(),
        key
      };
    }
  }

  async function loadControlDataForView(view = state.currentView) {
    const keys = controlDataKeysForView(view);
    await loadData(keys);
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
    if (String(state.currentView || "").startsWith("control")) {
      return controlDataKeysForView(state.currentView);
    }
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
    loadControlDataForView,
    controlDataKeysForView,
    refreshForUserEvent,
    runLazyRefresh,
    startLazyRefreshLoop
  };
}
