export function resolveApiServerUrl() {
  const defaultApiServerUrl = window.location.origin;
  const storedApiServerUrl = window.localStorage.getItem("smartdesk-api-server-url");
  const apiServerUrl =
    storedApiServerUrl && !storedApiServerUrl.includes(":3020")
      ? storedApiServerUrl
      : defaultApiServerUrl;

  if (!storedApiServerUrl || storedApiServerUrl.includes(":3020")) {
    window.localStorage.setItem("smartdesk-api-server-url", apiServerUrl);
  }

  return apiServerUrl;
}

export const LAZY_REFRESH_MS = 180000;

export const REFRESH_POLICY = {
  instant: ["appointments", "clients", "services", "staff", "center"],
  lazy: ["dashboard", "report", "assistant", "goldCapabilities", "goldDecisionContext"],
  manual: ["sales", "history"]
};

export function createInitialState() {
  const bootDate = new Date();
  const bootDay = bootDate.toISOString().slice(0, 10);
  const bootMonthStart = new Date(bootDate.getFullYear(), bootDate.getMonth(), 1).toISOString().slice(0, 10);

  return {
    currentView: "control-executive",
    settingsSection: "modules",
    center: null,
    settings: null,
    runtimeMeta: null,
    control: {
      role: "tenant_admin",
      selectedTenantId: "",
      controlRoomMode: false,
      tenants: [],
      filters: {
        work: {
          status: "",
          risk: "",
          agent: "",
          projectId: "",
          q: "",
          date: ""
        }
      },
      selectedWorkId: "",
      executive: null,
      workGallery: null,
      work: null,
      workTimeline: null,
      agents: null,
      branches: null,
      keys: null,
      audit: null,
      decisionLedger: null,
      memory: null,
      connectors: null,
      governance: null,
      tenantsAudit: null,
      demo: null,
      superAdminSettings: null,
      lastLoadByView: {}
    },
    dashboard: null,
    report: null,
    clients: [],
    appointments: [],
    services: [],
    staff: [],
    inventoryItems: [],
    inventoryMovements: [],
    inventoryOverview: null,
    profitabilityOverview: null,
    goldCostMinuteProfile: null,
    treatments: [],
    sales: [],
    history: [],
    assistant: null,
    assistantResponse: null,
    goldCapabilities: null,
    goldDecisionContext: null,
    agendaDate: new Date().toISOString().slice(0, 10),
    selectedAppointmentId: null,
    selectedSlot: null,
    agendaDrawerTab: "appointment",
    fullScreenAgenda: false,
    clientSearch: "",
    selectedClientId: null,
    cashdeskDate: bootDay,
    cashdeskClientId: "",
    cashdeskAppointmentId: "",
    cashdeskAmount: "",
    cashdeskMethod: "card",
    cashdeskDescription: "",
    treatmentClientId: "",
    treatmentOperatorName: "",
    treatmentProductsUsed: "",
    treatmentTechnologyUsed: "",
    treatmentProtocolUsed: "",
    treatmentResultNotes: "",
    treatmentPhotoPath: "",
    profitabilityStartDate: bootMonthStart,
    profitabilityEndDate: bootDay,
    assistantOpen: false,
    refreshTimer: null,
    reportPeriod: "day"
  };
}
