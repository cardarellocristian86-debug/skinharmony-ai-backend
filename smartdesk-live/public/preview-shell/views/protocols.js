export function renderProtocolsView(deps) {
  const {
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
  } = deps;

  const protocolsEnabled = moduleEnabled("protocols");
  const treatmentsEnabled = moduleEnabled("treatments");
  if (!protocolsEnabled && !treatmentsEnabled) {
    return renderLockedModule({
      title: t("protocolsView.lockedTitle"),
      detail: t("protocolsView.lockedCopy"),
      hint: t("protocolsView.lockedNote")
    });
  }

  const treatments = Array.isArray(state.treatments) ? state.treatments : [];
  const planId = currentPlanId();
  const quotaLabel = planId === "silver" ? t("protocolsView.quotaSilver") : planId === "gold" || planId === "enterprise" ? t("protocolsView.quotaGold") : t("protocolsView.aiProtocolManual");
  const planNote = planId === "silver" ? t("protocolsView.planSilver") : planId === "gold" || planId === "enterprise" ? t("protocolsView.planGold") : t("protocolsView.planBase");

  return `
    <div class="stack">
      ${renderEnterpriseBanner()}
      <section class="card">
        <div class="row between mb-16">
          <div>
            <div class="section-title">${t("protocolsView.title")}</div>
            <div class="page-subtitle">${t("protocolsView.subtitle")}</div>
          </div>
          <div class="hero-badges">
            <div class="module-pill active">${escapeHtml(String(planId).toUpperCase())}</div>
            <div class="module-pill ${protocolsEnabled ? "active" : ""}">${protocolsEnabled ? t("protocolsView.hubStatus") : t("protocolsView.hubInactive")}</div>
            <button class="sh-button secondary-btn" data-action="refresh-protocols" type="button">${t("protocolsView.refreshView")}</button>
          </div>
        </div>
      </section>

      <div class="settings-grid">
        <section class="card">
          <div class="section-title">${t("protocolsView.planScope")}</div>
          <div class="settings-note mt-16">${planNote}</div>
        </section>

        <section class="card">
          <div class="section-title">${t("protocolsView.moduleStatus")}</div>
          <div class="module-state-grid mt-16">
            ${renderModuleStateCard({ key: "protocols", title: t("protocolsView.title"), enabledCopy: t("servicesView.protocolsEnabled"), lockedCopy: t("servicesView.protocolsLocked") })}
            ${renderModuleStateCard({ key: "treatments", title: t("servicesView.treatmentsTitle"), enabledCopy: t("servicesView.treatmentsEnabled"), lockedCopy: t("servicesView.treatmentsLocked") })}
          </div>
          <div class="module-pills mt-16">
            <div class="module-pill ${planId === "base" ? "" : "active"}">${t("protocolsView.aiProtocolStatus")} · ${quotaLabel}</div>
          </div>
        </section>
      </div>

      <div class="settings-grid">
        <section class="card">
          <div class="section-title mb-16">${t("protocolsView.protocolRepository")}</div>
          <div class="settings-note">${t("protocolsView.repositoryCopy")}</div>
          <div class="settings-note mt-16">${t("protocolsView.personalizationCopy")}</div>
          <div class="settings-note mt-16">${t("protocolsView.trainingCopy")}</div>
          <div class="action-row mt-16">
            <button class="sh-button secondary-btn" data-view-link="clients" type="button">${t("protocolsView.openClients")}</button>
            <button class="sh-button secondary-btn" data-view-link="appointments" type="button">${t("protocolsView.openAgenda")}</button>
            ${canUseAiGold() ? `<button class="sh-button secondary-btn" data-view-link="ai-gold" type="button">${t("protocolsView.openAiGold")}</button>` : ""}
          </div>
        </section>

        <section class="card">
          <div class="section-title mb-16">${t("protocolsView.recentTreatments")}</div>
          <div class="list">
            ${treatments.length ? treatments.slice(0, 8).map((item) => {
              const client = state.clients.find((entry) => entry.id === item.clientId);
              return `
                <div class="list-item static">
                  <div>
                    <div class="item-title">${escapeHtml(client?.name || t("agendaView.client"))}</div>
                    <div class="item-subtitle">${t("protocolsView.treatmentLine", { date: new Date(item.createdAt).toLocaleDateString(currentLocale()), operator: item.operatorName || t("agendaView.operator") })}</div>
                    <div class="item-subtitle">${t("protocolsView.treatmentDetailLine", { protocol: item.protocolUsed || t("clientsView.noProtocol"), technology: item.technologyUsed || "--" })}</div>
                  </div>
                </div>
              `;
            }).join("") : `<div class="settings-note">${t("protocolsView.noTreatments")}</div>`}
          </div>
        </section>
      </div>

      <div class="settings-grid">
        <section class="card">
          <div class="section-title mb-16">${t("protocolsView.treatmentSheet")}</div>
          <div class="stack">
            <select id="treatment-client-id" class="sh-select">
              <option value="">${t("protocolsView.selectClient")}</option>
              ${state.clients.map((item) => `<option value="${escapeHtml(item.id)}" ${state.treatmentClientId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
            </select>
            <input id="treatment-operator-name" class="sh-input" type="text" placeholder="${escapeHtml(t("protocolsView.operator"))}" value="${escapeHtml(state.treatmentOperatorName)}">
            <input id="treatment-products-used" class="sh-input" type="text" placeholder="${escapeHtml(t("protocolsView.productsUsed"))}" value="${escapeHtml(state.treatmentProductsUsed)}">
            <input id="treatment-technology-used" class="sh-input" type="text" placeholder="${escapeHtml(t("protocolsView.technologyUsed"))}" value="${escapeHtml(state.treatmentTechnologyUsed)}">
            <input id="treatment-protocol-used" class="sh-input" type="text" placeholder="${escapeHtml(t("protocolsView.protocolUsed"))}" value="${escapeHtml(state.treatmentProtocolUsed)}">
            <input id="treatment-photo-path" class="sh-input" type="text" placeholder="${escapeHtml(t("protocolsView.photoPath"))}" value="${escapeHtml(state.treatmentPhotoPath)}">
            <input id="treatment-result-notes" class="sh-input" type="text" placeholder="${escapeHtml(t("protocolsView.resultNotes"))}" value="${escapeHtml(state.treatmentResultNotes)}">
            <button class="sh-button" data-action="save-treatment" type="button">${t("protocolsView.saveTreatment")}</button>
          </div>
        </section>

        <section class="card">
          <div class="section-title mb-16">${t("protocolsView.operationalSteps")}</div>
          <div class="list">
            <div class="list-item static"><div><div class="item-title">${t("protocolsView.stepOneTitle")}</div><div class="item-subtitle">${t("protocolsView.stepOneCopy")}</div></div></div>
            <div class="list-item static"><div><div class="item-title">${t("protocolsView.stepTwoTitle")}</div><div class="item-subtitle">${t("protocolsView.stepTwoCopy")}</div></div></div>
            <div class="list-item static"><div><div class="item-title">${t("protocolsView.stepThreeTitle")}</div><div class="item-subtitle">${t("protocolsView.stepThreeCopy")}</div></div></div>
          </div>
        </section>
      </div>
    </div>
  `;
}
