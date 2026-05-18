export function renderClientsView(deps) {
  const {
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
  } = deps;

  const selectedClient = state.clients.find((item) => item.id === state.selectedClientId) || null;
  const selectedAppointments = clientAppointments(selectedClient);
  const selectedPayments = clientPayments(selectedClient);
  const latestAppointments = selectedAppointments.slice(0, 4);
  const latestPayments = selectedPayments.slice(0, 4);
  const upcomingAppointment = selectedAppointments.find((item) => String(item.status || "").toLowerCase() !== "completed" && String(item.status || "").toLowerCase() !== "cancelled");
  const totalPayments = selectedPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const continuity = clientContinuityStatus(selectedAppointments, selectedPayments);
  const goldPrimary = state.goldDecisionContext?.primaryAction?.label || t("aiGoldView.monitorCenter");
  const goldRisk = state.goldDecisionContext?.risk?.band ? riskBandLabel(state.goldDecisionContext.risk.band) : riskBandLabel("low");
  const goldAction = clientGoldAction(selectedClient, continuity, upcomingAppointment, totalPayments);

  return `
    <div class="two-col">
      <section class="card">
        <div class="row between mb-16">
          <div class="section-title">${t("clientsView.title")}</div>
          <button class="sh-button" data-action="new-client" type="button">${t("clientsView.newClient")}</button>
        </div>
        <input id="client-search" class="sh-input mb-16" type="text" placeholder="${escapeHtml(t("clientsView.searchPlaceholder"))}" value="${escapeHtml(state.clientSearch)}">
        <div class="list">
          ${filteredClients().map((client) => `
            <div class="list-item">
              <div class="list-item-head">
                <div>
                  <div class="item-title">${escapeHtml(client.name)}</div>
                  <div class="item-subtitle">${escapeHtml(client.phone || t("clientsView.noPhone"))} · ${escapeHtml(client.email || t("clientsView.noEmail"))}</div>
                </div>
                <div class="action-row">
                  <button class="sh-button secondary-btn" data-action="select-client" data-id="${escapeHtml(client.id)}" type="button">${t("clientsView.open")}</button>
                  <button class="sh-button secondary-btn" data-action="edit-client" data-id="${escapeHtml(client.id)}" type="button">${t("clientsView.edit")}</button>
                </div>
              </div>
            </div>
          `).join("")}
        </div>
      </section>
      <section class="card">
        ${selectedClient ? `
          <div class="section-title">${t("clientsView.detailTitle")}</div>
          <div class="settings-note mt-16">${t("clientsView.detailCopy")}</div>
          <div class="compact-stack mt-16">
            <div class="consultation-box">
              <div class="item-title">${escapeHtml(selectedClient.name)}</div>
              <div class="item-subtitle">${escapeHtml(selectedClient.phone || t("clientsView.noPhone"))} · ${escapeHtml(selectedClient.email || t("clientsView.noEmail"))}</div>
            </div>
            <div class="drawer-stats">
              <div class="consultation-box"><div class="stat-label">${t("clientsView.lastVisit")}</div><div>${escapeHtml(selectedClient.lastVisit || t("clientsView.noLastVisit"))}</div></div>
              <div class="consultation-box"><div class="stat-label">${t("clientsView.totalValue")}</div><div>${euro(selectedClient.totalValue || 0)}</div></div>
            </div>
            <div class="drawer-stats">
              <div class="consultation-box"><div class="stat-label">${t("clientsView.upcomingSession")}</div><div>${escapeHtml(upcomingAppointment ? `${upcomingAppointment.date} · ${upcomingAppointment.time}` : t("clientsView.noAppointments"))}</div></div>
              <div class="consultation-box"><div class="stat-label">${t("clientsView.totalPayments")}</div><div>${euro(totalPayments)}</div></div>
            </div>
            <div class="consultation-box">
              <div class="stat-label">${t("clientsView.continuityTitle")}</div>
              <div class="item-title">${escapeHtml(continuity.label)}</div>
              <div class="item-subtitle">${escapeHtml(continuity.copy)}</div>
            </div>
            <div class="consultation-box">
              <div class="stat-label">${t("clientsView.preferences")}</div>
              <div>${escapeHtml(selectedClient.preferences?.join(", ") || t("clientsView.noPreferences"))}</div>
            </div>
            <div class="consultation-box">
              <div class="stat-label">${t("clientsView.activePlans")}</div>
              <div>${escapeHtml(selectedClient.activePlans?.join(", ") || t("clientsView.noActivePlans"))}</div>
            </div>
            <div class="consultation-box">
              <div class="stat-label">${t("clientsView.notes")}</div>
              <div>${escapeHtml(selectedClient.notes || t("clientsView.noNotes"))}</div>
            </div>
            <div class="consultation-box">
              <div class="stat-label">${t("clientsView.recentAppointments")}</div>
              ${latestAppointments.length ? `
                <div class="list mt-16">
                  ${latestAppointments.map((item) => `
                    <div class="list-item">
                      <div class="item-title">${escapeHtml(item.date)} · ${escapeHtml(item.time)}</div>
                      <div class="item-subtitle">${escapeHtml(item.service)} · ${escapeHtml(appointmentStatusLabel(item.status))}</div>
                    </div>
                  `).join("")}
                </div>
              ` : `<div>${t("clientsView.noAppointments")}</div>`}
            </div>
            <div class="consultation-box">
              <div class="stat-label">${t("clientsView.paymentsTitle")}</div>
              ${latestPayments.length ? `
                <div class="list mt-16">
                  ${latestPayments.map((item) => `
                    <div class="list-item">
                      <div class="item-title">${escapeHtml(item.date || "--")}</div>
                      <div class="item-subtitle">${escapeHtml(item.service || t("agendaView.service"))} · ${euro(item.amount || 0)} · ${escapeHtml(String(item.channel || "pos"))}</div>
                    </div>
                  `).join("")}
                </div>
              ` : `<div>${t("clientsView.noPayments")}</div>`}
            </div>
            <div class="consultation-box">
              <div class="stat-label">${t("clientsView.goldReadingTitle")}</div>
              <div class="item-title">${escapeHtml(goldPrimary)}</div>
              <div class="item-subtitle">${escapeHtml(`${t("aiGoldView.risk")}: ${goldRisk}`)}</div>
            </div>
            <div class="consultation-box">
              <div class="stat-label">${t("clientsView.goldActionTitle")}</div>
              <div class="item-title">${escapeHtml(goldAction.title)}</div>
              <div class="item-subtitle">${escapeHtml(goldAction.blocked ? goldAction.reason : goldAction.message)}</div>
              <div class="action-row mt-16">
                <button class="sh-button secondary-btn" data-action="copy-client-message" type="button" ${goldAction.blocked ? "disabled" : ""}>${t("clientsView.copyMessage")}</button>
              </div>
            </div>
            <div class="consultation-box">
              <div class="stat-label">${t("clientsView.dossierTitle")}</div>
              <div class="drawer-stats mt-16">
                <div class="consultation-box"><div class="stat-label">${t("clientsView.loyaltyTier")}</div><div>${escapeHtml(selectedClient.loyaltyTier || "base")}</div></div>
                <div class="consultation-box"><div class="stat-label">${t("clientsView.photoStatus")}</div><div>${escapeHtml(selectedClient.photoStatus || t("clientsView.noPhotoStatus"))}</div></div>
              </div>
              <div class="drawer-stats mt-16">
                <div class="consultation-box"><div class="stat-label">${t("clientsView.recallTitle")}</div><div>${escapeHtml(selectedClient.recallDue || t("clientsView.noRecall"))}</div></div>
                <div class="consultation-box"><div class="stat-label">${t("clientsView.recommendedProtocol")}</div><div>${escapeHtml(selectedClient.recommendedProtocol || t("clientsView.noProtocol"))}</div></div>
              </div>
              <div class="consultation-box mt-16">
                <div class="stat-label">${t("clientsView.allergies")}</div>
                <div>${escapeHtml(selectedClient.allergies || t("clientsView.noAllergies"))}</div>
              </div>
              <div class="consultation-box mt-16">
                <div class="stat-label">${t("clientsView.consentTitle")}</div>
                <div class="item-subtitle">
                  Privacy: ${escapeHtml(selectedClient.privacyConsent ? t("clientsView.yes") : t("clientsView.no"))}
                  · Marketing: ${escapeHtml(selectedClient.marketingConsent ? t("clientsView.yes") : t("clientsView.no"))}
                  · Sensibili: ${escapeHtml(selectedClient.sensitiveDataConsent ? t("clientsView.yes") : t("clientsView.no"))}
                </div>
              </div>
            </div>
            <div class="consultation-box">
              <div class="stat-label">${t("clientsView.nextStepTitle")}</div>
              <div>${t("clientsView.nextStepAgenda")}</div>
              <div class="item-subtitle mt-16">${t("clientsView.nextStepGold")}</div>
              <div class="action-row mt-16">
                <button class="sh-button secondary-btn" data-action="open-client-agenda" data-id="${escapeHtml(selectedClient.id)}" type="button">${t("clientsView.openAgenda")}</button>
                <button class="sh-button secondary-btn" data-action="open-client-gold" type="button">${t("clientsView.openGold")}</button>
              </div>
            </div>
          </div>
        ` : `
          <div class="section-title">${t("clientsView.controlTitle")}</div>
          <div class="settings-note mt-16">${t("clientsView.controlCopy")}</div>
          <div class="settings-note mt-16">${t("clientsView.noClientSelected")}</div>
          <div class="dashboard-focus-grid mt-16">
            <div class="dashboard-focus-item"><div class="stat-label">${t("clientsView.activeClients")}</div><div class="focus-value">${state.clients.length}</div></div>
            <div class="dashboard-focus-item"><div class="stat-label">${t("clientsView.premium")}</div><div class="focus-value">${state.clients.filter((item) => item.totalValue >= 500).length}</div></div>
            <div class="dashboard-focus-item"><div class="stat-label">${t("clientsView.recall")}</div><div class="focus-value">${state.clients.filter((item) => item.recallDue).length}</div></div>
          </div>
        `}
      </section>
    </div>
  `;
}
