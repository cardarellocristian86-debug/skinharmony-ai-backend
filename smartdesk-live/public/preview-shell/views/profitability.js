function moneyInput({ id, label, value, help }) {
  const field = id.replace("gold-cost-", "");
  return `
    <label class="smart-field">
      <span class="smart-field-label">${label}</span>
      <input id="${id}" class="sh-input gold-cost-minute-input" data-gold-cost-field="${field}" type="number" min="0" step="1" value="${Number(value || 0)}" placeholder="0">
      <small class="smart-field-help">${help}</small>
    </label>
  `;
}

function renderGoldCostMinutePanel({ state, overview, currentPlanId, currentLanguage, euroFromCents, escapeHtml }) {
  const plan = String(currentPlanId?.() || "").toLowerCase();
  if (plan !== "gold") return "";

  const existingProfile = overview?.operatingCostMinuteProfile || {};
  const profile = state.center?.goldFixedCostProfile || existingProfile.fixedCostProfile || state.goldCostMinuteProfile || {};
  const isEn = currentLanguage?.() === "en";
  const costKeys = [
    "rent",
    "utilitiesPower",
    "utilitiesWaterGas",
    "accountant",
    "insurance",
    "software",
    "marketing",
    "cleaningLaundry",
    "bankPosFees",
    "taxesContributionsReserve",
    "otherFixedCosts"
  ];
  const existingMonthlyCents = Number(existingProfile.existingMonthlyCents || 0);
  const manualFixedMonthlyCents = Number(existingProfile.manualFixedMonthlyCents || 0) || costKeys.reduce((sum, key) => sum + Math.round(Number(profile[key] || 0) * 100), 0);
  const totalMonthlyCents = Number(existingProfile.totalMonthlyBaselineCents || 0) || (existingMonthlyCents + manualFixedMonthlyCents);
  const workingDays = Math.max(0, Number(profile.workingDaysMonthly || 0));
  const dailyHours = Math.max(0, Number(profile.operatingHoursDaily || 0));
  const monthlyMinutes = workingDays * dailyHours * 60;
  const costPerMinuteCents = monthlyMinutes > 0 ? Math.round(totalMonthlyCents / monthlyMinutes) : 0;
  const costPerHourCents = costPerMinuteCents * 60;
  const costPerDayCents = workingDays > 0 ? Math.round(totalMonthlyCents / workingDays) : 0;
  const missing = [];
  if (!profile.rent) missing.push(isEn ? "rent or mortgage" : "affitto o mutuo");
  if (!profile.utilitiesPower) missing.push(isEn ? "electricity" : "corrente elettrica");
  if (!profile.accountant) missing.push(isEn ? "accountant" : "commercialista");
  if (!profile.insurance) missing.push(isEn ? "insurance" : "assicurazione");
  (existingProfile.missing || []).forEach((item) => missing.push(`${item.label || item.key}: ${item.count || 0}`));
  if (!workingDays) missing.push(isEn ? "working days per month" : "giorni lavorativi mensili");
  if (!dailyHours) missing.push(isEn ? "open hours per day" : "ore operative al giorno");
  const existingCompleted = existingMonthlyCents > 0 ? 1 : 0;
  const completed = costKeys.filter((key) => Number(profile[key] || 0) > 0).length + existingCompleted + (workingDays ? 1 : 0) + (dailyHours ? 1 : 0);
  const coverage = Math.max(0, Math.round((completed / (costKeys.length + 3)) * 100));
  const reportCopy = monthlyMinutes > 0 && totalMonthlyCents > 0
    ? (isEn ? `Every operational minute must cover about ${euroFromCents(costPerMinuteCents)} before direct service/product costs.` : `Ogni minuto operativo deve coprire circa ${euroFromCents(costPerMinuteCents)} prima dei costi diretti di servizio/prodotto.`)
    : (isEn ? "Enter at least monthly fixed costs, working days and daily hours to read the center cost per minute." : "Inserisci almeno costi fissi mensili, giorni lavorativi e ore giornaliere per leggere il costo minuto del centro.");

  return `
    <section class="card gold-cost-minute-panel">
      <div class="row between mb-16">
        <div>
          <div class="section-title">${isEn ? "Gold center cost per minute" : "Costo minuto centro Gold"}</div>
          <div class="page-subtitle">${isEn ? "Uses existing staff, technology and inventory costs first. Add only missing general fixed costs here." : "Usa prima costi esistenti di operatori, tecnologie e magazzino. Qui aggiungi solo costi fissi generali mancanti."}</div>
        </div>
        <div class="module-pill active">${coverage}% ${isEn ? "complete" : "completo"}</div>
      </div>
      <div class="dashboard-focus-grid mb-16">
        <div class="dashboard-focus-item"><div class="stat-label">${isEn ? "From management system" : "Dal gestionale"}</div><div class="focus-value">${euroFromCents(existingMonthlyCents)}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${isEn ? "Manual fixed costs" : "Fissi manuali"}</div><div class="focus-value">${euroFromCents(manualFixedMonthlyCents)}</div></div>
        <div class="dashboard-focus-item"><div class="stat-label">${isEn ? "Monthly total" : "Totale mese"}</div><div class="focus-value">${euroFromCents(totalMonthlyCents)}</div></div>
        <div class="dashboard-focus-item priority-card ${costPerMinuteCents ? "priority-critical" : "priority-warning"}"><div class="stat-label">${isEn ? "Cost / minute" : "Costo minuto"}</div><div class="focus-value">${euroFromCents(costPerMinuteCents)}</div></div>
      </div>
      <div class="settings-note mb-16">${isEn ? "Included from existing data" : "Inclusi da dati gia presenti"}: ${isEn ? "staff" : "operatori"} ${euroFromCents(Number(existingProfile.staffMonthlyCents || 0))} · ${isEn ? "technologies" : "tecnologie"} ${euroFromCents(Number(existingProfile.technologyMonthlyCents || 0))} · ${isEn ? "inventory cost coverage" : "copertura costi prodotti"} ${Number(existingProfile.inventoryCoverage?.withCost || 0)}/${Number(existingProfile.inventoryCoverage?.total || 0)}</div>
      <div class="settings-note mb-16">${escapeHtml(reportCopy)}</div>
      ${missing.length ? `<div class="smart-warning-card mb-16"><strong>${isEn ? "Missing data" : "Dati mancanti"}</strong><div class="smart-warning-list">${missing.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div></div>` : `<div class="settings-saved mb-16">${isEn ? "Main fixed-cost profile complete enough for operational reading." : "Profilo costi fissi abbastanza completo per lettura operativa."}</div>`}
      <div class="center-profile-grid">
        <label class="smart-field">
          <span class="smart-field-label">${isEn ? "Business type" : "Tipo attivita"}</span>
          <select id="gold-cost-businessType" class="sh-select gold-cost-minute-input" data-gold-cost-field="businessType">
            ${["hair", "aesthetic", "hybrid"].map((value) => `<option value="${value}" ${String(profile.businessType || "hybrid") === value ? "selected" : ""}>${value === "hair" ? (isEn ? "Hair salon" : "Parrucchiere") : value === "aesthetic" ? (isEn ? "Beauty center" : "Estetica") : (isEn ? "Hybrid" : "Ibrido")}</option>`).join("")}
          </select>
          <small class="smart-field-help">${isEn ? "Used to read the center with the right operating context." : "Serve per leggere il centro con il contesto operativo corretto."}</small>
        </label>
        <label class="smart-field">
          <span class="smart-field-label">${isEn ? "Fiscal context" : "Contesto fiscale"}</span>
          <select id="gold-cost-fiscalRegime" class="sh-select gold-cost-minute-input" data-gold-cost-field="fiscalRegime">
            ${[["ordinary_vat", isEn ? "Ordinary VAT" : "Ordinario IVA"], ["flat_rate", isEn ? "Flat-rate/forfettario" : "Forfettario"], ["srl", "SRL"], ["individual", isEn ? "Individual business" : "Ditta individuale"]].map(([value, label]) => `<option value="${value}" ${String(profile.fiscalRegime || "ordinary_vat") === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <small class="smart-field-help">${isEn ? "Context only: Smart Desk does not replace accountant/tax calculation." : "Solo contesto: Smart Desk non sostituisce commercialista o calcolo fiscale."}</small>
        </label>
        ${moneyInput({ id: "gold-cost-rent", label: isEn ? "Rent / mortgage" : "Affitto o mutuo", value: profile.rent, help: isEn ? "Monthly location cost." : "Costo mensile del locale." })}
        ${moneyInput({ id: "gold-cost-utilitiesPower", label: isEn ? "Electricity" : "Corrente elettrica", value: profile.utilitiesPower, help: isEn ? "Average monthly electricity cost." : "Media mensile corrente elettrica." })}
        ${moneyInput({ id: "gold-cost-utilitiesWaterGas", label: isEn ? "Water / gas / heating" : "Acqua / gas / riscaldamento", value: profile.utilitiesWaterGas, help: isEn ? "Average monthly utilities outside electricity." : "Media mensile utenze escluse corrente." })}
        ${moneyInput({ id: "gold-cost-accountant", label: isEn ? "Accountant" : "Commercialista", value: profile.accountant, help: isEn ? "Monthly average of accounting and payroll support." : "Media mensile contabilita, paghe e consulenza." })}
        ${moneyInput({ id: "gold-cost-insurance", label: isEn ? "Insurance" : "Assicurazioni", value: profile.insurance, help: isEn ? "Civil liability, shop, equipment policies." : "RC, locale, attrezzature e polizze collegate." })}
        ${moneyInput({ id: "gold-cost-software", label: isEn ? "Software / subscriptions" : "Software / abbonamenti", value: profile.software, help: isEn ? "Management tools, booking, phone, cloud, subscriptions." : "Gestionali, booking, telefono, cloud, abbonamenti." })}
        ${moneyInput({ id: "gold-cost-marketing", label: "Marketing", value: profile.marketing, help: isEn ? "Ads, content, agency, local communication." : "Ads, contenuti, agenzia, comunicazione locale." })}
        ${moneyInput({ id: "gold-cost-cleaningLaundry", label: isEn ? "Cleaning / laundry" : "Pulizie / lavanderia", value: profile.cleaningLaundry, help: isEn ? "Cleaning service, towels, laundry, sanitation consumables." : "Pulizie, asciugamani, lavanderia, consumabili igiene." })}
        ${moneyInput({ id: "gold-cost-bankPosFees", label: isEn ? "Bank / POS fees" : "Banca / POS", value: profile.bankPosFees, help: isEn ? "Monthly average of banking and payment fees." : "Media mensile commissioni banca e pagamenti." })}
        ${moneyInput({ id: "gold-cost-taxesContributionsReserve", label: isEn ? "Tax/contribution reserve" : "Riserva tasse/contributi", value: profile.taxesContributionsReserve, help: isEn ? "Prudential monthly reserve entered by the center/accountant." : "Accantonamento prudenziale mensile inserito dal centro/commercialista." })}
        ${moneyInput({ id: "gold-cost-otherFixedCosts", label: isEn ? "Other fixed costs" : "Altri costi fissi", value: profile.otherFixedCosts, help: isEn ? "Security, waste, licences, association fees, maintenance." : "Allarme, rifiuti, licenze, associazioni, manutenzioni." })}
        <label class="smart-field">
          <span class="smart-field-label">${isEn ? "Working days / month" : "Giorni lavorativi mese"}</span>
          <input id="gold-cost-workingDaysMonthly" class="sh-input gold-cost-minute-input" data-gold-cost-field="workingDaysMonthly" type="number" min="1" step="1" value="${Number(profile.workingDaysMonthly || 0)}">
          <small class="smart-field-help">${isEn ? "Real open days used to spread fixed costs." : "Giorni reali di apertura su cui distribuire i costi fissi."}</small>
        </label>
        <label class="smart-field">
          <span class="smart-field-label">${isEn ? "Operating hours / day" : "Ore operative giorno"}</span>
          <input id="gold-cost-operatingHoursDaily" class="sh-input gold-cost-minute-input" data-gold-cost-field="operatingHoursDaily" type="number" min="1" step="0.5" value="${Number(profile.operatingHoursDaily || 0)}">
          <small class="smart-field-help">${isEn ? "Hours where the center can actually produce revenue." : "Ore in cui il centro puo davvero produrre incasso."}</small>
        </label>
        <label class="smart-field">
          <span class="smart-field-label">IVA %</span>
          <input id="gold-cost-vatRate" class="sh-input gold-cost-minute-input" data-gold-cost-field="vatRate" type="number" min="0" step="1" value="${Number(profile.vatRate ?? 22)}">
          <small class="smart-field-help">${isEn ? "Default operational reference is 22%; change it only if your accountant indicates otherwise." : "Riferimento operativo predefinito 22%; cambialo solo se il commercialista indica diversamente."}</small>
        </label>
      </div>
      <div class="row gap-8 mt-16 wrap-mobile">
        <button class="sh-button" data-action="save-gold-cost-minute" type="button">${isEn ? "Save Gold cost profile" : "Salva profilo costi Gold"}</button>
        <button class="sh-button secondary-btn" data-action="reset-gold-cost-minute" type="button">${isEn ? "Reset fields" : "Svuota campi"}</button>
      </div>
    </section>
  `;
}

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
    profitabilityStatusLabel,
    currentPlanId,
    currentLanguage
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

      ${renderGoldCostMinutePanel({ state, overview, currentPlanId, currentLanguage, euroFromCents, escapeHtml })}

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
