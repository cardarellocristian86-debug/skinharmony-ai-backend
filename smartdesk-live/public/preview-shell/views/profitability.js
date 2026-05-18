export function renderProfitabilityView(deps) {
  const {
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
    profitabilityStatusLabel
  } = deps;

  if (!moduleEnabled("profitability")) {
    return renderLockedModule({
      title: t("profitabilityView.lockedTitle"),
      detail: t("profitabilityView.lockedCopy"),
      hint: t("profitabilityView.lockedNote")
    });
  }

  const overview = state.profitabilityOverview || normalizeProfitabilityOverview(null);
  return `
    <div class="stack">
      ${renderEnterpriseBanner()}
      <section class="card">
        <div class="row between mb-16">
          <div>
            <div class="section-title">${t("profitabilityView.title")}</div>
            <div class="page-subtitle">${t("profitabilityView.subtitle")}</div>
          </div>
          <button class="sh-button secondary-btn" data-action="refresh-profitability" type="button">${t("profitabilityView.refreshAnalysis")}</button>
        </div>
        <div class="row gap-8 wrap-mobile">
          <label class="stack">
            <span class="stat-label">${t("profitabilityView.dateFrom")}</span>
            <input id="profitability-start-date" class="sh-input" type="date" value="${escapeHtml(state.profitabilityStartDate)}">
          </label>
          <label class="stack">
            <span class="stat-label">${t("profitabilityView.dateTo")}</span>
            <input id="profitability-end-date" class="sh-input" type="date" value="${escapeHtml(state.profitabilityEndDate)}">
          </label>
        </div>
      </section>

      ${overview.available ? kpiCards([
        { label: t("profitabilityView.servicesLogged"), value: String(overview.totals.executions || 0) },
        { label: t("profitabilityView.revenueAnalyzed"), value: euroFromCents(overview.totals.revenueCents) },
        { label: t("profitabilityView.totalCost"), value: euroFromCents(overview.totals.costCents) },
        { label: t("profitabilityView.totalProfit"), value: euroFromCents(overview.totals.profitCents) }
      ]) : `
        <section class="card">
          <div class="settings-note">${t("profitabilityView.unavailable")}</div>
          <div class="page-subtitle mt-16">${t("profitabilityView.unavailableCopy")}</div>
        </section>
      `}

      ${overview.available ? `
        <div class="settings-grid">
          <section class="card">
            <div class="section-title mb-16">${t("profitabilityView.services")}</div>
            <div class="list">
              ${overview.services.map((item) => `
                <div class="list-item static">
                  <div>
                    <div class="item-title">${escapeHtml(item.name || "Servizio")}</div>
                    <div class="item-subtitle">${t("profitabilityView.serviceLine", { revenue: euroFromCents(item.revenueCents), cost: euroFromCents(item.costCents), profit: euroFromCents(item.profitCents) })}</div>
                  </div>
                  <div class="row gap-8 wrap-mobile">
                    <div class="item-subtitle">${t("profitabilityView.executionsLine", { count: Number(item.executions || 0), margin: Number(item.marginPercent || 0) })}</div>
                    <span class="${profitabilityStatusTone(item.status)}">${profitabilityStatusLabel(item.status)}</span>
                  </div>
                </div>
              `).join("") || `<div class="settings-note">${t("profitabilityView.emptyServices")}</div>`}
            </div>
          </section>

          <section class="card">
            <div class="section-title mb-16">${t("profitabilityView.products")}</div>
            <div class="list">
              ${overview.products.map((item) => `
                <div class="list-item static">
                  <div>
                    <div class="item-title">${escapeHtml(item.name || "Prodotto")}</div>
                    <div class="item-subtitle">${t("profitabilityView.productsLine", { consumed: euroFromCents(item.costConsumedCents), revenue: euroFromCents(item.revenueCents), profit: euroFromCents(item.profitCents) })}</div>
                  </div>
                  <div class="row gap-8 wrap-mobile">
                    <div class="item-subtitle">${t("profitabilityView.usesLine", { count: Number(item.totalUses || 0), margin: Number(item.marginPercent || 0) })}</div>
                    <span class="${profitabilityStatusTone(item.status)}">${profitabilityStatusLabel(item.status)}</span>
                  </div>
                </div>
              `).join("") || `<div class="settings-note">${t("profitabilityView.emptyProducts")}</div>`}
            </div>
          </section>

          <section class="card">
            <div class="section-title mb-16">${t("profitabilityView.technologies")}</div>
            <div class="list">
              ${overview.technologies.map((item) => `
                <div class="list-item static">
                  <div>
                    <div class="item-title">${escapeHtml(item.name || "Tecnologia")}</div>
                    <div class="item-subtitle">${t("profitabilityView.technologiesLine", { revenue: euroFromCents(item.revenueCents), monthly: euroFromCents(item.monthlyCostCents), profit: euroFromCents(item.profitCents) })}</div>
                  </div>
                  <div class="row gap-8 wrap-mobile">
                    <div class="item-subtitle">${t("profitabilityView.technologyUsesLine", { count: Number(item.totalUses || 0), margin: Number(item.marginPercent || 0) })}</div>
                    <span class="${profitabilityStatusTone(item.status)}">${profitabilityStatusLabel(item.status)}</span>
                  </div>
                </div>
              `).join("") || `<div class="settings-note">${t("profitabilityView.emptyTechnologies")}</div>`}
            </div>
          </section>

          <section class="card">
            <div class="section-title mb-16">${t("profitabilityView.automaticAlerts")}</div>
            <div class="list">
              ${overview.alerts.map((item) => `
                <div class="list-item static">
                  <div>
                    <div class="item-title">${escapeHtml(item.title || item.area || "Alert")}</div>
                    <div class="item-subtitle">${escapeHtml(item.body || "")}</div>
                  </div>
                  <span class="${item.level === "critical" ? "status-badge critical" : item.level === "warning" ? "status-badge warning" : "status-badge success"}">${escapeHtml(item.area || "center")}</span>
                </div>
              `).join("") || `<div class="settings-note">${t("profitabilityView.emptyAlerts")}</div>`}
            </div>
          </section>
        </div>
      ` : ""}
    </div>
  `;
}
