export function createShellHelpers({
  state,
  t,
  currentLanguage,
  escapeHtml,
  webShell,
  topbarNode,
  contentAreaNode,
  languageSelect
}) {
  function currentPlanId() {
    return String(state.runtimeMeta?.subscription?.plan || state.runtimeMeta?.subscription?.tier || "gold").toLowerCase();
  }

  function activeNavClass(view) {
    return state.currentView === view ? "sh-button active-btn" : "sh-button secondary-btn";
  }

  function moduleEnabled(key) {
    const settings = state.settings || {};
    const plan = currentPlanId();
    const canUseSilverLayer = plan === "silver" || plan === "gold" || plan === "enterprise";
    const map = {
      marketing: settings.enableMarketing,
      treatments: settings.enableTreatments && canUseSilverLayer,
      cashdesk: settings.enableCashdesk,
      inventory: settings.inventoryBaseEnabled,
      protocols: settings.enableProtocolsHub,
      shiftsBase: settings.shiftsBaseEnabled,
      shiftsTemplates: settings.shiftsTemplatesEnabled,
      shiftsClock: settings.shiftsClockEnabled,
      profitability: settings.profitabilityEnabled && canUseSilverLayer,
      reports: settings.operatorReportsEnabled && canUseSilverLayer
    };
    return Boolean(map[key]);
  }

  function canUseAiGold() {
    const plan = currentPlanId();
    return Boolean(state.settings?.aiActionsEnabled) && (plan === "gold" || plan === "enterprise");
  }

  function syncTopbar() {
    const isAgendaFullscreen = state.currentView === "appointments" && state.fullScreenAgenda;
    webShell?.classList.toggle("agenda-fullscreen-shell", isAgendaFullscreen);
    document.body.classList.toggle("agenda-fullscreen-shell", isAgendaFullscreen);
    topbarNode?.classList.toggle("hidden", isAgendaFullscreen);
    contentAreaNode?.classList.toggle("agenda-fullscreen-content", isAgendaFullscreen);
    document.getElementById("center-name").textContent = state.center?.name || t("common.centerFallback");
    document.getElementById("center-subtitle").textContent = t("common.subtitle", { centerType: state.center?.centerType || "Advanced Aesthetic Systems" });
    document.getElementById("language-label").textContent = t("common.language");
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.className = activeNavClass(button.dataset.view);
      if (button.dataset.view === "ecosystem") button.textContent = t("nav.ecosystem");
      if (button.dataset.view === "dashboard") button.textContent = t("nav.dashboard");
      if (button.dataset.view === "ai-gold") button.textContent = t("nav.aiGold");
      if (button.dataset.view === "marketing") button.textContent = t("nav.marketing");
      if (button.dataset.view === "appointments") button.textContent = t("nav.appointments");
      if (button.dataset.view === "cashdesk") button.textContent = t("nav.cashdesk");
      if (button.dataset.view === "inventory") button.textContent = t("nav.inventory");
      if (button.dataset.view === "profitability") button.textContent = t("nav.profitability");
      if (button.dataset.view === "reports") button.textContent = t("nav.reports");
      if (button.dataset.view === "clients") button.textContent = t("nav.clients");
      if (button.dataset.view === "services") button.textContent = t("nav.services");
      if (button.dataset.view === "protocols") button.textContent = t("nav.protocols");
      if (button.dataset.view === "settings") button.textContent = t("nav.settings");
      if (button.dataset.view === "marketing") button.classList.toggle("hidden", !moduleEnabled("marketing"));
      if (button.dataset.view === "inventory") button.classList.toggle("hidden", !moduleEnabled("inventory"));
      if (button.dataset.view === "profitability") button.classList.toggle("hidden", !moduleEnabled("profitability"));
      if (button.dataset.view === "protocols") button.classList.toggle("hidden", !moduleEnabled("protocols") && !moduleEnabled("treatments"));
      if (button.dataset.view === "ai-gold") button.classList.toggle("hidden", !canUseAiGold());
    });
    document.querySelector(".user-pill").textContent = t("common.webShell");
    document.getElementById("open-assistant").textContent = t("common.aiAssistant");
    document.getElementById("quick-appointment").textContent = t("common.newSession");
    if (languageSelect) {
      languageSelect.value = currentLanguage();
    }
  }

  function renderEnterpriseBanner() {
    const runtime = state.runtimeMeta;
    if (!runtime) {
      return `
        <section class="card enterprise-banner">
          <div>
            <div class="section-title">${t("settingsView.sessionPermissions")}</div>
            <div class="page-subtitle">${currentLanguage() === "en" ? "Session metadata not available. The shell continues, but the enterprise layer is not complete yet." : "Metadati sessione non disponibili. La struttura continua, ma il livello Enterprise non e ancora completo."}</div>
          </div>
        </section>
      `;
    }

    return `
      <section class="card enterprise-banner">
        <div class="enterprise-banner-main">
          <div>
            <div class="section-title">${t("settingsView.sessionPermissions")}</div>
            <div class="page-subtitle">${currentLanguage() === "en" ? `Session ${escapeHtml(runtime.session.state)} · role ${escapeHtml(runtime.session.role)} · confirmation required for sensitive actions.` : `Sessione ${escapeHtml(runtime.session.state)} · ruolo ${escapeHtml(runtime.session.role)} · conferma richiesta sulle azioni sensibili.`}</div>
          </div>
          <div class="hero-badges">
            <div class="module-pill active">${escapeHtml(runtime.subscription.centerType || (currentLanguage() === "en" ? "Active center" : "Centro attivo"))}</div>
            <div class="module-pill">${escapeHtml(String(runtime.subscription.activeModules || 0))} ${t("settingsView.activeModules")}</div>
          </div>
        </div>
        <div class="enterprise-banner-grid">
          <div class="dashboard-focus-item">
            <div class="stat-label">${currentLanguage() === "en" ? "Session state" : "Stato sessione"}</div>
            <div class="focus-value">${escapeHtml(runtime.session.state)}</div>
          </div>
          <div class="dashboard-focus-item">
            <div class="stat-label">${currentLanguage() === "en" ? "Sensitive actions" : "Azioni sensibili"}</div>
            <div class="focus-value">${runtime.permissions?.canExecuteSensitiveActionsWithoutConfirmation ? (currentLanguage() === "en" ? "free" : "libere") : (currentLanguage() === "en" ? "confirm" : "conferma")}</div>
          </div>
          <div class="dashboard-focus-item">
            <div class="stat-label">${currentLanguage() === "en" ? "Operational note" : "Messaggio operativo"}</div>
            <div class="item-subtitle">${escapeHtml(runtime.session.note || (currentLanguage() === "en" ? "No note available." : "Nessuna nota disponibile."))}</div>
          </div>
        </div>
        <div class="action-row mt-16">
          <button class="sh-button secondary-btn" data-action="open-settings-section" data-section="modules" type="button">${currentLanguage() === "en" ? "Review modules" : "Rivedi moduli"}</button>
          <button class="sh-button secondary-btn" data-action="open-settings-section" data-section="session" type="button">${currentLanguage() === "en" ? "Review session" : "Rivedi sessione"}</button>
        </div>
      </section>
    `;
  }

  function renderModuleStateCard(config) {
    const enabled = moduleEnabled(config.key);
    return `
      <article class="module-state-card ${enabled ? "is-enabled" : "is-locked"}">
        <div class="row between gap-8">
          <div>
            <div class="item-title">${escapeHtml(config.title)}</div>
            <div class="item-subtitle">${enabled ? escapeHtml(config.enabledCopy) : escapeHtml(config.lockedCopy)}</div>
          </div>
          <span class="module-state-badge ${enabled ? "enabled" : "locked"}">${enabled ? t("moduleState.active") : t("moduleState.upgrade")}</span>
        </div>
        <div class="action-row mt-16">
          <button class="sh-button secondary-btn" data-action="open-settings-section" data-section="modules" type="button">${enabled ? t("moduleState.reviewSetup") : t("moduleState.openModules")}</button>
        </div>
      </article>
    `;
  }

  function renderLockedModule(config) {
    return `
      <section class="card module-locked-panel">
        <div class="section-title">${escapeHtml(config.title)}</div>
        <div class="page-subtitle mt-16">${escapeHtml(config.detail || config.reason || "")}</div>
        ${config.hint ? `<div class="settings-note mt-16">${escapeHtml(config.hint)}</div>` : ""}
        <div class="action-row mt-16">
          <button class="sh-button" data-action="open-settings-section" data-section="modules" type="button">${t("moduleState.openModules")}</button>
          <button class="sh-button secondary-btn" data-view-link="dashboard" type="button">${currentLanguage() === "en" ? "Back to dashboard" : "Torna alla dashboard"}</button>
        </div>
      </section>
    `;
  }

  function renderPeriodFilters() {
    const items = [
      { id: "day", label: t("reportsView.dayView") },
      { id: "week", label: t("reportsView.weekView") },
      { id: "month", label: t("reportsView.monthView") }
    ];
    return `
      <div class="period-filter-bar">
        ${items.map((item) => `
          <button class="period-filter ${state.reportPeriod === item.id ? "active" : ""}" data-action="set-report-period" data-period="${item.id}" type="button">
            ${item.label}
          </button>
        `).join("")}
      </div>
    `;
  }

  function kpiCards(cards) {
    return `<div class="grid-cards">${cards.map((card) => `
      <div class="dashboard-kpi-card">
        <div class="stat-label">${escapeHtml(card.label)}</div>
        <div class="stat-value">${escapeHtml(card.value)}</div>
      </div>
    `).join("")}</div>`;
  }

  function riskBandLabel(band) {
    if (band === "high") return currentLanguage() === "en" ? "high" : "alta";
    if (band === "medium") return currentLanguage() === "en" ? "medium" : "media";
    return currentLanguage() === "en" ? "low" : "bassa";
  }

  return {
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
  };
}
