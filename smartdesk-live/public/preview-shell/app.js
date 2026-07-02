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

const {
  loadProfitabilityOverview,
  loadTreatments,
  loadData,
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
  await safeJsonFetch(`${API_SERVER_URL}/appointments/${id}`, `/api/appointments/${id}`, {
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
    settings: renderSettings
  };
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
    bindProfitabilityViewEvents({ state, renderView, loadProfitabilityOverview, showFeedback, t });
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
  loadTreatments
});

void initApp({
  loadData,
  bindGlobalEvents,
  renderAssistantDrawer,
  renderView,
  startLazyRefreshLoop,
  lazyRefreshMs: LAZY_REFRESH_MS
});
