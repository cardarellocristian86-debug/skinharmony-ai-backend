import { renderProfitabilityView } from "./views/profitability.js";
import { renderProtocolsView } from "./views/protocols.js";
import { renderMarketingView } from "./views/marketing.js";
import { renderInventoryView } from "./views/inventory.js";
import { renderAgendaView } from "./views/agenda.js";
import { renderClientsView } from "./views/clients.js";
import { renderCashdeskView } from "./views/cashdesk.js";
import { bindAgendaViewEvents, bindClientsViewEvents, bindCashdeskViewEvents } from "./view-bindings/primary.js";
import {
  bindAiGoldViewEvents,
  bindMarketingViewEvents,
  bindInventoryViewEvents,
  bindProfitabilityViewEvents,
  bindProtocolsViewEvents,
  bindServicesViewEvents,
  bindReportsViewEvents,
  bindSettingsViewEvents
} from "./view-bindings/secondary.js";
import { createDataOrchestrator } from "./data-orchestration.js";
import { bindGlobalEvents as bindGlobalEventsBootstrap, initApp } from "./bootstrap/global.js";
import { createSmartDeskDomainHelpers } from "./domain/smartdesk.js";
import { createSmartDeskNormalizers } from "./domain/normalizers.js";
import { createInitialState, LAZY_REFRESH_MS, REFRESH_POLICY, resolveApiServerUrl } from "./runtime.js";
import { createI18n, supportedLanguages } from "./i18n.js";
import { createUiHelpers } from "./ui-helpers.js";
import { createShellHelpers } from "./shell-helpers.js";
import { createSmartDeskOperations } from "./operations.js";

const API_SERVER_URL = resolveApiServerUrl();
const state = createInitialState();
const { currentLanguage, currentLocale, t } = createI18n(state);

function loadGoldCostMinuteProfile() {
  const fallback = {
    fiscalRegime: "ordinary_vat",
    businessType: "hybrid",
    vatRate: 22,
    workingDaysMonthly: 24,
    operatingHoursDaily: 8,
    rent: 0,
    utilitiesPower: 0,
    utilitiesWaterGas: 0,
    accountant: 0,
    insurance: 0,
    software: 0,
    marketing: 0,
    leasing: 0,
    cleaningLaundry: 0,
    bankPosFees: 0,
    payrollOwner: 0,
    taxesContributionsReserve: 0,
    otherFixedCosts: 0
  };
  try {
    const parsed = JSON.parse(window.localStorage.getItem("smartdesk-gold-cost-minute-profile") || "null");
    return { ...fallback, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch (_) {
    return fallback;
  }
}

state.goldCostMinuteProfile = loadGoldCostMinuteProfile();

const appView = document.getElementById("app-view");
const feedbackNode = document.getElementById("feedback");
const assistantDrawer = document.getElementById("assistant-drawer");
const assistantBriefNode = document.getElementById("assistant-brief");
const assistantResponseNode = document.getElementById("assistant-response");
const webShell = document.querySelector(".web-shell");
const topbarNode = document.querySelector(".topbar");
const contentAreaNode = document.querySelector(".content-area");
const dialog = document.getElementById("entity-dialog");
const dialogTitle = document.getElementById("dialog-title");
const dialogFields = document.getElementById("dialog-fields");
const entityForm = document.getElementById("entity-form");
const languageSelect = document.getElementById("language-select");

const { showFeedback, euro, euroFromCents, escapeHtml, safeJsonFetch } = createUiHelpers({
  feedbackNode,
  currentLocale
});

const {
  normalizeClient,
  normalizeAppointment,
  normalizeService,
  normalizeStaff,
  normalizeInventoryItem,
  normalizeInventoryMovement,
  normalizeProfitabilityOverview,
  normalizeTreatment
} = createSmartDeskNormalizers({
  state,
  t,
  currentLanguage
});

function profitabilityStatusTone(status) {
  if (status === "LOSS") return "status-badge critical";
  if (status === "LOW_MARGIN") return "status-badge warning";
  return "status-badge success";
}

function profitabilityStatusLabel(status) {
  if (status === "LOSS") return t("profitabilityView.statusLoss");
  if (status === "LOW_MARGIN") return t("profitabilityView.statusLowMargin");
  return t("profitabilityView.statusProfitable");
}

function controlRole() {
  return String(state.control?.role || "tenant_admin");
}

function controlCan(permission) {
  const role = controlRole();
  const matrix = {
    super_admin: new Set([
      "view_global_health",
      "view_global_agents",
      "view_global_branches",
      "view_global_keys_metadata",
      "view_global_audit",
      "view_global_work_gallery",
      "view_global_decision_ledger",
      "view_global_memory_status",
      "view_connectors_status",
      "view_governance_blockers",
      "view_own_tenant_health",
      "export_sanitized_audit"
    ]),
    tenant_admin: new Set([
      "view_own_tenant_health",
      "view_own_tenant_agents",
      "view_own_tenant_branches",
      "view_own_tenant_keys_metadata",
      "view_own_tenant_audit",
      "view_own_tenant_work_gallery",
      "view_own_tenant_decision_ledger",
      "view_own_tenant_memory_status",
      "view_own_tenant_connectors_status",
      "view_governance_blockers",
      "export_own_sanitized_audit"
    ]),
    tenant_operator: new Set([
      "view_own_assigned_work",
      "view_own_agent_activity",
      "view_own_branch_activity",
      "export_own_sanitized_audit"
    ])
  };
  return matrix[role]?.has(permission) === true;
}

const CONTROL_NAV_PERMISSIONS = {
  "control-executive": [
    "view_global_health",
    "view_own_tenant_health"
  ],
  "control-work-gallery": [
    "view_global_work_gallery",
    "view_own_tenant_work_gallery",
    "view_own_assigned_work"
  ],
  "control-work-detail": [
    "view_global_work_gallery",
    "view_own_tenant_work_gallery",
    "view_own_assigned_work"
  ],
  "control-agents": [
    "view_global_agents",
    "view_own_tenant_agents",
    "view_own_agent_activity"
  ],
  "control-branches": [
    "view_global_branches",
    "view_own_tenant_branches",
    "view_own_branch_activity"
  ],
  "control-keys": [
    "view_global_keys_metadata",
    "view_own_tenant_keys_metadata"
  ],
  "control-audit": [
    "view_global_audit",
    "view_own_tenant_audit"
  ],
  "control-decision-ledger": [
    "view_global_decision_ledger",
    "view_own_tenant_decision_ledger"
  ],
  "control-memory": [
    "view_global_memory_status",
    "view_own_tenant_memory_status"
  ],
  "control-connectors": [
    "view_connectors_status",
    "view_own_tenant_connectors_status"
  ],
  "control-governance": [
    "view_governance_blockers"
  ],
  "control-demo": [
    "view_global_health",
    "view_own_tenant_health",
    "view_own_assigned_work",
    "view_own_agent_activity"
  ],
  "control-super-admin": [
    "view_all_tenants"
  ]
};

function controlViewCan(view) {
  const role = controlRole();
  const permissions = CONTROL_NAV_PERMISSIONS[String(view || "")] || [];
  return permissions.length === 0
    ? role !== "tenant_operator"
    : permissions.some((permission) => controlCan(permission));
}

let controlTenantSelectBound = false;

function syncControlNavigationVisibility() {
  const tenantRole = controlRole();
  const isSuperAdmin = tenantRole === "super_admin";
  const tenantSwitcher = document.getElementById("control-tenant-switcher");
  const tenantSelect = document.getElementById("control-tenant-select");
  if (tenantSwitcher) {
    tenantSwitcher.classList.toggle("hidden", !isSuperAdmin);
  }
  if (tenantSelect) {
    const items = Array.isArray(state.control?.tenants || [])
      ? state.control.tenants
      : [];
    tenantSelect.innerHTML = items
      .map((tenant) => `<option value="${escapeHtml(String(tenant.tenantId || ""))}">${escapeHtml(String(tenant.tenantName || tenant.tenantId || ""))}</option>`)
      .join("");
    const selected = String(state.control?.selectedTenantId || "").trim();
    tenantSelect.value = selected || (items[0]?.tenantId ? String(items[0].tenantId) : "");
    state.control.selectedTenantId = tenantSelect.value || "";
    if (!controlTenantSelectBound && isSuperAdmin) {
      tenantSelect.addEventListener("change", async () => {
        state.control.selectedTenantId = String(tenantSelect.value || "").trim();
        if (String(state.currentView || "").startsWith("control")) {
          await loadControlDataForView(state.currentView);
        }
        renderView();
      });
      controlTenantSelectBound = true;
    }
  }
  const role = controlRole();
  document.querySelectorAll("[data-view]").forEach((button) => {
    if (!String(button.dataset.view || "").startsWith("control-")) return;
    const visible = role === "super_admin" ? true : button.dataset.view !== "control-super-admin";
    const allowed = role === "super_admin"
      ? true
      : controlViewCan(button.dataset.view);
    button.classList.toggle("hidden", !visible || !allowed);
  });
}

function controlDataRoleState() {
  if (state.currentView === "control-executive") {
    return controlCan("view_global_health") || controlCan("view_own_tenant_health");
  }
  if (state.currentView === "control-work-gallery" || state.currentView === "control-work-detail") {
    return controlCan("view_global_work_gallery") || controlCan("view_own_tenant_work_gallery") || controlCan("view_own_assigned_work");
  }
  if (state.currentView === "control-audit") {
    return controlCan("view_global_audit") || controlCan("view_own_tenant_audit");
  }
  if (state.currentView === "control-agents") {
    return controlCan("view_global_agents") || controlCan("view_own_tenant_agents") || controlCan("view_own_agent_activity");
  }
  if (state.currentView === "control-branches") {
    return controlCan("view_global_branches") || controlCan("view_own_tenant_branches") || controlCan("view_own_branch_activity");
  }
  if (state.currentView === "control-keys") {
    return controlCan("view_global_keys_metadata") || controlCan("view_own_tenant_keys_metadata");
  }
  if (state.currentView === "control-decision-ledger") {
    return controlCan("view_global_decision_ledger") || controlCan("view_own_tenant_decision_ledger");
  }
  if (state.currentView === "control-memory") {
    return controlCan("view_global_memory_status") || controlCan("view_own_tenant_memory_status");
  }
  if (state.currentView === "control-connectors") {
    return controlCan("view_connectors_status") || controlCan("view_own_tenant_connectors_status");
  }
  if (state.currentView === "control-governance") {
    return controlCan("view_governance_blockers");
  }
  if (state.currentView === "control-demo") {
    return controlCan("view_global_health")
      || controlCan("view_own_tenant_health")
      || controlCan("view_own_assigned_work")
      || controlCan("view_own_agent_activity");
  }
  if (state.currentView === "control-super-admin") {
    return controlCan("view_all_tenants");
  }
  return false;
}

function readControlWorkFiltersFromDom() {
  const status = String(document.getElementById("control-work-filter-status")?.value || "").trim().toLowerCase();
  const risk = String(document.getElementById("control-work-filter-risk")?.value || "").trim().toLowerCase();
  const tenantId = String(document.getElementById("control-work-filter-tenant")?.value || "").trim();
  const agent = String(document.getElementById("control-work-filter-agent")?.value || "").trim().slice(0, 80);
  const projectId = String(document.getElementById("control-work-filter-project")?.value || "").trim().slice(0, 80);
  const q = String(document.getElementById("control-work-filter-q")?.value || "").trim().slice(0, 120);
  const date = String(document.getElementById("control-work-filter-date")?.value || "").trim().slice(0, 20);
  return { tenantId, status, risk, agent, projectId, q, date };
}

function setControlWorkFilters(filters = {}) {
  state.control.filters.work = {
    tenantId: controlRole() === "super_admin" ? String(filters.tenantId || "").trim() : "",
    status: String(filters.status || "").trim().toLowerCase(),
    risk: String(filters.risk || "").trim().toLowerCase(),
    agent: String(filters.agent || "").trim(),
    projectId: String(filters.projectId || "").trim(),
    q: String(filters.q || "").trim(),
    date: String(filters.date || "").trim()
  };
}

function controlFormatDate(value) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return "--";
  return new Intl.DateTimeFormat(currentLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function controlWorkValue(value, fallback = "—") {
  const text = String(value || "").trim();
  return text.length ? text : fallback;
}

function controlWorkListValue(value) {
  if (!Array.isArray(value) || !value.length) return "—";
  return value.map((item) => String(item || "").trim()).filter(Boolean).join(", ");
}

function controlConnectorStateById(tenantRows = [], connectorId) {
  const rows = Array.isArray(tenantRows) ? tenantRows : [];
  const tenant = rows.find((item) => Array.isArray(item?.list));
  const entry = tenant?.list?.find((item) => item.connectorId === connectorId);
  if (!entry) return "DEGRADED";
  return String(entry.state || entry.health || "DEGRADED");
}

function controlConnectorSummary(connectors = {}) {
  const tenantRows = Array.isArray(connectors?.tenants) ? connectors.tenants : [];
  return {
    github: controlConnectorStateById(tenantRows, "github-resolver"),
    render: controlConnectorStateById(tenantRows, "render-resolver"),
    nyra: controlConnectorStateById(tenantRows, "nyra-runtime"),
    suite: controlConnectorStateById(tenantRows, "suite-bridge"),
    workGallery: tenantRows.some((tenant) => Array.isArray(tenant?.list) && tenant.list.length > 0) ? "ACTIVE" : "DEGRADED"
  };
}

function controlNoData(title, copy) {
  return `
    <section class=\"card\">
      <div class=\"section-title\">${escapeHtml(title)}</div>
      <div class=\"settings-note mt-16\">${escapeHtml(copy || "Nessun dato disponibile.")}</div>
    </section>
  `;
}

function controlListRows(value = {}) {
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value)) return value;
  return [];
}

const {
  loadProfitabilityOverview,
  loadTreatments,
  loadData,
  loadControlDataForView,
  refreshForUserEvent,
  startLazyRefreshLoop
} = createDataOrchestrator({
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
});

const {
  currentPlanId,
  activeNavClass,
  syncTopbar,
  moduleEnabled,
  canUseAiGold,
  renderEnterpriseBanner,
  renderModuleStateCard,
  renderLockedModule,
  renderPeriodFilters,
  kpiCards,
  riskBandLabel
} = createShellHelpers({
  state,
  t,
  currentLanguage,
  escapeHtml,
  webShell,
  topbarNode,
  contentAreaNode,
  languageSelect
});

function normalizeGoldCapabilities(payload) {
  if (!payload) return null;
  if (typeof payload.aiGoldEnabled === "boolean") return payload;
  const primaryAction = payload.primaryAction || payload.decision?.primaryAction || null;
  const blockedActions = payload.blockedActions || payload.decision?.blockedActions || [];
  const score = Number(payload.score || payload.decision?.score || 0);
  return {
    ok: true,
    plan: "gold",
    aiGoldEnabled: true,
    canSuggestActions: true,
    canExecuteAction: false,
    requiresConfirmation: true,
    blocked: Array.isArray(blockedActions) && blockedActions.length > 0,
    primaryAction,
    secondaryActions: payload.secondaryActions || payload.decision?.secondaryActions || [],
    blockedActions,
    risk: {
      score,
      band: score >= 0.75 ? "high" : score >= 0.4 ? "medium" : "low"
    },
    confidence: Number(payload.confidence || 0)
  };
}

function normalizeGoldDecisionContext(payload) {
  if (!payload) return null;
  if (payload.primaryAction && payload.risk && payload.snapshots) return payload;
  const decision = payload.decision || payload;
  const riskScore = Math.max(
    Number(payload.signals?.operationalRisk || 0),
    Number(payload.signals?.marginAnomaly || 0),
    Number(payload.signals?.cashAnomaly || 0),
    1 - Number(payload.signals?.dataReliability ?? 1)
  );
  return {
    source: payload.source || "legacy_gold_state",
    plan: "gold",
    stateVersion: payload.stateVersion || "legacy",
    updatedAt: payload.updatedAt || new Date().toISOString(),
    primaryAction: decision.primaryAction || null,
    secondaryActions: decision.secondaryActions || [],
    blockedActions: decision.blockedActions || [],
    explanationShort: decision.explanationShort || "",
    confidence: Number(payload.confidence || payload.snapshots?.business?.confidence || 0),
    risk: {
      score: riskScore,
      band: riskScore >= 0.75 ? "high" : riskScore >= 0.4 ? "medium" : "low"
    },
    signals: payload.signals || {},
    snapshots: payload.snapshots || {}
  };
}

function goldTargetView(item) {
  const domain = String(item?.domain || "").toLowerCase();
  const action = String(item?.action || "").toLowerCase();
  if (domain.includes("cash") || action.includes("cash") || action.includes("payment")) return "cashdesk";
  if (domain.includes("growth") || domain.includes("client") || action.includes("recall")) return "clients";
  if (domain.includes("operations") || action.includes("agenda") || action.includes("appointment")) return "appointments";
  if (domain.includes("inventory") || action.includes("inventory") || action.includes("stock")) return "inventory";
  if (domain.includes("profit")) return "profitability";
  if (domain.includes("protocol") || domain.includes("treatment") || action.includes("protocol") || action.includes("treatment")) return "protocols";
  if (domain.includes("service")) return "services";
  return "dashboard";
}

function goldPriorityTone(item = {}, context = {}) {
  const text = [
    item?.priority,
    item?.level,
    item?.severity,
    item?.actionBand,
    item?.action,
    item?.domain,
    item?.label,
    context?.risk?.band,
    context?.actionBand
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  const score = Math.max(
    Number(item?.score || 0),
    Number(item?.priorityScore || 0),
    Number(item?.riskAdjustedPriority || 0),
    Number(context?.risk?.score || 0)
  );
  const hasActionTarget = goldTargetView(item) !== "dashboard";
  if (
    hasActionTarget &&
    (
      text.includes("act_now") ||
      text.includes("critical") ||
      text.includes("urgent") ||
      text.includes("alta") ||
      text.includes("high") ||
      text.includes("sottoscorta") ||
      text.includes("stock") ||
      score >= 0.72
    )
  ) return "critical";
  if (text.includes("verify") || text.includes("warning") || text.includes("medium") || score >= 0.5) return "warning";
  return "regular";
}

function priorityCardClass(item = {}, context = {}) {
  const tone = goldPriorityTone(item, context);
  return tone === "critical" ? "priority-card priority-critical" : tone === "warning" ? "priority-card priority-warning" : "priority-card";
}

function goldMarketingQueue() {
  return (state.clients || [])
    .filter((item) => item.marketingConsent && item.recallDue)
    .sort((a, b) => String(a.recallDue || "").localeCompare(String(b.recallDue || "")))
    .slice(0, 5);
}

function daysFromToday(dateValue) {
  if (!dateValue) return null;
  const parsed = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((parsed.getTime() - todayStart.getTime()) / 86400000);
}

function marketingMessageForClient(client) {
  const firstName = String(client?.firstName || client?.name || "").trim().split(/\s+/)[0] || t("marketingView.defaultClientName");
  return t("marketingView.defaultMessage", { firstName });
}

function classifyMarketingClient(client) {
  const diff = daysFromToday(client?.recallDue);
  if (diff === null) return "historic";
  if (diff > 7) return "historic";
  if (diff >= 0) return "at_risk";
  if (diff >= -21) return "to_recall";
  return "lost";
}

function inventoryTone(item) {
  if (Number(item.stockQuantity || 0) <= 0) return "critical";
  if (Number(item.stockQuantity || 0) <= Number(item.thresholdQuantity || 0)) return "critical";
  return "regular";
}

function inventoryStateLabel(item) {
  const tone = inventoryTone(item);
  if (tone === "critical") return t("inventoryView.stateEmpty");
  if (tone === "warning") return t("inventoryView.stateWarning");
  return t("inventoryView.stateRegular");
}

function inventoryQuantityLabel(value, unit) {
  const safe = Number(value || 0);
  const normalized = Number.isInteger(safe) ? String(safe) : safe.toFixed(2).replace(/\.00$/, "");
  return `${normalized} ${unit || t("inventoryView.quantityUnitFallback")}`.trim();
}

function inventoryMovementLabel(type) {
  const normalized = String(type || "load").toLowerCase();
  if (normalized === "unload") return t("inventoryView.movementUnload");
  if (normalized === "internal_use") return t("inventoryView.movementInternalUse");
  if (normalized === "sale") return t("inventoryView.movementSale");
  if (normalized === "return") return t("inventoryView.movementReturn");
  if (normalized === "adjustment") return t("inventoryView.movementAdjustment");
  return t("inventoryView.movementLoad");
}

function goldPreviewFallback() {
  const dashboard = state.dashboard || {};
  const marketingQueue = goldMarketingQueue();
  const cashAlerts = cashdeskClosedSessionsToVerify().length;
  const waiting = Number(dashboard.summary?.waiting || 0);
  const alerts = Array.isArray(dashboard.alerts) ? dashboard.alerts : [];

  let primaryAction = {
    label: t("aiGoldView.monitorCenter"),
    action: "MONITOR",
    domain: "center",
    score: 0.38
  };
  let explanationShort = t("aiGoldView.needMoreData");
  let risk = { score: 0.28, band: "low" };

  if (cashAlerts > 0) {
    primaryAction = {
      label: currentLanguage() === "en" ? "Verify daily cash flow" : "Verifica la cassa del giorno",
      action: "VERIFY_CASHDESK",
      domain: "cashdesk",
      score: 0.82
    };
    explanationShort = currentLanguage() === "en"
      ? "There are completed sessions without an evident linked payment in the selected day."
      : "Ci sono sedute chiuse senza un pagamento evidente collegato nella giornata selezionata.";
    risk = { score: 0.74, band: "medium" };
  } else if (marketingQueue.length > 0) {
    primaryAction = {
      label: currentLanguage() === "en" ? "Review the recall queue" : "Rivedi la coda recall",
      action: "REVIEW_RECALL_QUEUE",
      domain: "growth",
      score: 0.76
    };
    explanationShort = currentLanguage() === "en"
      ? "There are clients with consent and operational recall priority ready for review."
      : "Ci sono clienti con consenso e priorita recall operativa pronti da rivedere.";
    risk = { score: 0.56, band: "medium" };
  } else if (waiting > 0) {
    primaryAction = {
      label: currentLanguage() === "en" ? "Reorder agenda confirmations" : "Riordina le conferme agenda",
      action: "CHECK_AGENDA_CONFIRMATIONS",
      domain: "operations",
      score: 0.64
    };
    explanationShort = currentLanguage() === "en"
      ? "There are open confirmations in the current operational reading."
      : "Ci sono conferme aperte nella lettura operativa corrente.";
    risk = { score: 0.44, band: "medium" };
  } else if (alerts.length > 0) {
    primaryAction = {
      label: currentLanguage() === "en" ? "Review center alerts" : "Rivedi gli avvisi del centro",
      action: "REVIEW_CENTER_ALERTS",
      domain: "profitability",
      score: 0.58
    };
    explanationShort = String(alerts[0] || t("aiGoldView.needMoreData"));
    risk = { score: 0.41, band: "medium" };
  } else {
    explanationShort = currentLanguage() === "en"
      ? "Preview mode: Gold is reading the current center signals without using protected Gold endpoints."
      : "Modalita preview: Gold legge i segnali correnti del centro senza usare gli endpoint Gold protetti.";
  }

  const secondaryActions = [
    marketingQueue.length > 0 ? {
      label: currentLanguage() === "en" ? "Open clients to review recall" : "Apri clienti per rivedere i recall",
      domain: "clients",
      action: "OPEN_CLIENTS_RECALL",
      score: 0.67
    } : null,
    waiting > 0 ? {
      label: currentLanguage() === "en" ? "Open agenda" : "Apri agenda",
      domain: "operations",
      action: "OPEN_AGENDA",
      score: 0.61
    } : null,
    cashAlerts > 0 ? {
      label: currentLanguage() === "en" ? "Open cash desk" : "Apri cassa",
      domain: "cashdesk",
      action: "OPEN_CASHDESK",
      score: 0.72
    } : null
  ].filter(Boolean);

  return {
    capabilities: {
      ok: true,
      plan: "gold",
      aiGoldEnabled: true,
      canSuggestActions: true,
      canExecuteAction: false,
      requiresConfirmation: true,
      blocked: false,
      primaryAction,
      secondaryActions,
      blockedActions: [],
      risk,
      confidence: 0.62,
      previewMode: true
    },
    context: {
      source: "preview_gold_fallback",
      plan: "gold",
      stateVersion: "preview_fallback_v1",
      updatedAt: new Date().toISOString(),
      primaryAction,
      secondaryActions,
      blockedActions: [],
      explanationShort,
      confidence: 0.62,
      risk,
      signals: {
        openConfirmations: waiting,
        recallQueue: marketingQueue.length,
        cashSessionsToVerify: cashAlerts,
        alerts: alerts.length
      },
      snapshots: {
        business: dashboard
      }
    }
  };
}

function renderAiGoldPriority() {
  const fallback = goldPreviewFallback();
  const context = state.goldDecisionContext || fallback.context;
  const capabilities = state.goldCapabilities || fallback.capabilities;
  if (!context || !capabilities) {
    return `
      <section class="card">
        <div class="section-title">${t("aiGoldView.title")}</div>
        <div class="settings-note mt-16">${t("aiGoldView.unavailable")}</div>
      </section>
    `;
  }

  const primary = context.primaryAction || capabilities.primaryAction || null;
  const secondary = Array.isArray(context.secondaryActions) ? context.secondaryActions : [];
  const blocked = Array.isArray(context.blockedActions) ? context.blockedActions : [];
  const risk = context.risk || capabilities.risk || { score: 0, band: "low" };
  const confidence = Number(context.confidence ?? capabilities.confidence ?? 0);

  return `
    <section class="card">
      <div class="row between mb-16">
        <div>
          <div class="section-title">${t("aiGoldView.title")}</div>
          <div class="page-subtitle">${t("aiGoldView.subtitle")}</div>
        </div>
        <div class="hero-badges">
          <div class="module-pill active">${t("aiGoldView.risk")} ${escapeHtml(riskBandLabel(risk.band))}</div>
          <button class="sh-button secondary-btn" data-view-link="ai-gold" type="button">${t("aiGoldView.openRoom")}</button>
        </div>
      </div>
      <div class="dashboard-focus-grid">
        <div class="dashboard-focus-item">
          <div class="stat-label">${t("aiGoldView.todayPriority")}</div>
          <div class="focus-value">${escapeHtml(primary?.label || t("aiGoldView.monitorCenter"))}</div>
        </div>
        <div class="dashboard-focus-item">
          <div class="stat-label">${t("aiGoldView.confidence")}</div>
          <div class="focus-value">${Math.round(confidence * 100)}%</div>
        </div>
        <div class="dashboard-focus-item">
          <div class="stat-label">${t("aiGoldView.action")}</div>
          <div class="focus-value">${escapeHtml(primary?.action || "MONITOR")}</div>
        </div>
      </div>
      <div class="list mt-16">
        <div class="list-item ${priorityCardClass(primary, context)}">
          <div class="item-title">${escapeHtml(context.explanationShort || t("aiGoldView.needMoreData"))}</div>
          <div class="item-subtitle">${t("aiGoldView.domain")}: ${escapeHtml(primary?.domain || "center")} · ${t("aiGoldView.risk").toLowerCase()} ${Number(risk.score || 0).toFixed(2)}</div>
        </div>
        ${secondary.map((item) => `
          <div class="list-item ${priorityCardClass(item, context)}">
            <div class="item-title">${escapeHtml(item.label || item.domain || t("aiGoldView.secondaryPriority"))}</div>
            <div class="item-subtitle">${t("aiGoldView.domain")}: ${escapeHtml(item.domain || "center")} · score ${Number(item.score || 0).toFixed(2)}</div>
          </div>
        `).join("")}
        ${blocked.length ? `
          <div class="list-item">
            <div class="item-title">${t("aiGoldView.blockedActions")}</div>
            <div class="item-subtitle">${blocked.map((item) => escapeHtml(item)).join(" · ")}</div>
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function renderAiGoldRoom() {
  const fallback = goldPreviewFallback();
  const context = state.goldDecisionContext || fallback.context;
  const capabilities = state.goldCapabilities || fallback.capabilities;
  if (!context || !capabilities) {
    return `
      <section class="card">
        <div class="section-title">${t("aiGoldView.roomTitle")}</div>
        <div class="settings-note mt-16">${t("aiGoldView.unavailable")}</div>
      </section>
    `;
  }

  const dashboard = state.dashboard || {};
  const primary = context.primaryAction || capabilities.primaryAction || null;
  const secondary = Array.isArray(context.secondaryActions) ? context.secondaryActions : [];
  const blocked = Array.isArray(context.blockedActions) ? context.blockedActions : [];
  const risk = context.risk || capabilities.risk || { score: 0, band: "low" };
  const confidence = Number(context.confidence ?? capabilities.confidence ?? 0);
  const marketingQueue = goldMarketingQueue();
  const alerts = Array.isArray(dashboard.alerts) ? dashboard.alerts.slice(0, 3) : [];

  return `
    <div class="stack">
      <section class="card">
        <div class="row between mb-16">
          <div>
            <div class="section-title">${t("aiGoldView.roomTitle")}</div>
            <div class="page-subtitle">${t("aiGoldView.roomSubtitle")}</div>
          </div>
          <div class="hero-badges">
            <div class="module-pill active">${t("aiGoldView.roleBadge")}</div>
            ${capabilities.previewMode ? `<div class="module-pill">${currentLanguage() === "en" ? "Preview mode" : "Modalita preview"}</div>` : ""}
            <button class="sh-button secondary-btn" data-view-link="dashboard" type="button">${t("aiGoldView.backToDashboard")}</button>
          </div>
        </div>
        <div class="dashboard-focus-grid">
          <div class="dashboard-focus-item"><div class="stat-label">${t("ecosystem.appointmentsToday")}</div><div class="focus-value">${dashboard.summary?.appointmentsToday ?? 0}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("dashboardView.revenue")}</div><div class="focus-value">${euro(dashboard.summary?.revenue ?? 0)}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("dashboardView.reminders")}</div><div class="focus-value">${dashboard.summary?.reminders ?? 0}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("cashdeskView.sessionsToVerify")}</div><div class="focus-value">${cashdeskClosedSessionsToVerify().length}</div></div>
        </div>
      </section>

      <div class="settings-grid">
        <section class="card ${goldPriorityTone(primary, context) === "critical" ? "priority-section priority-critical" : ""}">
          <div class="row between mb-16">
            <div class="section-title">${t("aiGoldView.todayPriority")}</div>
            <div class="module-pill active">${t("aiGoldView.risk")} ${escapeHtml(riskBandLabel(risk.band))}</div>
          </div>
          <div class="consultation-box ${priorityCardClass(primary, context)}">
            <div class="item-title">${escapeHtml(primary?.label || t("aiGoldView.monitorCenter"))}</div>
            <div class="item-subtitle mt-16">${escapeHtml(context.explanationShort || t("aiGoldView.needMoreData"))}</div>
            <div class="item-subtitle mt-16">${t("aiGoldView.domain")}: ${escapeHtml(primary?.domain || "center")} · ${t("aiGoldView.action")}: ${escapeHtml(primary?.action || "MONITOR")} · ${t("aiGoldView.confidence")}: ${Math.round(confidence * 100)}%</div>
            <div class="action-row mt-16">
              <button class="sh-button" data-view-link="${goldTargetView(primary)}" type="button">${t("aiGoldView.openModule")}</button>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="section-title mb-16">${t("aiGoldView.executionPolicy")}</div>
          <div class="settings-note">${t("aiGoldView.executionPolicyCopy")}</div>
          <div class="module-pills mt-16">
            <div class="module-pill active">${t("aiGoldView.requiresConfirmation")}</div>
            <div class="module-pill">${t("aiGoldView.directExecutionBlocked")}</div>
          </div>
          ${blocked.length ? `
            <div class="consultation-box mt-16">
              <div class="stat-label">${t("aiGoldView.blockedActions")}</div>
              <div>${blocked.map((item) => escapeHtml(item)).join(" · ")}</div>
            </div>
          ` : ""}
        </section>
      </div>

      <div class="settings-grid">
        <section class="card">
          <div class="section-title mb-16">${t("aiGoldView.nextPriorities")}</div>
          <div class="list">
            ${secondary.length ? secondary.slice(0, 4).map((item) => `
              <div class="list-item ${priorityCardClass(item, context)}">
                <div>
                  <div class="item-title">${escapeHtml(item.label || item.domain || t("aiGoldView.secondaryPriority"))}</div>
                  <div class="item-subtitle">${t("aiGoldView.domain")}: ${escapeHtml(item.domain || "center")} · score ${Number(item.score || 0).toFixed(2)}</div>
                </div>
                <button class="sh-button secondary-btn" data-view-link="${goldTargetView(item)}" type="button">${t("aiGoldView.openModule")}</button>
              </div>
            `).join("") : `<div class="settings-note">${t("aiGoldView.noSecondaryPriorities")}</div>`}
          </div>
        </section>

        <section class="card">
          <div class="section-title mb-16">${t("aiGoldView.todayPressures")}</div>
          <div class="module-pills mb-16">
            <div class="module-pill ${(dashboard.summary?.waiting || 0) > 0 ? "active" : ""}">${t("aiGoldView.openConfirmations")} · ${dashboard.summary?.waiting ?? 0}</div>
            <div class="module-pill ${cashdeskClosedSessionsToVerify().length > 0 ? "active" : ""}">Cassa · ${cashdeskClosedSessionsToVerify().length > 0 ? t("aiGoldView.cashBlocked") : t("aiGoldView.cashAligned")}</div>
            <div class="module-pill ${alerts.length > 0 ? "active" : ""}">${t("aiGoldView.profitabilityAlerts")} · ${alerts.length} ${t("aiGoldView.alertsSuffix")}</div>
          </div>
          <div class="list">
            ${alerts.length ? alerts.map((item) => `
              <div class="list-item priority-card priority-warning">
                <div class="item-title">${escapeHtml(item)}</div>
              </div>
            `).join("") : `<div class="settings-note">${t("aiGoldView.needMoreData")}</div>`}
          </div>
        </section>
      </div>

      <section class="card">
        <div class="row between mb-16">
          <div class="section-title">${t("aiGoldView.marketingQueue")}</div>
          <button class="sh-button secondary-btn" data-view-link="clients" type="button">${t("aiGoldView.reviewInClients")}</button>
        </div>
        <div class="list">
          ${marketingQueue.length ? marketingQueue.map((item) => `
            <div class="list-item">
              <div>
                <div class="item-title">${escapeHtml(item.name || `${item.firstName || ""} ${item.lastName || ""}`.trim() || t("agendaView.client"))}</div>
                <div class="item-subtitle">${escapeHtml(item.recallDue || "--")} · ${escapeHtml(item.recommendedProtocol || t("clientsView.noProtocol"))}</div>
              </div>
              <button class="sh-button secondary-btn" data-action="select-client-gold-queue" data-id="${escapeHtml(item.id)}" type="button">${t("clientsView.open")}</button>
            </div>
          `).join("") : `<div class="settings-note">${t("aiGoldView.noMarketingQueue")}</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderMarketing() {
  return renderMarketingView({
    moduleEnabled,
    renderLockedModule,
    currentLanguage,
    canUseAiGold,
    state,
    classifyMarketingClient,
    marketingMessageForClient,
    daysFromToday,
    t,
    renderEnterpriseBanner,
    escapeHtml,
    goldMarketingQueue
  });
}

function renderInventory() {
  return renderInventoryView({
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
  });
}

function renderProfitability() {
  return renderProfitabilityView({
    moduleEnabled,
    renderLockedModule,
    t,
    state,
    normalizeProfitabilityOverview,
    renderEnterpriseBanner,
    escapeHtml,
    kpiCards,
    euroFromCents,
    profitabilityStatusTone,
    profitabilityStatusLabel,
    currentPlanId,
    currentLanguage
  });
}

function renderProtocols() {
  return renderProtocolsView({
    moduleEnabled,
    renderLockedModule,
    t,
    state,
    currentPlanId,
    renderEnterpriseBanner,
    escapeHtml,
    renderModuleStateCard,
    canUseAiGold,
    currentLocale
  });
}

function renderEcosystem() {
  const center = state.center || {};
  const dashboard = state.dashboard || {};
  const devices = Array.isArray(center.devices) ? center.devices : [];
  return `
    <div class="stack">
      ${renderEnterpriseBanner()}
      <section class="card">
        <div class="dashboard-hero">
          <div>
            <div class="section-title">${t("ecosystem.title")}</div>
            <div class="page-subtitle">${t("ecosystem.subtitle")}</div>
          </div>
          <div class="hero-badges">
            <div class="module-pill active">${escapeHtml(center.centerType || "Advanced Aesthetic Systems")}</div>
            <button class="sh-button secondary-btn" data-view-link="settings" type="button">${t("ecosystem.configure")}</button>
          </div>
        </div>
        <div class="dashboard-focus-grid">
          <div class="dashboard-focus-item"><div class="stat-label">${t("ecosystem.activeOperators")}</div><div class="focus-value">${dashboard.summary?.activeStaff ?? 0}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("ecosystem.appointmentsToday")}</div><div class="focus-value">${dashboard.summary?.appointmentsToday ?? 0}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("ecosystem.lowStock")}</div><div class="focus-value">${dashboard.summary?.lowStock ?? 0}</div></div>
        </div>
      </section>
      <section class="card">
        <div class="row between mb-16">
          <div class="section-title">${t("ecosystem.surfacesTitle")}</div>
          <button class="sh-button secondary-btn" data-action="open-settings-section" data-section="modules" type="button">${t("ecosystem.openSetup")}</button>
        </div>
        <div class="module-state-grid">
          ${renderModuleStateCard({
            key: "protocols",
            title: t("ecosystem.protocolsTitle"),
            enabledCopy: t("ecosystem.protocolsEnabled"),
            lockedCopy: t("ecosystem.protocolsLocked")
          })}
          ${renderModuleStateCard({
            key: "shiftsBase",
            title: t("ecosystem.shiftsTitle"),
            enabledCopy: t("ecosystem.shiftsEnabled"),
            lockedCopy: t("ecosystem.shiftsLocked")
          })}
          ${renderModuleStateCard({
            key: "profitability",
            title: t("ecosystem.profitabilityTitle"),
            enabledCopy: t("ecosystem.profitabilityEnabled"),
            lockedCopy: t("ecosystem.profitabilityLocked")
          })}
        </div>
      </section>
      <div class="settings-grid">
        <section class="card">
          <div class="section-title">${t("ecosystem.coreliaRuntime")}</div>
          <div class="list mt-16">
            <div class="list-item"><div class="item-title">${t("ecosystem.v0Title")}</div><div class="item-subtitle">${t("ecosystem.v0Copy")}</div></div>
            <div class="list-item"><div class="item-title">${t("ecosystem.v2Title")}</div><div class="item-subtitle">${t("ecosystem.v2Copy")}</div></div>
            <div class="list-item"><div class="item-title">${t("ecosystem.v7Title")}</div><div class="item-subtitle">${t("ecosystem.v7Copy")}</div></div>
          </div>
        </section>
        <section class="card">
          <div class="section-title">${t("ecosystem.coreliaSpace")}</div>
          <div class="list mt-16">
            <div class="list-item"><div class="item-title">${t("ecosystem.decisionEngineTitle")}</div><div class="item-subtitle">${t("ecosystem.decisionEngineCopy")}</div></div>
            <div class="list-item"><div class="item-title">${t("ecosystem.extensionTitle")}</div><div class="item-subtitle">${t("ecosystem.extensionCopy")}</div></div>
            ${devices.map((device) => `<div class="list-item"><div class="item-title">${escapeHtml(device)}</div><div class="item-subtitle">${t("ecosystem.availableTechnology")}</div></div>`).join("") || `<div class="settings-note">${t("ecosystem.noTechnology")}</div>`}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const dashboard = state.dashboard || {};
  const cards = [
    { label: t("ecosystem.appointmentsToday"), value: dashboard.summary?.appointmentsToday ?? 0 },
    { label: t("dashboardView.waiting"), value: dashboard.summary?.waiting ?? 0 },
    { label: t("ecosystem.activeOperators"), value: dashboard.summary?.activeStaff ?? 0 },
    { label: t("dashboardView.reminders"), value: dashboard.summary?.reminders ?? 0 },
    { label: t("dashboardView.revenue"), value: euro(dashboard.summary?.revenue ?? 0) }
  ];

  return `
    <div class="stack">
      ${renderEnterpriseBanner()}
      <section class="card">
        <div class="dashboard-hero">
        <div>
            <div class="section-title">${t("dashboardView.title")}</div>
            <div class="page-subtitle">${t("dashboardView.subtitle")}</div>
          </div>
          <div class="hero-badges">
            <div class="module-pill active">${new Date().toLocaleDateString(currentLocale(), { weekday: "long", day: "numeric", month: "long" })}</div>
            <button class="sh-button" data-view-link="appointments" type="button">${t("dashboardView.openAgenda")}</button>
          </div>
        </div>
      </section>
      ${renderAiGoldPriority()}
      ${kpiCards(cards)}
      <div class="settings-grid">
        <section class="card">
          <div class="row between mb-16">
            <div class="section-title">${t("dashboardView.nextAppointments")}</div>
            <button class="sh-button secondary-btn" data-view-link="clients" type="button">${t("dashboardView.openClients")}</button>
          </div>
          <div class="list">
            ${(dashboard.appointments || []).slice(0, 5).map((item) => `
              <div class="list-item">
                <div class="item-title">${escapeHtml(item.time || "--:--")} · ${escapeHtml(item.client || item.clientName || t("agendaView.client"))}</div>
                <div class="item-subtitle">${escapeHtml(item.service || item.serviceName || (currentLanguage() === "en" ? "Service" : "Servizio"))} · ${escapeHtml(item.operator || item.staffName || (currentLanguage() === "en" ? "Operator" : "Operatore"))}</div>
              </div>
            `).join("") || `<div class="settings-note">${t("dashboardView.noAppointments")}</div>`}
          </div>
        </section>
        <section class="card">
          <div class="row between mb-16">
            <div class="section-title">${t("dashboardView.focusTitle")}</div>
            <button class="sh-button secondary-btn" data-view-link="reports" type="button">${t("dashboardView.openReports")}</button>
          </div>
          <div class="dashboard-focus-grid">
            <div class="dashboard-focus-item"><div class="stat-label">${t("dashboardView.activeClients")}</div><div class="focus-value">${state.clients.length}</div></div>
            <div class="dashboard-focus-item"><div class="stat-label">${t("dashboardView.activeServices")}</div><div class="focus-value">${state.services.length}</div></div>
            <div class="dashboard-focus-item"><div class="stat-label">${t("dashboardView.activeStaff")}</div><div class="focus-value">${state.staff.filter((item) => item.active).length}</div></div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderControlExecutive() {
  const executive = state.control?.executive || {};
  const tenantsConfigured = executive.tiles?.tenantsConfigured ?? "—";
  const tenantsActive = executive.tiles?.tenantsActive ?? "—";
  const agentsRegistered = executive.tiles?.agentsRegistered ?? "—";
  const nyraBranchesActive = executive.tiles?.nyraBranchesActive ?? "—";
  const coreDecisions = executive.tiles?.coreDecisionsLast24h ?? "—";
  const blockedActions = executive.tiles?.blockedActionsLast24h ?? "—";
  const confirmationsRequested = executive.tiles?.confirmationsRequested ?? "—";
  const toolCompleted = executive.tiles?.toolCompleted ?? "—";
  const toolFailed = executive.tiles?.toolFailed ?? "—";
  const activeWorks = executive.tiles?.activeWorks ?? "—";
  const activeSessions = executive.tiles?.activeSessions ?? "—";
  const locksActive = executive.tiles?.locksActive ?? "—";
  const artifactsIndexed = executive.tiles?.artifactsIndexed ?? "—";
  const memoryCloudDocs = executive.tiles?.memoryCloudDocs ?? "—";
  const governance = executive.governance?.state || executive.scopeSummary?.governanceState || "DEGRADED";
  const summaryTime = controlFormatDate(executive.tiles?.lastUpdateAt || executive.scopeSummary?.timestamp);
  const connectorsSummary = controlConnectorSummary(executive.connectorHealth || state.control.connectors || {});
  const scope = executive.scope || "tenant";
  const selectedTenant = executive.selectedTenantId || "—";
  const tenantRows = Array.isArray(executive.tenantBreakdown) ? executive.tenantBreakdown : [];

  return `
    <div class="stack">
      <section class="card">
        <div class="row between mb-16">
          <div>
            <div class="section-title">${currentLanguage() === "en" ? "Executive view" : "Executive View"}</div>
            <div class="page-subtitle">${currentLanguage() === "en" ? "Panoramica governance enterprise" : "Panoramica enterprise governance"} · ${currentLanguage() === "en" ? "Scope" : "Ambito"}: ${scope === "global" ? "global" : escapeHtml(selectedTenant)}</div>
          </div>
          <div class="hero-badges">
            <div class="module-pill active">${currentLanguage() === "en" ? "Read-only" : "Sola lettura"}</div>
            <div class="module-pill">${controlRole()}</div>
          </div>
        </div>
        <div class="settings-note">${controlRole() === "super_admin" ? (currentLanguage() === "en" ? "Cross-tenant aggregation available for super admin." : "Aggregati cross-tenant disponibili per super admin.") : (currentLanguage() === "en" ? "Data scoped to own tenant." : "Dati limitati al tenant proprietario.")}</div>
      </section>
      <div class="dashboard-focus-grid">
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Tenants configured" : "Tenant configurati"}</div><div class="focus-value">${escapeHtml(String(tenantsConfigured))}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Tenants active" : "Tenant attivi"}</div><div class="focus-value">${escapeHtml(String(tenantsActive))}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Registered agents" : "Agenti registrati"}</div><div class="focus-value">${escapeHtml(String(agentsRegistered))}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Nyra active branches" : "Rami Nyra attivi"}</div><div class="focus-value">${escapeHtml(String(nyraBranchesActive))}</div></div>
      </div>
      <div class="dashboard-focus-grid">
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Core decisions (24h)" : "Decisioni Core 24h"}</div><div class="focus-value">${escapeHtml(String(coreDecisions))}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Blocked actions (24h)" : "Azioni bloccate 24h"}</div><div class="focus-value">${escapeHtml(String(blockedActions))}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Requested confirmations" : "Conferme richieste"}</div><div class="focus-value">${escapeHtml(String(confirmationsRequested))}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Tools completed" : "Tool completati"}</div><div class="focus-value">${escapeHtml(String(toolCompleted))}</div></div>
      </div>
      <div class="dashboard-focus-grid">
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Tool failed" : "Tool falliti"}</div><div class="focus-value">${escapeHtml(String(toolFailed))}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Active work" : "Work attivi"}</div><div class="focus-value">${escapeHtml(String(activeWorks))}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Active sessions" : "Sessioni attive"}</div><div class="focus-value">${escapeHtml(String(activeSessions))}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Active locks" : "Lock attivi"}</div><div class="focus-value">${escapeHtml(String(locksActive))}</div></div>
      </div>
      <div class="dashboard-focus-grid">
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Indexed artifacts" : "Artifact indicizzati"}</div><div class="focus-value">${escapeHtml(String(artifactsIndexed))}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Memory docs" : "Documenti memoria cloud"}</div><div class="focus-value">${escapeHtml(String(memoryCloudDocs))}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Governance state" : "Stato governance"}</div><div class="focus-value">${escapeHtml(String(governance))}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${currentLanguage() === "en" ? "Data update" : "Ultimo aggiornamento"}</div><div class="focus-value">${escapeHtml(summaryTime)}</div></div>
      </div>
      <div class="settings-grid">
        <section class="card">
          <div class="section-title">${currentLanguage() === "en" ? "Connector states" : "Stati connector"}</div>
          <div class="list mt-16">
            <div class="list-item"><div class="item-title">GitHub credential resolver</div><div class="item-subtitle">${escapeHtml(connectorsSummary.github)}</div></div>
            <div class="list-item"><div class="item-title">Render resolver</div><div class="item-subtitle">${escapeHtml(connectorsSummary.render)}</div></div>
            <div class="list-item"><div class="item-title">Core runtime</div><div class="item-subtitle">${escapeHtml(connectorsSummary.nyra)}</div></div>
            <div class="list-item"><div class="item-title">Suite bridge</div><div class="item-subtitle">${escapeHtml(connectorsSummary.suite)}</div></div>
            <div class="list-item"><div class="item-title">${currentLanguage() === "en" ? "Work Gallery" : "Work Gallery"}</div><div class="item-subtitle">${escapeHtml(connectorsSummary.workGallery)}</div></div>
            <div class="list-item"><div class="item-title">Nyra workflow</div><div class="item-subtitle">${escapeHtml(connectorsSummary.nyra)}</div></div>
          </div>
        </section>
        ${controlRole() === "super_admin" ? `
          <section class="card">
            <div class="section-title">${currentLanguage() === "en" ? "Tenant breakdown" : "Break down tenant"}</div>
            <div class="list mt-16">
              ${tenantRows.map((item) => `<div class="list-item"><div class="item-title">${escapeHtml(item.tenantName || item.tenantId || "")}</div><div class="item-subtitle">${currentLanguage() === "en" ? "Status" : "Stato"}: ${escapeHtml(item.tenantName ? "active" : "—")}</div></div>`).join("") || `<div class="settings-note">${currentLanguage() === "en" ? "No tenant data." : "Nessun dato tenant."}</div>`}
            </div>
          </section>
        ` : ""}
      </div>
      <section class="card">
        <div class="section-title">${currentLanguage() === "en" ? "Read-only controls" : "Controlli solo lettura"}</div>
        <div class="settings-note">${currentLanguage() === "en" ? "La console control room non esegue mutazioni: tutte le azioni operative sono bloccate o route separata con conferma owner." : "La control room non esegue mutazioni: azioni operative bloccate o eseguite da workflow separato con conferma owner."}</div>
      </section>
    </div>
  `;
}

function renderControlWorkGallery() {
  if (!controlCan("view_own_tenant_work_gallery") && !controlCan("view_global_work_gallery") && !controlCan("view_own_assigned_work")) {
    return controlNoData(
      currentLanguage() === "en" ? "Tenant Work Gallery" : "Tenant Work Gallery",
      currentLanguage() === "en" ? "Permesso non disponibile per questo ruolo." : "Permesso non disponibile per questo ruolo."
    );
  }
  const filters = state.control?.filters?.work || {};
  const rows = Array.isArray(state.control?.workGallery?.data) ? state.control.workGallery.data : [];
  const tenantOptions = controlRole() === "super_admin" && Array.isArray(state.control?.tenants) ? state.control.tenants : [];
  const visibleRows = rows.filter((work) => {
    const tenantMatch = !String(filters.tenantId || "").trim() || String(work.tenantId || "").toLowerCase() === String(filters.tenantId || "").toLowerCase();
    const status = String(filters.status || "").toLowerCase();
    const risk = String(filters.risk || "").toLowerCase();
    const statusMatch = !status || String(work.status || "").toLowerCase() === status;
    const riskValue = String(work.riskLevel || work.risk || work.livelloRischio || "").toLowerCase();
    const riskMatch = !risk || riskValue === risk;
    const agentMatch = !String(filters.agent || "").trim() || JSON.stringify(work.agentsPresent || []).toLowerCase().includes(String(filters.agent).toLowerCase());
    const projectMatch = !String(filters.projectId || "").trim() || String(work.projectId || "").toLowerCase().includes(String(filters.projectId).toLowerCase());
    const dateMatch = !String(filters.date || "").trim() || String(work.openedAt || work.lastUpdatedAt || "").includes(String(filters.date));
    const q = String(filters.q || "").trim().toLowerCase();
    const textMatch = !q || String(work.title || "").toLowerCase().includes(q) || String(work.workId || "").toLowerCase().includes(q) || String(work.projectId || "").toLowerCase().includes(q);
    return statusMatch && riskMatch && agentMatch && projectMatch && dateMatch && textMatch;
  });
  return `
    <div class="stack">
    <section class="card">
        <div class="section-title">${currentLanguage() === "en" ? "Tenant Work Gallery" : "Tenant Work Gallery"}</div>
        <div class="list mt-16">
          <div class="settings-grid">
            ${controlRole() === "super_admin" ? `
            <section class="card">
              <label class="settings-language-field"><span>${currentLanguage() === "en" ? "Filtro tenant" : "Filtro tenant"}</span>
                <select id="control-work-filter-tenant" class="sh-input mt-16">
                  <option value="">${currentLanguage() === "en" ? "Tutti i tenant" : "Tutti i tenant"}</option>
                  ${tenantOptions.map((tenant) => `<option value="${escapeHtml(String(tenant.tenantId || ""))}" ${String(filters.tenantId || "").trim() === String(tenant.tenantId || "").trim() ? "selected" : ""}>${escapeHtml(String(tenant.tenantName || tenant.tenantId || ""))}</option>`).join("")}
                </select>
              </label>
            </section>` : ""}
            <section class="card">
              <label class="settings-language-field"><span>Filtro stato</span>
                <select id="control-work-filter-status" class="sh-input mt-16">
                  <option value="">${currentLanguage() === "en" ? "Tutti" : "Tutti"}</option>
                  <option value="open" ${String(filters.status || "").toLowerCase() === "open" ? "selected" : ""}>Open</option>
                  <option value="in_progress" ${String(filters.status || "").toLowerCase() === "in_progress" ? "selected" : ""}>In progress</option>
                  <option value="blocked" ${String(filters.status || "").toLowerCase() === "blocked" ? "selected" : ""}>Blocked</option>
                  <option value="done" ${String(filters.status || "").toLowerCase() === "done" ? "selected" : ""}>Done</option>
                  <option value="completed" ${String(filters.status || "").toLowerCase() === "completed" ? "selected" : ""}>Completed</option>
                </select>
              </label>
            </section>
            <section class="card">
              <label class="settings-language-field"><span>${currentLanguage() === "en" ? "Filtro rischio" : "Filtro rischio"}</span>
                <select id="control-work-filter-risk" class="sh-input mt-16">
                  <option value="">${currentLanguage() === "en" ? "Tutti" : "Tutti"}</option>
                  <option value="alto" ${String(filters.risk || "").toLowerCase() === "alto" ? "selected" : ""}>alto</option>
                  <option value="medio" ${String(filters.risk || "").toLowerCase() === "medio" ? "selected" : ""}>medio</option>
                  <option value="basso" ${String(filters.risk || "").toLowerCase() === "basso" ? "selected" : ""}>basso</option>
                </select>
              </label>
            </section>
            <section class="card">
              <label class="settings-language-field"><span>${currentLanguage() === "en" ? "Agente" : "Agente"}</span>
                <input id="control-work-filter-agent" value="${escapeHtml(String(filters.agent || ""))}" class="sh-input mt-16" type="text" />
              </label>
            </section>
            <section class="card">
              <label class="settings-language-field"><span>${currentLanguage() === "en" ? "Progetto" : "Progetto"}</span>
                <input id="control-work-filter-project" value="${escapeHtml(String(filters.projectId || ""))}" class="sh-input mt-16" type="text" />
              </label>
            </section>
            <section class="card">
              <label class="settings-language-field"><span>${currentLanguage() === "en" ? "Data" : "Data"}</span>
                <input id="control-work-filter-date" value="${escapeHtml(String(filters.date || ""))}" class="sh-input mt-16" type="date" />
              </label>
            </section>
            <section class="card">
              <label class="settings-language-field"><span>Ricerca</span>
                <input id="control-work-filter-q" value="${escapeHtml(String(filters.q || ""))}" class="sh-input mt-16" type="text" placeholder="${currentLanguage() === "en" ? "work id, titolo, progetto" : "work id, titolo, progetto"}" />
              </label>
            </section>
          </div>
          <div class="action-row mt-16">
            <button class="sh-button" data-action="apply-control-work-filters" type="button">${currentLanguage() === "en" ? "Applica filtri" : "Applica filtri"}</button>
            <button class="sh-button secondary-btn" data-action="reset-control-work-filters" type="button">${currentLanguage() === "en" ? "Reset" : "Azzera"}</button>
          </div>
        </div>
      </section>
      <section class="card">
        <div class="section-title">${currentLanguage() === "en" ? "Lavori" : "Lavori"} (${escapeHtml(String(visibleRows.length))})</div>
        <div class="list mt-16">
          ${visibleRows.map((work) => `
            <div class="list-item">
              <div>
                <div class="item-title">${escapeHtml(String(work.title || work.workId || work.projectId || `Work ${work.id || ""}`))}</div>
                <div class="item-subtitle">Work ID: ${escapeHtml(controlWorkValue(work.workId || work.work_id))} · Project: ${escapeHtml(controlWorkValue(work.projectId || work.project_id))}</div>
                <div class="item-subtitle">${currentLanguage() === "en" ? "Status" : "Stato"}: ${escapeHtml(String(controlWorkValue(work.status, "—")))} · ${currentLanguage() === "en" ? "Priority" : "Priorità"}: ${escapeHtml(String(controlWorkValue(work.priority, "—")))} · ${currentLanguage() === "en" ? "Risk" : "Rischio"}: ${escapeHtml(String(controlWorkValue(work.riskLevel || work.risk || work.livelloRischio, "—")))}</div>
                <div class="item-subtitle">${currentLanguage() === "en" ? "Opened" : "Aperto"}: ${controlFormatDate(work.openedAt || work.data_apertura)} · ${currentLanguage() === "en" ? "Updated" : "Aggiornato"}: ${controlFormatDate(work.lastUpdatedAt || work.ultimoAggiornamento)}</div>
                <div class="item-subtitle">${currentLanguage() === "en" ? "Description" : "Descrizione breve"}: ${escapeHtml(controlWorkValue(work.description_brief || work.description, "—"))}</div>
                <div class="item-subtitle">${currentLanguage() === "en" ? "Tenant" : "Tenant"}: ${escapeHtml(controlWorkValue(work.tenantId, "—"))} · ${currentLanguage() === "en" ? "Owner" : "Owner"}: ${escapeHtml(controlWorkValue(work.owner, "—"))} · ${currentLanguage() === "en" ? "Request owner" : "Request owner"}: ${escapeHtml(controlWorkValue(work.requestOwner, "—"))}</div>
                <div class="item-subtitle">Sessioni presenti: ${escapeHtml(String(controlWorkValue(work.sessionsPresenti ?? work.sessionsPresent ?? work.sessionCount ?? 0, "0")))} · ${currentLanguage() === "en" ? "Agents" : "Agenti"}: ${escapeHtml(controlWorkListValue(work.agentsPresent || []))}</div>
                <div class="item-subtitle">${currentLanguage() === "en" ? "Branch aperti" : "Branch aperti"}: ${escapeHtml(controlWorkListValue(work.branchesOpen || work.branchOpen || []))} · Ready: ${escapeHtml(String(controlWorkValue(work.tasksReady, 0)))} · In progress: ${escapeHtml(String(controlWorkValue(work.tasksInProgress, 0)))} · Blocked: ${escapeHtml(String(controlWorkValue(work.tasksBlocked, 0)))} </div>
                <div class="item-subtitle">Lock: ${work.leaseLocked || work.lockActive ? (currentLanguage() === "en" ? "active" : "attivo") : (currentLanguage() === "en" ? "inactive" : "non attivo")} · ${currentLanguage() === "en" ? "Dependencies" : "Dipendenze"}: ${escapeHtml(controlWorkListValue(work.dependencies || []))}</div>
                <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Checkpoint" : "Checkpoint"}: ${work.checkpointAvailable ? (currentLanguage() === "en" ? "disponibile" : "disponibile") : (currentLanguage() === "en" ? "non disponibile" : "non disponibile")} · ${currentLanguage() === "en" ? "Handoff pending" : "Handoff pendenti"}: ${work.handoffPending ? (currentLanguage() === "en" ? "sì" : "sì") : (currentLanguage() === "en" ? "no" : "no")} · Regressioni: ${escapeHtml(String(controlWorkValue(work.regressionsDetected, 0)))} · ${currentLanguage() === "en" ? "Core verdict" : "Core verdict"}: ${escapeHtml(controlWorkValue(work.coreVerdict, "—"))} · ${currentLanguage() === "en" ? "Verification" : "Verifica"}: ${escapeHtml(controlWorkValue(work.verificationStatus || work.statoVerifica, "—"))}</div>
                <div class=\"item-subtitle\">Prossimo passo: ${escapeHtml(controlWorkValue(work.prossimoPasso || work.nextStep, "—"))}</div>
                <details class=\"mt-16\">
                  <summary>${currentLanguage() === "en" ? "Mostra dettagli" : "Mostra dettagli"}</summary>
                  <div class=\"mt-16 list-item\">
                    <div class=\"item-subtitle\">Artifact collegati: ${escapeHtml(controlWorkListValue(work.artifactCollegati || work.artifacts || work.artifactsLinked || []))}</div>
                    <div class=\"item-subtitle\">Artifacts count: ${escapeHtml(String(controlWorkValue(work.artifactsCount, Array.isArray(work.artifactCollegati || work.artifacts) ? (work.artifactCollegati || work.artifacts).length : 0))}</div>
                  </div>
                </details>
              </div>
              <button class="sh-button secondary-btn" data-action="open-control-work-detail" data-work-id="${escapeHtml(String(work.workId || ""))}" type="button">${currentLanguage() === "en" ? "Dettaglio" : "Dettaglio"}</button>
            </div>
          `).join("") || `<div class=\"settings-note\">${currentLanguage() === "en" ? "Nessun lavoro trovato." : "Nessun lavoro trovato."}</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderControlWorkDetail() {
  if (!state.control?.selectedWorkId) return controlNoData(currentLanguage() === "en" ? "Dettaglio lavoro" : "Dettaglio lavoro", currentLanguage() === "en" ? "Seleziona un lavoro dalla gallery." : "Seleziona un lavoro dalla gallery.");
  const work = state.control?.work || {};
  const timeline = Array.isArray(state.control?.workTimeline?.events) ? state.control.workTimeline.events : [];
  const workId = escapeHtml(controlWorkValue(work.workId || work.work_id || state.control.selectedWorkId, "—"));
  const tenantId = escapeHtml(controlWorkValue(work.tenantId, "—"));
  return `
    <div class="stack">
      <section class="card">
        <div class="row between mb-16">
          <div>
            <div class="section-title">${currentLanguage() === "en" ? "Work detail" : "Dettaglio lavoro"}</div>
            <div class="page-subtitle">${workId} · ${tenantId}</div>
          </div>
          <button class=\"sh-button secondary-btn\" data-view-link=\"control-work-gallery\" type=\"button\">${currentLanguage() === "en" ? "Torna alla gallery" : "Torna alla gallery"}</button>
        </div>
        <div class="list">
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Project ID" : "Project ID"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkValue(work.projectId || work.project_id))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Titolo" : "Titolo"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkValue(work.title))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Descrizione breve" : "Descrizione breve"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkValue(work.description_brief || work.description))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Stato" : "Stato"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkValue(work.status))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Priorità" : "Priorità"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkValue(work.priority))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Rischio" : "Rischio"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkValue(work.riskLevel || work.risk || work.livelloRischio))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Aperto" : "Aperto"}</div><div class=\"item-subtitle\">${controlFormatDate(work.openedAt || work.data_apertura)}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Ultimo aggiornamento" : "Ultimo aggiornamento"}</div><div class=\"item-subtitle\">${controlFormatDate(work.lastUpdatedAt || work.ultimoAggiornamento)}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Sessioni presenti" : "Sessioni presenti"}</div><div class=\"item-subtitle\">${escapeHtml(String(controlWorkValue(work.sessionsPresenti ?? work.sessionsPresent ?? work.sessionCount ?? 0, "0")))} ${currentLanguage() === "en" ? "sessioni" : "sessioni"}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Agenti presenti" : "Agenti presenti"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkListValue(work.agentsPresent || []))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Branch aperti" : "Branch aperti"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkListValue(work.branchesOpen || work.branchOpen || []))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Task pronti" : "Task pronti"}</div><div class=\"item-subtitle\">${escapeHtml(String(controlWorkValue(work.tasksReady, 0)))} · ${currentLanguage() === "en" ? "In corso" : "In corso"}: ${escapeHtml(String(controlWorkValue(work.tasksInProgress, 0)))} · ${currentLanguage() === "en" ? "Bloccati" : "Bloccati"}: ${escapeHtml(String(controlWorkValue(work.tasksBlocked, 0)))} </div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Lease/lock attivi" : "Lease/lock attivi"}</div><div class=\"item-subtitle\">${controlWorkValue(work.leaseLocked || work.lockActive ? (currentLanguage() === "en" ? "active" : "attivo") : (currentLanguage() === "en" ? "inactive" : "non attivo"), "—")}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Dipendenze" : "Dipendenze"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkListValue(work.dependencies || []))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Checkpoint disponibile" : "Checkpoint disponibile"}</div><div class=\"item-subtitle\">${controlWorkValue(work.checkpointAvailable ? "disponibile" : "non disponibile", "—")}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Handoff pendenti" : "Handoff pendenti"}</div><div class=\"item-subtitle\">${controlWorkValue(work.handoffPending ? "sì" : "no", "—")}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Artifact collegati" : "Artifact collegati"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkListValue(work.artifactCollegati || work.artifacts || []))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Regressioni rilevate" : "Regressioni rilevate"}</div><div class=\"item-subtitle\">${escapeHtml(String(controlWorkValue(work.regressionsDetected, 0))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Prossimo passo" : "Prossimo passo"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkValue(work.prossimoPasso || work.nextStep))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Owner / request owner" : "Owner / request owner"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkValue(work.owner))} / ${escapeHtml(controlWorkValue(work.requestOwner))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Core verdict" : "Core verdict"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkValue(work.coreVerdict))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === "en" ? "Stato verifica" : "Stato verifica"}</div><div class=\"item-subtitle\">${escapeHtml(controlWorkValue(work.verificationStatus || work.statoVerifica))}</div></div>
        </div>
      </section>
      <section class=\"card\">
        <div class=\"section-title\">${currentLanguage() === "en" ? "Timeline operativa" : "Timeline operativa"}</div>
        <div class=\"list mt-16\">
          ${timeline.length ? timeline.map((event) => `
            <div class=\"list-item\">
              <div class=\"item-title\">${controlFormatDate(event.timestamp)} · ${escapeHtml(controlWorkValue(event.actor, "system"))} · ${escapeHtml(controlWorkValue(event.event, "—"))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Branch" : "Branch"}: ${escapeHtml(controlWorkValue(event.branch, "—"))} · ${currentLanguage() === "en" ? "Esito" : "Esito"}: ${escapeHtml(controlWorkValue(event.outcome, "—"))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Evidence" : "Evidenza"}: ${escapeHtml(controlWorkValue(event.evidence, "—"))} · ${currentLanguage() === "en" ? "Decisione Core" : "Decisione Core"}: ${escapeHtml(controlWorkValue(event.coreDecision, "—"))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Tenant" : "Tenant"}: ${escapeHtml(controlWorkValue(event.tenantId || event.tenant, "—"))} · ${currentLanguage() === "en" ? "Work ID" : "Work ID"}: ${escapeHtml(controlWorkValue(event.workId || event.work_id, "—"))} · ${currentLanguage() === "en" ? "Sessione" : "Sessione"}: ${escapeHtml(controlWorkValue(event.sessionIdSanitized || event.sessionId, "—"))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Richiesta conferma owner" : "Richiesta conferma owner"}: ${controlWorkValue(event.confirmationRequested ? "richiesta" : "non richiesta", "—")} · ${currentLanguage() === "en" ? "Rollback/next action" : "Rollback/next action"}: ${escapeHtml(controlWorkValue(event.rollbackOrNextAction || event.nextAction, "—"))}</div>
            </div>
          `).join("") : `<div class=\"settings-note\">${currentLanguage() === "en" ? "Nessun evento timeline." : "Nessun evento timeline."}</div>`}
        </div>
      </section>
      <section class="card">
        <div class="section-title">${currentLanguage() === "en" ? "Nota" : "Nota"}</div>
        <div class="settings-note">Read-only</div>
      </section>
    </div>
  `;
}

function renderControlAgents() {
  const rows = controlListRows(state.control?.agents || {});
  return `
    <div class=\"stack\">
      <section class=\"card\">
        <div class=\"section-title\">${currentLanguage() === \"en\" ? \"Agenti\" : \"Agenti\"}</div>
        <div class=\"list mt-16\">
          ${rows.map((agent) => `
            <div class=\"list-item\">
              <div class=\"item-title\">${escapeHtml(agent.username || agent.fullName || agent.agentId || "—")}</div>
              <div class=\"item-subtitle\">${escapeHtml(String(agent.tenantId || ""))} · ${escapeHtml(String(agent.role || ""))} · ${escapeHtml(String(agent.status || ""))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Risk" : "Rischio"}: ${escapeHtml(String(agent.risk || "—"))} · ${currentLanguage() === "en" ? "Task aperte" : "Task aperte"}: ${escapeHtml(String(agent.tasksOpen || 0))} · ${currentLanguage() === "en" ? "Task bloccate" : "Task bloccate"}: ${escapeHtml(String(agent.tasksLocked || 0))}</div>
            </div>
          `).join("") || `<div class=\"settings-note\">${currentLanguage() === "en" ? "Nessun agente caricato." : "Nessun agente caricato."}</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderControlBranches() {
  const rows = controlListRows(state.control?.branches || {});
  return `
    <div class=\"stack\">
      <section class=\"card\">
        <div class=\"section-title\">${currentLanguage() === \"en\" ? \"Rami & flussi\" : \"Rami & flussi\"}</div>
        <div class=\"list mt-16\">
          ${rows.map((branch) => `
            <div class=\"list-item\">
              <div class=\"item-title\">${escapeHtml(branch.branchName || branch.branchId || "—")}</div>
              <div class=\"item-subtitle\">${currentLanguage() === \"en\" ? \"Tenant\" : \"Tenant\"}: ${escapeHtml(String(branch.tenantId || ""))} · ${escapeHtml(String(branch.status || ""))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === \"en\" ? \"Aperti\" : \"Aperti\"}: ${escapeHtml(String(branch.openJobs || 0))} · ${currentLanguage() === \"en\" ? \"Work collegati\" : \"Lavori\"}: ${escapeHtml(String(branch.linkedWork || 0))}</div>
            </div>
          `).join("") || `<div class=\"settings-note\">${currentLanguage() === "en" ? "Nessun ramo disponibile." : "Nessun ramo disponibile."}</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderControlKeys() {
  const rows = controlListRows(state.control?.keys?.keys || state.control?.keys || {});
  return `
    <div class=\"stack\">
      <section class=\"card\">
        <div class=\"section-title\">${currentLanguage() === \"en\" ? \"Chiavi (metadati)\" : \"Chiavi (metadati)\"}</div>
        <div class=\"list mt-16\">
          ${rows.map((key) => `
            <div class=\"list-item\">
              <div class=\"item-title\">${escapeHtml(String(key.provider || ""))} · ${escapeHtml(String(key.type || ""))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Tenant" : "Tenant"}: ${escapeHtml(String(key.tenantId || key.tenantName || ""))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Configurata" : "Configurata"}: ${escapeHtml(String(key.configured))} · ${currentLanguage() === "en" ? "Masked ID" : "ID mascherato"}: ${escapeHtml(String(key.maskedId || ""))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Ultima verifica" : "Ultima verifica"}: ${controlFormatDate(key.lastCheck)}</div>
            </div>
          `).join("") || `<div class=\"settings-note\">${currentLanguage() === "en" ? "Nessuna chiave disponibile." : "Nessuna chiave disponibile."}</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderControlAudit() {
  const rows = controlListRows(state.control?.audit || {});
  return `
    <div class=\"stack\">
      <section class=\"card\">
        <div class=\"section-title\">${currentLanguage() === \"en\" ? \"Audit trail\" : \"Audit trail\"}</div>
        <div class=\"list mt-16\">
          ${rows.map((event) => `
            <div class=\"list-item\">
              <div class=\"item-title\">${escapeHtml(event.eventId || event.id || "event")}</div>
              <div class=\"item-subtitle\">${controlFormatDate(event.ts)} · ${escapeHtml(String(event.action || ""))} · ${escapeHtml(String(event.outcome || ""))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Tenant" : "Tenant"}: ${escapeHtml(String(event.tenantId || ""))} · ${currentLanguage() === "en" ? "Actor" : "Utente"}: ${escapeHtml(event.actor?.username || event.actor?.user || "")}</div>
              <div class=\"item-subtitle\">${escapeHtml(String(event.reason || ""))}</div>
            </div>
          `).join("") || `<div class=\"settings-note\">${currentLanguage() === "en" ? "Nessun evento audit." : "Nessun evento audit."}</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderControlDecisionLedger() {
  const rows = controlListRows(state.control?.decisionLedger || {});
  return `
    <div class=\"stack\">
      <section class=\"card\">
        <div class=\"section-title\">${currentLanguage() === \"en\" ? \"Decision Ledger\" : \"Decision Ledger\"}</div>
        <div class=\"list mt-16\">
          ${rows.map((row) => `
            <div class=\"list-item\">
              <div class=\"item-title\">${escapeHtml(String(row.decisionId || row.id || row.workId || "decision"))}</div>
              <div class=\"item-subtitle\">${escapeHtml(String(row.coreVerdict || ""))} · ${currentLanguage() === "en" ? "Owner requested" : "Owner richiesto"}: ${row.ownerRequested ? "yes" : "no"}</div>
              <div class=\"item-subtitle\">${escapeHtml(String(row.nextAction || ""))}</div>
              <div class=\"item-subtitle\">${controlFormatDate(row.createdAt)}</div>
            </div>
          `).join("") || `<div class=\"settings-note\">${currentLanguage() === "en" ? "Nessuna decisione trovata." : "Nessuna decisione trovata."}</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderControlMemory() {
  const rows = controlListRows(state.control?.memory || {});
  return `
    <div class=\"stack\">
      <section class=\"card\">
        <div class=\"section-title\">${currentLanguage() === \"en\" ? \"Memoria\" : \"Memoria\"}</div>
        <div class=\"list mt-16\">
          ${rows.map((row) => `
            <div class=\"list-item\">
              <div class=\"item-title\">${escapeHtml(String(row.tenantName || row.tenantId || ""))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "State" : "Stato"}: ${escapeHtml(String(row.memoryState || ""))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Docs" : "Docs"}: ${escapeHtml(String(row.memoryCloudDocs || 0))} · ${currentLanguage() === "en" ? "Artifacts" : "Artifact"}: ${escapeHtml(String(row.artifactsIndexed || 0))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Decision entries" : "Decision entries"}: ${escapeHtml(String(row.decisionEntries || 0))} · ${currentLanguage() === "en" ? "Last snapshot" : "Ultimo snapshot"}: ${controlFormatDate(row.lastSnapshotAt)}</div>
            </div>
          `).join("") || `<div class=\"settings-note\">${currentLanguage() === "en" ? \"Nessun dato memoria.\" : \"Nessun dato memoria.\"}</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderControlConnectors() {
  const connectors = state.control?.connectors || {};
  const rows = Array.isArray(connectors?.tenants) ? connectors.tenants : [];
  const summary = Array.isArray(rows) ? rows.length : 0;
  return `
    <div class=\"stack\">
      <section class=\"card\">
        <div class=\"section-title\">${currentLanguage() === \"en\" ? \"Connectors\" : \"Connectors\"}</div>
        <div class=\"settings-note\">${currentLanguage() === \"en\" ? `Tenants: ${summary}` : `Tenant: ${summary}`}</div>
        <div class=\"list mt-16\">
          ${rows.map((tenant) => `
            <div class=\"list-item\">
              <div class=\"item-title\">${escapeHtml(String(tenant.tenantName || tenant.tenantId || ""))}</div>
              <div class=\"item-subtitle\">${Array.isArray(tenant.list) ? tenant.list.map((item) => `${item.name}: ${item.state}`).join(" · ") : ""}</div>
            </div>
          `).join("") || `<div class=\"settings-note\">${currentLanguage() === "en" ? "Nessun connettore disponibile." : "Nessun connettore disponibile."}</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderControlGovernance() {
  const governance = state.control?.governance || {};
  const rows = Array.isArray(governance.tenantRows) ? governance.tenantRows : [];
  const blockers = Array.isArray(governance.blockers) ? governance.blockers : [];
  return `
    <div class=\"stack\">
      <section class=\"card\">
        <div class=\"section-title\">${currentLanguage() === \"en\" ? \"Governance & Blockers\" : \"Governance & Blockers\"}</div>
        <div class=\"settings-grid\">
          <section class=\"card\">
            <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === \"en\" ? \"Stato governance\" : \"Stato governance\"}</div><div class=\"item-subtitle\">${escapeHtml(String(governance.state || "DEGRADED"))}</div></div>
            <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === \"en\" ? \"Tenant monitorati\" : \"Tenant monitorati\"}</div><div class=\"item-subtitle\">${escapeHtml(String(governance.tenantCount || rows.length || 0))}</div></div>
            <div class=\"list-item\"><div class=\"item-title\">${currentLanguage() === \"en\" ? \"Aggiornato\" : \"Aggiornato\"}</div><div class=\"item-subtitle\">${controlFormatDate(governance.updatedAt)}</div></div>
          </section>
        </div>
        <div class=\"list mt-16\">
          ${rows.map((row) => `
            <div class=\"list-item\">
              <div class=\"item-title\">${escapeHtml(String(row.tenantName || row.tenantId || ""))}</div>
              <div class=\"item-subtitle\">${currentLanguage() === "en" ? "Denied" : "Denied"}: ${escapeHtml(String(row.deniedActions || 0))} · ${currentLanguage() === "en" ? "Failed" : "Failed"}: ${escapeHtml(String(row.failedActions || 0))} · ${currentLanguage() === "en" ? "Last hour" : "Ultima ora"}: ${escapeHtml(String(row.actionsLastHour || 0))}</div>
              ${Array.isArray(row.blockers) ? `<div class=\"item-subtitle\">${row.blockers.map((item) => escapeHtml(item)).join(" · ")}</div>` : ""}
            </div>
          `).join("") || `<div class=\"settings-note\">${currentLanguage() === "en" ? "Nessun blocker." : "Nessun blocker."}</div>`}
        </div>
        <section class=\"card mt-16\">
          <div class=\"section-title\">${currentLanguage() === \"en\" ? \"Blocker globali\" : \"Blocker globali\"}</div>
          <div class=\"list mt-16\">${blockers.map((item) => `<div class=\"list-item\"><div class=\"item-title\">${escapeHtml(item)}</div></div>`).join("") || `<div class=\"settings-note\">${currentLanguage() === \"en\" ? \"Nessun blocker attivo.\" : \"Nessun blocker attivo.\"}</div>`}</div>
        </section>
      </section>
    </div>
  `;
}

function renderControlDemo() {
  const demo = state.control?.demo || {};
  const role = String(demo.role || controlRole());
  const tenantName = String(demo.tenant?.tenantName || "");
  const tenantId = String(demo.tenant?.tenantId || "");
  const coreHealth = String(demo.coreHealth?.state || "UNKNOWN");
  const nyraRuntime = String(demo.nyraRuntime?.state || "UNKNOWN");
  const memoryCloudDocs = Number(demo.memoryCloud?.docs ? demo.memoryCloud.docs : demo.memoryCloud?.size || 0);
  const memoryCloudSize = Number(demo.memoryCloud?.size || 0);
  const hostNative = demo.hostNativeGovernance || {};
  const githubState = String(demo.githubCredentialState?.state || "UNKNOWN");
  const renderState = String(demo.renderResolverState?.state || "UNKNOWN");
  const workGallery = demo.workGallery || {};
  const workTotal = Number(workGallery.total || 0);
  const decisionLedger = demo.decisionLedger || {};
  const ledgerPeriod = Number(decisionLedger.periodDays || 0);
  const ledgerTotal = Number(decisionLedger.total || 0);
  return `
    <div class=\"stack\">
      <section class=\"card\">
        <div class=\"section-title\">${currentLanguage() === \"en\" ? \"Agent Workspace Demo\" : \"Agent Workspace Demo\"}</div>
        <div class=\"row between mb-16\">
          <div class=\"list\">
            <div class=\"list-item\"><div class=\"item-title\">Role</div><div class=\"item-subtitle\">${escapeHtml(role)}</div></div>
            <div class=\"list-item\"><div class=\"item-title\">Tenant</div><div class=\"item-subtitle\">${escapeHtml(tenantName)}${tenantId ? ` (${escapeHtml(tenantId)})` : ""}</div></div>
            <div class=\"list-item\"><div class=\"item-title\">Risk action</div><div class=\"item-subtitle\">${escapeHtml(String(demo.riskyAction || ""))}</div></div>
          </div>
        </div>
        <div class=\"list mt-16\">
          <div class=\"list-item\"><div class=\"item-title\">Core health</div><div class=\"item-subtitle\">${escapeHtml(coreHealth)}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">Nyra runtime</div><div class=\"item-subtitle\">${escapeHtml(nyraRuntime)}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">Memory cloud</div><div class=\"item-subtitle\">${escapeHtml(String(memoryCloudDocs))} docs · size ${escapeHtml(String(memoryCloudSize))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">Host-native governance</div><div class=\"item-subtitle\">${escapeHtml(String(hostNative.blocker || "ok"))} · schemaWrapperRequired=${hostNative.schemaWrapperRequired ? "true" : "false"}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">Github resolver</div><div class=\"item-subtitle\">${escapeHtml(githubState)} ${demo.githubCredentialState?.active ? "· active" : "· inactive"}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">Render resolver</div><div class=\"item-subtitle\">${escapeHtml(renderState)} ${demo.renderResolverState?.active ? "· active" : "· inactive"}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">Work Gallery</div><div class=\"item-subtitle\">${escapeHtml(String(workTotal))} work item</div></div>
          <div class=\"list-item\"><div class=\"item-title\">Decision Ledger</div><div class=\"item-subtitle\">${escapeHtml(String(ledgerTotal))} decision in ${escapeHtml(String(ledgerPeriod))} giorni</div></div>
          <div class=\"list-item\"><div class=\"item-title\">Verdict</div><div class=\"item-subtitle\">execution_allowed=${demo.verdict?.execution_allowed ? "true" : "false"} · owner_confirmation_required=${demo.verdict?.owner_confirmation_required ? "true" : "false"} · core_verdict_required=${demo.verdict?.core_verdict_required ? "true" : "false"} · audit_required=${demo.verdict?.audit_required ? "true" : "false"}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">Explanation</div><div class=\"item-subtitle\">${escapeHtml(String(demo.explanationIT || ""))}</div></div>
          <div class=\"list-item\"><div class=\"item-title\">Next actions</div><div class=\"item-subtitle\">${Array.isArray(demo.nextActions) ? demo.nextActions.map((item) => escapeHtml(item)).join(\" · \") : ""}</div></div>
        </div>
      </section>
      ${Array.isArray(workGallery.items) && workGallery.items.length ? `
        <section class=\"card mt-16\">
          <div class=\"section-title\">${currentLanguage() === \"en\" ? \"Work Gallery sample\" : \"Work Gallery sample\"}</div>
          <div class=\"list mt-16\">
            ${workGallery.items.map((item) => `
              <div class=\"list-item\">
                <div class=\"item-title\">${escapeHtml(String(item.workId || ""))}</div>
                <div class=\"item-subtitle\">${escapeHtml(String(item.title || ""))} · ${escapeHtml(String(item.status || "—"))} · ${escapeHtml(String(item.tenantId || ""))}</div>
              </div>
            `).join("")}
          </div>
        </section>
      ` : ""}
      ${Array.isArray(decisionLedger.items) && decisionLedger.items.length ? `
        <section class=\"card mt-16\">
          <div class=\"section-title\">${currentLanguage() === \"en\" ? \"Decision ledger sample\" : \"Decision ledger sample\"}</div>
          <div class=\"list mt-16\">
            ${decisionLedger.items.slice(0, 6).map((item) => `
              <div class=\"list-item\">
                <div class=\"item-title\">${escapeHtml(String(item.workId || item.decisionId || ""))}</div>
                <div class=\"item-subtitle\">${escapeHtml(String(item.coreVerdict || ""))} · ${escapeHtml(String(item.tenantId || ""))}</div>
              </div>
            `).join("")}
          </div>
        </section>
      ` : ""}
    </div>
  `;
}

function renderControlSuperAdmin() {
  if (controlRole() !== "super_admin") {
    return controlNoData("Super Admin settings", "Pagina riservata al profilo super admin.");
  }
  const summary = state.control?.superAdminSettings || {};
  return `
    <div class=\"stack\">
      <section class=\"card\">
        <div class=\"section-title\">Super Admin settings</div>
        <div class=\"settings-note\">${currentLanguage() === "en" ? "Area amministrativa riservata: accesso globale e audit di supervisione." : "Area amministrativa riservata: accesso globale e audit di supervisione."}</div>
      </section>
      <section class=\"card\">
        <div class=\"section-title\">Tenants registrati</div>
        <div class=\"list mt-16\">
          ${controlListRows(summary).map((tenant) => `
            <div class=\"list-item\">
              <div class=\"item-title\">${escapeHtml(String(tenant.tenantName || tenant.name || tenant.tenantId || ""))}</div>
              <div class=\"item-subtitle\">${escapeHtml(String(tenant.tenantId || ""))} ${tenant.active ? "· active" : "· inactive"}</div>
            </div>
          `).join("") || `<div class=\"settings-note\">Nessun tenant.</div>`}
        </div>
      </section>
    </div>
  `;
}

function agendaHours() {
  const result = [];
  for (let hour = 8; hour <= 20; hour += 1) {
    result.push(`${String(hour).padStart(2, "0")}:00`);
  }
  return result;
}

function appointmentStyle(item) {
  const startMinutes = Number(item.time.split(":")[0]) * 60 + Number(item.time.split(":")[1]);
  const baseMinutes = 8 * 60;
  const top = Math.max(0, startMinutes - baseMinutes) * 1.3;
  const height = Math.max(56, Number(item.duration || 45) * 1.3);
  return `top:${top}px;height:${height}px;`;
}

function appointmentColor(item) {
  const service = state.services.find((entry) => entry.name === item.service || entry.id === item.serviceId);
  const category = service?.category || "";
  if (category.includes("hair")) return "rgba(190, 232, 244, 0.82)";
  if (category.includes("beauty")) return "rgba(247, 213, 228, 0.78)";
  if (category.includes("barber")) return "rgba(248, 220, 194, 0.82)";
  return "rgba(231, 216, 246, 0.76)";
}

function appointmentStatusLabel(status) {
  const normalized = String(status || "confirmed").toLowerCase();
  const statusMap = {
    confirmed: t("agendaView.statusConfirmed"),
    arrived: t("agendaView.statusArrived"),
    ready_checkout: t("agendaView.statusReadyCheckout"),
    completed: t("agendaView.statusCompleted"),
    cancelled: t("agendaView.statusCancelled"),
    no_show: t("agendaView.statusNoShow")
  };
  return statusMap[normalized] || statusMap.confirmed;
}

function findClientForAppointment(appointment) {
  return state.clients.find((entry) => entry.id === appointment.clientId || entry.name === appointment.client) || null;
}

function countOperatorAppointmentsForDay(operatorName, date) {
  return state.appointments.filter((item) => item.date === date && item.operator === operatorName).length;
}

async function updateAppointment(id, patch, feedbackKey = "feedback.appointmentUpdated") {
  const current = state.appointments.find((item) => item.id === id);
  if (!current) return;
  await safeJsonFetch(`${API_SERVER_URL}/api/appointments/${id}`, `/api/appointments/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...current,
      ...patch
    })
  });
  state.selectedAppointmentId = id;
  await refreshForUserEvent("appointment");
  renderView();
  showFeedback(t(feedbackKey));
}

async function moveAppointment(id) {
  const appointment = state.appointments.find((item) => item.id === id);
  if (!appointment) return;
  const nextValue = window.prompt(t("agendaView.movePrompt"), `${appointment.date} ${appointment.time}`);
  if (!nextValue) return;
  const normalized = String(nextValue).trim().replace("T", " ");
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
  if (!match) {
    showFeedback(t("agendaView.moveInvalid"));
    return;
  }
  const [, date, time] = match;
  await updateAppointment(id, { date, time }, "feedback.appointmentMoved");
}

async function checkoutAppointment(id) {
  const appointment = state.appointments.find((item) => item.id === id);
  if (!appointment) return;
  const service = state.services.find((entry) => entry.name === appointment.service || entry.id === appointment.serviceId);
  const suggestedAmount = service?.price ? String(service.price) : "";
  const amountRaw = window.prompt(t("agendaView.checkoutAmountPrompt"), suggestedAmount);
  if (!amountRaw) return;
  const amount = Number(String(amountRaw).replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) {
    showFeedback(t("agendaView.checkoutInvalidAmount"));
    return;
  }
  const methodRaw = window.prompt(t("agendaView.checkoutMethodPrompt"), "card");
  if (!methodRaw) return;
  const method = String(methodRaw).trim().toLowerCase();
  await safeJsonFetch("/api/sales", null, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: appointment.date,
      service: appointment.service,
      amount,
      channel: method,
      client: appointment.client
    })
  });
  await updateAppointment(id, { status: "completed" }, "feedback.paymentSaved");
}

async function addTechnicalNoteToAppointment(id) {
  const appointment = state.appointments.find((item) => item.id === id);
  if (!appointment) return;
  const nextNote = window.prompt(t("agendaView.technicalNotePrompt"), appointment.notes || "");
  if (nextNote === null) return;
  await updateAppointment(id, { notes: String(nextNote).trim() });
}

function currentAgendaAppointments() {
  return state.appointments
    .filter((item) => String(item.status || "").toLowerCase() !== "deleted")
    .filter((item) => item.date === state.agendaDate)
    .sort((a, b) => a.time.localeCompare(b.time));
}

function renderAgendaMobile(staff, hours, appointments) {
  return `
    <div class="agenda-mobile">
      ${staff.map((operator) => {
        const operatorAppointments = appointments.filter((item) => item.operator === operator.name);
        return `
          <section class="card agenda-mobile-day">
            <div class="row between mb-16">
              <div>
                <div class="section-title">${escapeHtml(operator.name)}</div>
                <div class="page-subtitle">${escapeHtml(operator.role)}</div>
              </div>
              <button class="sh-button secondary-btn" data-action="select-slot" data-time="09:00" data-operator="${escapeHtml(operator.name)}" type="button">${t("agendaView.newSession")}</button>
            </div>
            <div class="list agenda-mobile-list">
              ${operatorAppointments.map((item) => `
                <button class="list-item agenda-mobile-event ${state.selectedAppointmentId === item.id ? "active" : ""}" data-action="select-appointment" data-id="${escapeHtml(item.id)}" type="button">
                  <div class="row between gap-8">
                    <div>
                      <div class="item-title">${escapeHtml(item.time)} · ${escapeHtml(item.client)}</div>
                      <div class="item-subtitle">${escapeHtml(item.service)} · ${escapeHtml(item.room || t("agendaView.roomFallback"))}</div>
                    </div>
                    <div class="compact-stack">
                      <span class="module-pill active">${escapeHtml(String(item.duration || 45))} min</span>
                      <span class="item-subtitle">${escapeHtml(appointmentStatusLabel(item.status))}</span>
                    </div>
                  </div>
                </button>
              `).join("") || `<div class="settings-note">${t("agendaView.noAssignedAppointments")}</div>`}
            </div>
            <div class="agenda-mobile-slots mt-16">
              ${hours.map((hour) => `
                <button
                  class="agenda-mobile-slot ${state.selectedSlot?.time === hour && state.selectedSlot?.operator === operator.name ? "active" : ""}"
                  data-action="select-slot"
                  data-time="${hour}"
                  data-operator="${escapeHtml(operator.name)}"
                  type="button"
                >
                  ${escapeHtml(hour)}
                </button>
              `).join("")}
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function renderAppointmentDrawer() {
  const appointment = state.appointments.find((item) => item.id === state.selectedAppointmentId) || null;
  if (!appointment && !state.selectedSlot) {
    return `
      <section class="card drawer-card">
        <div class="section-title">${t("agendaView.quickPanel")}</div>
        <div class="settings-note mt-16">${t("agendaView.quickPanelCopy")}</div>
      </section>
    `;
  }

  if (state.selectedSlot && !appointment) {
    const selectedOperatorLoad = countOperatorAppointmentsForDay(state.selectedSlot.operator, state.agendaDate);
    return `
      <section class="card drawer-card">
        <div class="section-title">${t("agendaView.quickEntry")}</div>
        <div class="drawer-stats mt-16">
          <div class="consultation-box"><div class="stat-label">${t("agendaView.date")}</div><div>${escapeHtml(state.agendaDate)}</div></div>
          <div class="consultation-box"><div class="stat-label">${t("agendaView.time")}</div><div>${escapeHtml(state.selectedSlot.time)}</div></div>
        </div>
        <div class="drawer-stats mt-16">
          <div class="consultation-box"><div class="stat-label">${t("agendaView.operator")}</div><div>${escapeHtml(state.selectedSlot.operator)}</div></div>
          <div class="consultation-box"><div class="stat-label">${t("agendaView.operatorLoad")}</div><div>${escapeHtml(String(selectedOperatorLoad))}</div></div>
        </div>
        <div class="consultation-box mt-16">
          <div class="stat-label">${t("agendaView.quickContext")}</div>
          <div>${escapeHtml(state.selectedSlot.operator)} · ${escapeHtml(state.selectedSlot.time)} · ${escapeHtml(state.agendaDate)}</div>
        </div>
        <div class="action-row mt-16">
          <button class="sh-button" data-action="new-appointment-slot" type="button">${t("agendaView.newSession")}</button>
          <button class="sh-button secondary-btn" data-action="new-client-from-slot" type="button">${t("agendaView.newClient")}</button>
          <button class="sh-button secondary-btn" data-action="clear-agenda-selection" type="button">${t("agendaView.close")}</button>
        </div>
      </section>
    `;
  }

  const client = findClientForAppointment(appointment);
  const activeTab = state.agendaDrawerTab || "appointment";
  const appointmentView = `
    <div class="compact-stack">
      <div class="consultation-box">
        <div class="stat-label">${t("agendaView.client")}</div>
        <div class="item-title">${escapeHtml(appointment.client)}</div>
        <div class="item-subtitle">${escapeHtml(appointment.service)} · ${escapeHtml(appointment.operator)}</div>
      </div>
      <div class="drawer-stats">
        <div class="consultation-box"><div class="stat-label">${t("agendaView.date")}</div><div>${escapeHtml(appointment.date)}</div></div>
        <div class="consultation-box"><div class="stat-label">${t("agendaView.schedule")}</div><div>${escapeHtml(appointment.time)}</div></div>
      </div>
      <div class="drawer-stats">
        <div class="consultation-box"><div class="stat-label">${t("agendaView.duration")}</div><div>${escapeHtml(String(appointment.duration || 45))} min</div></div>
        <div class="consultation-box"><div class="stat-label">${t("agendaView.status")}</div><div>${escapeHtml(appointmentStatusLabel(appointment.status))}</div></div>
      </div>
      <div class="drawer-stats">
        <div class="consultation-box"><div class="stat-label">${t("agendaView.operator")}</div><div>${escapeHtml(appointment.operator)}</div></div>
        <div class="consultation-box"><div class="stat-label">${t("agendaView.room")}</div><div>${escapeHtml(appointment.room || t("agendaView.roomFallback"))}</div></div>
      </div>
      <div class="consultation-box">
        <div class="stat-label">${t("agendaView.notes")}</div>
        <div>${escapeHtml(appointment.notes || t("agendaView.noNotes"))}</div>
      </div>
    </div>
  `;
  const clientView = `
    <div class="compact-stack">
      <div class="consultation-box">
        <div class="stat-label">${t("agendaView.clientFocusTitle")}</div>
        <div class="item-title">${escapeHtml(client?.name || appointment.client)}</div>
        <div class="item-subtitle">${t("agendaView.clientFocusCopy")}</div>
      </div>
      <div class="consultation-box">
        <div class="stat-label">${t("agendaView.contacts")}</div>
        <div>${escapeHtml(client?.phone || t("agendaView.noPhone"))}</div>
        <div class="item-subtitle">${escapeHtml(client?.email || t("agendaView.noEmail"))}</div>
      </div>
      <div class="drawer-stats">
        <div class="consultation-box"><div class="stat-label">${t("agendaView.lastVisit")}</div><div>${escapeHtml(client?.lastVisit || t("agendaView.noLastVisit"))}</div></div>
        <div class="consultation-box"><div class="stat-label">${t("agendaView.activePlans")}</div><div>${escapeHtml(client?.activePlans?.join(", ") || t("agendaView.noActivePlans"))}</div></div>
      </div>
      <div class="consultation-box">
        <div class="stat-label">${t("agendaView.preferences")}</div>
        <div>${escapeHtml(client?.preferences?.join(", ") || t("agendaView.noPreferences"))}</div>
      </div>
      <div class="consultation-box">
        <div class="stat-label">${t("agendaView.notes")}</div>
        <div>${escapeHtml(client?.notes || t("agendaView.noNotes"))}</div>
      </div>
    </div>
  `;
  const actionsView = `
    <div class="compact-stack">
      <div class="action-row">
        <button class="sh-button" data-action="mark-arrived" data-id="${escapeHtml(appointment.id)}" type="button">${t("agendaView.markArrived")}</button>
        <button class="sh-button secondary-btn" data-action="checkout-appointment" data-id="${escapeHtml(appointment.id)}" type="button">${t("agendaView.openCash")}</button>
      </div>
      <div class="action-row">
        <button class="sh-button secondary-btn" data-action="mark-completed" data-id="${escapeHtml(appointment.id)}" type="button">${t("agendaView.markCompleted")}</button>
        <button class="sh-button secondary-btn" data-action="move-appointment" data-id="${escapeHtml(appointment.id)}" type="button">${t("agendaView.moveSession")}</button>
      </div>
      <div class="action-row">
        <button class="sh-button secondary-btn" data-action="add-technical-note" data-id="${escapeHtml(appointment.id)}" type="button">${t("agendaView.technicalNote")}</button>
        <button class="sh-button secondary-btn" data-action="mark-no-show" data-id="${escapeHtml(appointment.id)}" type="button">${t("agendaView.markNoShow")}</button>
        <button class="sh-button secondary-btn" data-action="cancel-appointment" data-id="${escapeHtml(appointment.id)}" type="button">${t("agendaView.cancelSession")}</button>
      </div>
      <div class="action-row">
        <button class="sh-button secondary-btn" data-action="open-client-detail" data-client-id="${escapeHtml(client?.id || "")}" type="button">${t("agendaView.openFile")}</button>
        <button class="sh-button secondary-btn" data-action="delete-appointment" data-id="${escapeHtml(appointment.id)}" type="button">${t("agendaView.delete")}</button>
      </div>
    </div>
  `;
  const content = activeTab === "client" ? clientView : activeTab === "actions" ? actionsView : appointmentView;
  return `
    <section class="card drawer-card">
      <div class="row between mb-16">
        <div class="section-title">${t("agendaView.clientDrawer")}</div>
        <button class="sh-button secondary-btn" data-action="clear-agenda-selection" type="button">${t("agendaView.close")}</button>
      </div>
      <div class="drawer-tabs">
        <button class="drawer-tab ${activeTab === "appointment" ? "active" : ""}" data-action="set-agenda-tab" data-tab="appointment" type="button">${t("agendaView.appointment")}</button>
        <button class="drawer-tab ${activeTab === "client" ? "active" : ""}" data-action="set-agenda-tab" data-tab="client" type="button">${t("agendaView.client")}</button>
        <button class="drawer-tab ${activeTab === "actions" ? "active" : ""}" data-action="set-agenda-tab" data-tab="actions" type="button">${t("agendaView.actions")}</button>
      </div>
      ${content}
    </section>
  `;
}

function renderAgenda() {
  return renderAgendaView({
    state,
    t,
    escapeHtml,
    agendaHours,
    currentAgendaAppointments,
    appointmentStyle,
    appointmentColor,
    appointmentStatusLabel,
    renderAgendaMobile,
    renderAppointmentDrawer
  });
}

const {
  filteredClients,
  clientAppointments,
  clientPayments,
  clientContinuityStatus,
  methodLabel,
  activeCashdeskPayments,
  cashdeskOpenAppointments,
  cashdeskClosedSessionsToVerify,
  cashdeskHistorySummary,
  cashdeskDailyCheck,
  clientGoldAction
} = createSmartDeskDomainHelpers({
  state,
  t,
  currentLanguage,
  riskBandLabel,
  findClientForAppointment
});

function renderClients() {
  return renderClientsView({
    state,
    t,
    escapeHtml,
    euro,
    filteredClients,
    clientAppointments,
    clientPayments,
    clientContinuityStatus,
    clientGoldAction,
    riskBandLabel,
    appointmentStatusLabel
  });
}

function renderServices() {
  return `
    <div class="stack">
      ${renderEnterpriseBanner()}
      <section class="card">
        <div class="row between mb-16">
          <div>
            <div class="section-title">${t("servicesView.title")}</div>
            <div class="page-subtitle">${t("servicesView.subtitle")}</div>
          </div>
          <div class="hero-badges">
            <div class="module-pill active">${state.services.length} ${t("servicesView.servicesCount")}</div>
            <div class="module-pill">${state.staff.length} ${t("servicesView.operatorsCount")}</div>
          </div>
        </div>
        <div class="module-state-grid">
          ${renderModuleStateCard({
            key: "treatments",
            title: t("servicesView.treatmentsTitle"),
            enabledCopy: t("servicesView.treatmentsEnabled"),
            lockedCopy: t("servicesView.treatmentsLocked")
          })}
          ${renderModuleStateCard({
            key: "protocols",
            title: t("servicesView.protocolsTitle"),
            enabledCopy: t("servicesView.protocolsEnabled"),
            lockedCopy: t("servicesView.protocolsLocked")
          })}
        </div>
      </section>
      <div class="settings-grid">
        <section class="card">
          <div class="row between mb-16">
            <div class="section-title">${t("servicesView.serviceListTitle")}</div>
            <button class="sh-button" data-action="new-service" type="button">${t("servicesView.newService")}</button>
          </div>
          <div class="settings-note mb-16">${t("servicesView.serviceListCopy")}</div>
          <div class="list">
            ${state.services.map((service) => `
              <div class="list-item">
                <div class="list-item-head">
                  <div class="row gap-8">
                    <span class="operator-swatch" style="background:${service.category.includes("beauty") ? "#F7D5E4" : service.category.includes("hair") ? "#BFE8F4" : "#E7D8F6"}"></span>
                    <div>
                      <div class="item-title">${escapeHtml(service.name)}</div>
                      <div class="item-subtitle">${escapeHtml(service.category)} · ${escapeHtml(String(service.duration))} min · ${euro(service.price)}</div>
                    </div>
                  </div>
                  <button class="sh-button secondary-btn" data-action="edit-service" data-id="${escapeHtml(service.id)}" type="button">${t("servicesView.edit")}</button>
                </div>
              </div>
            `).join("") || `<div class="empty-state-panel"><div class="item-title">${t("servicesView.noServices")}</div><div class="item-subtitle">${t("servicesView.noServicesCopy")}</div><button class="sh-button mt-16" data-action="new-service" type="button">${t("servicesView.createFirstService")}</button></div>`}
          </div>
        </section>
        <section class="card">
          <div class="row between mb-16">
            <div class="section-title">${t("servicesView.operatorsTitle")}</div>
            <button class="sh-button" data-action="new-staff" type="button">${t("servicesView.newOperator")}</button>
          </div>
          <div class="settings-note mb-16">${t("servicesView.operatorsCopy")}</div>
          <div class="list">
            ${state.staff.map((member) => `
              <div class="list-item">
                <div class="list-item-head">
                  <div>
                    <div class="item-title">${escapeHtml(member.name)}</div>
                    <div class="item-subtitle">${escapeHtml(member.role)} · ${escapeHtml(member.shift)}</div>
                  </div>
                  <button class="sh-button secondary-btn" data-action="edit-staff" data-id="${escapeHtml(member.id)}" type="button">${t("servicesView.edit")}</button>
                </div>
              </div>
            `).join("") || `<div class="empty-state-panel"><div class="item-title">${t("servicesView.noOperators")}</div><div class="item-subtitle">${t("servicesView.noOperatorsCopy")}</div><button class="sh-button mt-16" data-action="new-staff" type="button">${t("servicesView.createFirstOperator")}</button></div>`}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderReports() {
  const report = state.report;
  if (!report) {
    return `<section class="card"><div class="section-title">${t("reportsView.title")}</div><div class="settings-note mt-16">${t("reportsView.unavailable")}</div></section>`;
  }
  if (!moduleEnabled("reports")) {
    return renderLockedModule({
      title: t("reportsView.lockedTitle"),
      reason: t("reportsView.lockedReason"),
      hint: t("reportsView.lockedHint")
    });
  }
  const operators = Array.isArray(report.operators) ? report.operators : [];
  const services = Array.isArray(report.services) ? report.services : [];
  const periodLabelMap = {
    day: t("reportsView.dayView"),
    week: t("reportsView.weekView"),
    month: t("reportsView.monthView")
  };
  const activePeriodLabel = periodLabelMap[state.reportPeriod] || t("reportsView.dayView");
  return `
    <div class="stack">
      ${renderEnterpriseBanner()}
      <section class="card">
        <div class="dashboard-hero">
          <div>
            <div class="section-title">${t("reportsView.title")}</div>
            <div class="page-subtitle">${t("reportsView.subtitle")}</div>
          </div>
          <div class="hero-badges">
            <div class="module-pill active">${escapeHtml(activePeriodLabel)}</div>
            <div class="module-pill">${escapeHtml(String(report?.totals?.appointments ?? 0))} ${t("reportsView.appointmentsRead")}</div>
          </div>
        </div>
        ${renderPeriodFilters()}
        ${kpiCards([
          { label: t("reportsView.appointments"), value: report.totals.appointments },
          { label: t("reportsView.clients"), value: report.totals.clients },
          { label: t("reportsView.returning"), value: report.totals.returningClients },
          { label: t("reportsView.revenue"), value: euro(report.totals.revenue) }
        ])}
      </section>
      <div class="settings-grid">
        <section class="card">
          <div class="section-title">${t("reportsView.operators")}</div>
          <div class="settings-note mt-16">${t("reportsView.operatorsCopy")}</div>
          <div class="list mt-16">
            ${operators.map((item) => `<div class="list-item"><div class="item-title">${escapeHtml(item.name)}</div><div class="item-subtitle">${item.appointments} ${t("reportsView.appointments").toLowerCase()} · ${item.completed} ${t("reportsView.completed")}</div></div>`).join("") || `<div class="empty-state-panel"><div class="item-title">${t("reportsView.noOperatorData")}</div><div class="item-subtitle">${t("reportsView.noOperatorDataCopy")}</div></div>`}
          </div>
        </section>
        <section class="card">
          <div class="section-title">${t("reportsView.services")}</div>
          <div class="settings-note mt-16">${t("reportsView.servicesCopy")}</div>
          <div class="list mt-16">
            ${services.map((item) => `<div class="list-item"><div class="item-title">${escapeHtml(item.name)}</div><div class="item-subtitle">${item.count} ${t("reportsView.closed")} · ${euro(item.revenue)}</div></div>`).join("") || `<div class="empty-state-panel"><div class="item-title">${t("reportsView.noServiceData")}</div><div class="item-subtitle">${t("reportsView.noServiceDataCopy")}</div></div>`}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderCashdesk() {
  return renderCashdeskView({
    state,
    t,
    euro,
    escapeHtml,
    methodLabel,
    appointmentStatusLabel,
    activeCashdeskPayments,
    cashdeskOpenAppointments,
    cashdeskClosedSessionsToVerify,
    cashdeskHistorySummary,
    cashdeskDailyCheck
  });
}

function renderSettings() {
  const center = state.center || {};
  const runtimeMeta = state.runtimeMeta || {};
  const session = runtimeMeta.session || {};
  const subscription = runtimeMeta.subscription || {};
  const permissions = runtimeMeta.permissions || {};
  const activeSection = state.settingsSection || "modules";
  const sectionButton = (id, label) => `
    <button class="sh-button ${activeSection === id ? "active-btn" : "secondary-btn"}" data-action="set-settings-section" data-section="${id}" type="button">${label}</button>
  `;
  const centerSummary = `
    <div class="compact-stack">
      <div><strong>Nome:</strong> ${escapeHtml(center.name || "—")}</div>
      <div><strong>Tipo:</strong> ${escapeHtml(center.businessType || subscription.centerType || "—")}</div>
      <div><strong>Email:</strong> ${escapeHtml(center.email || "—")}</div>
      <div><strong>Telefono:</strong> ${escapeHtml(center.phone || "—")}</div>
      <div><strong>Orari:</strong> ${escapeHtml(center.hours || "—")}</div>
    </div>
  `;
  const modulesSummary = `
    <div class="module-state-grid">
      ${renderModuleStateCard({ key: "marketing", title: currentLanguage() === "en" ? "Marketing" : "Marketing", enabledCopy: currentLanguage() === "en" ? "Recall, triggers and operational lists are active." : "Richiami, attivazioni e liste operative.", lockedCopy: currentLanguage() === "en" ? "Enable the module to open recalls, triggers and lists." : "Attiva il modulo per aprire richiami, attivazioni e liste." })}
      ${renderModuleStateCard({ key: "treatments", title: currentLanguage() === "en" ? "Treatments" : "Trattamenti", enabledCopy: currentLanguage() === "en" ? "Paths, protocols and service shell are active." : "Percorsi, protocolli e struttura servizi.", lockedCopy: currentLanguage() === "en" ? "Enable treatments to connect paths and protocols." : "Attiva trattamenti per collegare percorsi e protocolli." })}
      ${renderModuleStateCard({ key: "cashdesk", title: currentLanguage() === "en" ? "Cash desk" : "Cassa", enabledCopy: currentLanguage() === "en" ? "Checkout, payment history and revenue are active." : "Incasso, storico pagamenti e ricavi.", lockedCopy: currentLanguage() === "en" ? "Enable cash desk to unlock checkout and payment history." : "Attiva cassa per sbloccare incasso e storico pagamenti." })}
      ${renderModuleStateCard({ key: "protocols", title: currentLanguage() === "en" ? "Protocols hub" : "Centro protocolli", enabledCopy: currentLanguage() === "en" ? "Method, operational guidance and AI draft are active." : "Metodo, guida operativa e bozza AI.", lockedCopy: currentLanguage() === "en" ? "Enable protocols to connect method and operational guidance." : "Attiva protocolli per collegare metodo e guida operativa." })}
      ${renderModuleStateCard({ key: "shiftsBase", title: currentLanguage() === "en" ? "Base shifts" : "Turni base", enabledCopy: currentLanguage() === "en" ? "Minimum presence is visible in agenda." : "Presenza minima leggibile in agenda.", lockedCopy: currentLanguage() === "en" ? "Enable shifts to manage presence in agenda." : "Attiva turni per gestire la presenza in agenda." })}
      ${renderModuleStateCard({ key: "shiftsTemplates", title: currentLanguage() === "en" ? "Shift templates" : "Modelli turni", enabledCopy: currentLanguage() === "en" ? "Templates and operational setup are active." : "Schemi e configurazione operativa.", lockedCopy: currentLanguage() === "en" ? "Enable templates to structure recurring shifts." : "Attiva i modelli per strutturare i turni ricorrenti." })}
      ${renderModuleStateCard({ key: "shiftsClock", title: currentLanguage() === "en" ? "Clock-in" : "Timbratura", enabledCopy: currentLanguage() === "en" ? "Access tracking and controls are active." : "Rilevazione accessi e controlli.", lockedCopy: currentLanguage() === "en" ? "Enable clock-in to track access and checks." : "Attiva timbratura per tracciare accessi e controlli." })}
      ${renderModuleStateCard({ key: "profitability", title: currentLanguage() === "en" ? "Profitability" : "Redditivita", enabledCopy: currentLanguage() === "en" ? "Margins, alerts and economic analysis are active." : "Margini, avvisi e analisi economica.", lockedCopy: currentLanguage() === "en" ? "Enable profitability to read margins and alerts." : "Attiva redditivita per leggere margini e avvisi." })}
      ${renderModuleStateCard({ key: "reports", title: currentLanguage() === "en" ? "Reports" : "Report", enabledCopy: currentLanguage() === "en" ? "Periodic reading of center and operators is active." : "Lettura periodica di centro e operatori.", lockedCopy: currentLanguage() === "en" ? "Enable reports to unlock period analysis." : "Attiva report per sbloccare l'analisi periodica." })}
    </div>
  `;
  const sessionSummary = `
    <div class="stack">
      <section class="card">
        <div class="section-title">${currentLanguage() === "en" ? "Session and confirmations" : "Sessione e conferme"}</div>
        <div class="settings-note mt-16">${currentLanguage() === "en" ? "Permissions must say what you can do now and when confirmation is required, without making you guess the next step." : "I permessi devono dire cosa puoi fare adesso e quando serve conferma, non lasciarti indovinare il prossimo passo."}</div>
        <div class="compact-stack mt-16">
          <div><strong>${currentLanguage() === "en" ? "Session state:" : "Stato sessione:"}</strong> ${escapeHtml(session.state || "active")}</div>
          <div><strong>${currentLanguage() === "en" ? "Role:" : "Ruolo:"}</strong> ${escapeHtml(session.role || "admin_centro")}</div>
          <div><strong>${currentLanguage() === "en" ? "Sensitive action confirmation:" : "Conferma azioni sensibili:"}</strong> ${escapeHtml(session.confirmationMode || "required_for_sensitive_actions")}</div>
          <div><strong>${currentLanguage() === "en" ? "Operational note:" : "Nota operativa:"}</strong> ${escapeHtml(session.note || (currentLanguage() === "en" ? "Sensitive actions require confirmation." : "Le azioni sensibili richiedono conferma."))}</div>
        </div>
      </section>
      <section class="card">
        <div class="section-title">${currentLanguage() === "en" ? "Active permissions" : "Permessi attivi"}</div>
        <div class="list mt-16">
          <div class="list-item"><div class="item-title">${currentLanguage() === "en" ? "Edit center data" : "Modifica dati centro"}</div><div class="item-subtitle">${permissions.canEditCenter ? (currentLanguage() === "en" ? "Available now in center settings." : "Disponibile ora nelle impostazioni centro.") : (currentLanguage() === "en" ? "Not available in this session." : "Non disponibile in questa sessione.")}</div></div>
          <div class="list-item"><div class="item-title">${currentLanguage() === "en" ? "Edit operational data" : "Modifica dati operativi"}</div><div class="item-subtitle">${permissions.canEditOperationalData ? (currentLanguage() === "en" ? "Available on agenda, clients, services and cash desk." : "Disponibile su agenda, clienti, servizi e cassa.") : (currentLanguage() === "en" ? "Blocked: a coherent role or plan is required." : "Bloccata: serve ruolo o piano coerente.")}</div></div>
          <div class="list-item"><div class="item-title">${currentLanguage() === "en" ? "Execution without confirmation" : "Esecuzione senza conferma"}</div><div class="item-subtitle">${permissions.canExecuteSensitiveActionsWithoutConfirmation ? (currentLanguage() === "en" ? "Active: use this mode only when the center is governed." : "Attiva: usa questa modalita solo se il centro e governato.") : (currentLanguage() === "en" ? "Disabled: sensitive actions remain confirmable." : "Disattiva: le azioni sensibili restano confermabili.")}</div></div>
        </div>
      </section>
    </div>
  `;
  const activeSectionBody =
    activeSection === "center" ? centerSummary :
    activeSection === "session" ? sessionSummary :
    modulesSummary;
  return `
    <div class="stack">
      ${renderEnterpriseBanner()}
      <section class="card">
        <div class="section-title">${t("settings.sectionTitle")}</div>
        <div class="page-subtitle mt-16">${t("settings.pageSubtitle")}</div>
        <div class="settings-grid mt-16">
          <section class="card">
            <div class="section-title">${t("settings.languageCardTitle")}</div>
            <label class="settings-language-field mt-16">
              <span><strong>${t("settings.languageLabel")}</strong></span>
              <select id="settings-language-select" class="sh-input">
                ${supportedLanguages.map((option) => `<option value="${option}" ${currentLanguage() === option ? "selected" : ""}>${document.querySelector(`#language-select option[value="${option}"]`)?.textContent || option.toUpperCase()}</option>`).join("")}
              </select>
            </label>
            <div class="settings-note mt-16">${t("settings.languageHelp")}</div>
          </section>
          <section class="card">
            <div class="section-title">${t("settings.infraTitle")}</div>
            <div class="settings-note mt-16">${t("settings.infraCopy")}</div>
          </section>
        </div>
      </section>
      <section class="card">
        <div class="dashboard-hero">
          <div>
            <div class="section-title">${t("settingsView.enterpriseTitle")}</div>
            <div class="page-subtitle">${t("settingsView.enterpriseSubtitle")}</div>
          </div>
          <div class="hero-badges">
            <div class="module-pill active">${escapeHtml(String(subscription.activeModules || 0))} ${t("settingsView.activeModules")}</div>
            <div class="module-pill">${escapeHtml(subscription.state || "configured")}</div>
          </div>
        </div>
        <div class="period-filter-bar mt-16">
          ${sectionButton("modules", t("settingsView.modules"))}
          ${sectionButton("session", t("settingsView.sessionPermissions"))}
          ${sectionButton("center", t("settingsView.center"))}
        </div>
      </section>
      <section class="card">
        <div class="row between mb-16">
          <div class="section-title">${activeSection === "center" ? t("settingsView.centerData") : activeSection === "session" ? t("settingsView.sessionRole") : t("settingsView.moduleState")}</div>
          <button class="sh-button" data-action="edit-center" type="button">${activeSection === "center" ? t("settingsView.editCenter") : t("settingsView.refreshCenter")}</button>
        </div>
        ${activeSectionBody}
      </section>
      <div class="settings-grid">
        <section class="card">
          <div class="section-title">${t("settings.consistencyTitle")}</div>
          <div class="settings-note mt-16">${t("settings.consistencyCopy")}</div>
        </section>
      </div>
    </div>
  `;
}

async function saveLanguage(language) {
  const nextLanguage = supportedLanguages.includes(language) ? language : "it";
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appLanguage: nextLanguage })
  });
  state.settings = await response.json();
  syncTopbar();
  renderView();
  showFeedback(t("common.saveLanguageOk"));
}

function renderView() {
  syncTopbar();
  const viewMap = {
    ecosystem: renderEcosystem,
    dashboard: renderDashboard,
    "ai-gold": renderAiGoldRoom,
    marketing: renderMarketing,
    appointments: renderAgenda,
    cashdesk: renderCashdesk,
    inventory: renderInventory,
    profitability: renderProfitability,
    clients: renderClients,
    services: renderServices,
    protocols: renderProtocols,
    reports: renderReports,
    settings: renderSettings,
    "control-executive": renderControlExecutive,
    "control-work-gallery": renderControlWorkGallery,
    "control-work-detail": renderControlWorkDetail,
    "control-agents": renderControlAgents,
    "control-branches": renderControlBranches,
    "control-keys": renderControlKeys,
    "control-audit": renderControlAudit,
    "control-decision-ledger": renderControlDecisionLedger,
    "control-memory": renderControlMemory,
    "control-connectors": renderControlConnectors,
    "control-governance": renderControlGovernance,
    "control-demo": renderControlDemo,
    "control-super-admin": renderControlSuperAdmin
  };
  if (String(state.currentView || "").startsWith("control-")) {
    syncControlNavigationVisibility();
  }
  const renderer = viewMap[state.currentView] || renderDashboard;
  appView.innerHTML = renderer();
  bindViewEvents();
}

function openDialog(config) {
  dialogTitle.textContent = config.title;
  dialogFields.innerHTML = config.fields;
  entityForm.dataset.entity = config.entity;
  entityForm.dataset.mode = config.mode || "create";
  entityForm.dataset.id = config.id || "";
  dialog.showModal();
}

const {
  openClientDialog,
  openServiceDialog,
  openStaffDialog,
  openAppointmentDialog,
  openCenterDialog,
  submitEntity,
  deleteAppointment,
  saveCashdeskPayment,
  copyClientMessageToClipboard
} = createSmartDeskOperations({
  state,
  t,
  currentLanguage,
  escapeHtml,
  API_SERVER_URL,
  safeJsonFetch,
  showFeedback,
  refreshForUserEvent,
  renderView,
  updateAppointment,
  loadData,
  dialog,
  entityForm,
  openDialog,
  findClientForAppointment,
  clientAppointments,
  clientPayments,
  clientContinuityStatus,
  clientGoldAction
});

function bindViewEvents() {
  document.querySelectorAll("[data-view-link]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.currentView = button.dataset.viewLink;
      if (String(state.currentView || "").startsWith("control-")) {
        await loadControlDataForView(state.currentView);
      }
      if (state.currentView === "profitability") {
        await loadProfitabilityOverview();
      }
      if (state.currentView === "protocols") {
        await loadTreatments();
      }
      renderView();
    });
  });

  document.querySelectorAll('[data-action="open-settings-section"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.currentView = "settings";
      state.settingsSection = button.dataset.section || "modules";
      state.selectedAppointmentId = null;
      state.selectedSlot = null;
      state.fullScreenAgenda = false;
      renderView();
    });
  });

  document.querySelectorAll('[data-action="apply-control-work-filters"]').forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.currentView !== "control-work-gallery") return;
      setControlWorkFilters(readControlWorkFiltersFromDom());
      await loadControlDataForView("control-work-gallery");
      renderView();
    });
  });

  document.querySelectorAll('[data-action="reset-control-work-filters"]').forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.currentView !== "control-work-gallery") return;
      setControlWorkFilters({});
      await loadControlDataForView("control-work-gallery");
      renderView();
    });
  });

  document.querySelectorAll('[data-action="open-control-work-detail"]').forEach((button) => {
    button.addEventListener("click", async () => {
      const workId = String(button.dataset.workId || "").trim();
      if (!workId) return;
      state.control.selectedWorkId = workId;
      state.currentView = "control-work-detail";
      await loadControlDataForView("control-work-detail");
      renderView();
    });
  });

  if (state.currentView === "appointments") {
    bindAgendaViewEvents({
      state,
      renderView,
      openAppointmentDialog,
      openClientDialog,
      updateAppointment,
      checkoutAppointment,
      moveAppointment,
      addTechnicalNoteToAppointment,
      deleteAppointment,
      findClientForAppointment
    });
  }

  if (state.currentView === "clients") {
    bindClientsViewEvents({
      state,
      renderView,
      openClientDialog,
      clientAppointments,
      copyClientMessageToClipboard
    });
  }

  if (state.currentView === "ai-gold") {
    bindAiGoldViewEvents({ state, renderView });
  }

  if (state.currentView === "marketing") {
    bindMarketingViewEvents({ state, renderView, showFeedback, t, marketingMessageForClient });
  }

  if (state.currentView === "inventory") {
    bindInventoryViewEvents({ state, API_SERVER_URL, loadData, renderView, showFeedback, t });
  }

  if (state.currentView === "profitability") {
    bindProfitabilityViewEvents({ state, renderView, loadProfitabilityOverview, showFeedback, t, API_SERVER_URL });
  }

  if (state.currentView === "protocols") {
    bindProtocolsViewEvents({ state, API_SERVER_URL, renderView, showFeedback, t, loadTreatments, loadData });
  }

  if (state.currentView === "services") {
    bindServicesViewEvents({ state, openServiceDialog, openStaffDialog });
  }

  if (state.currentView === "reports") {
    bindReportsViewEvents({ state, renderView });
  }

  if (state.currentView === "cashdesk") {
    bindCashdeskViewEvents({
      state,
      renderView,
      findClientForAppointment,
      saveCashdeskPayment
    });
  }

  if (state.currentView === "settings") {
    bindSettingsViewEvents({ state, renderView, openCenterDialog, saveLanguage });
  }
}

function renderAssistantDrawer() {
  assistantDrawer.classList.toggle("hidden", !state.assistantOpen);
  const assistant = state.assistant;
  if (!assistant) {
    assistantBriefNode.innerHTML = "";
    return;
  }
  assistantBriefNode.innerHTML = `
    <div class="list-item">
      <div class="item-title">${t("assistantView.sessionsToday")}</div>
      <div class="item-subtitle">${assistant.summary?.appointmentsToday ?? 0}</div>
    </div>
    <div class="list-item">
      <div class="item-title">${t("assistantView.recallActive")}</div>
      <div class="item-subtitle">${assistant.summary?.recallClients ?? 0}</div>
    </div>
    <div class="list-item">
      <div class="item-title">${t("assistantView.pendingBookings")}</div>
      <div class="item-subtitle">${assistant.summary?.pendingBookings ?? 0}</div>
    </div>
    <div class="list-item">
      <div class="item-title">${t("assistantView.goldPriority")}</div>
      <div class="item-subtitle">${escapeHtml(state.goldDecisionContext?.primaryAction?.label || t("aiGoldView.monitorCenter"))}</div>
    </div>
  `;
}

const bindGlobalEvents = () => bindGlobalEventsBootstrap({
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
  dialog,
  loadProfitabilityOverview,
  loadTreatments,
  loadControlDataForView
});

void initApp({
  loadData,
  bindGlobalEvents,
  renderAssistantDrawer,
  renderView,
  startLazyRefreshLoop,
  lazyRefreshMs: LAZY_REFRESH_MS
});
