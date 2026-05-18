export function renderCashdeskView(deps) {
  const {
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
  } = deps;

  const payments = activeCashdeskPayments();
  const openAppointments = cashdeskOpenAppointments();
  const sessionsToVerify = cashdeskClosedSessionsToVerify();
  const dayPayments = (state.sales || []).filter((item) => String(item.date || "") === state.cashdeskDate);
  const dayRevenue = dayPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const linkedSessions = state.appointments.filter((item) => item.date === state.cashdeskDate && String(item.status || "").toLowerCase() === "completed").length;
  const openSessions = state.appointments.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return item.date === state.cashdeskDate && status !== "completed" && status !== "cancelled" && status !== "no_show";
  }).length;
  const historySummary = cashdeskHistorySummary(payments);
  const dailyCheck = cashdeskDailyCheck(dayPayments, openSessions, linkedSessions);
  const unresolvedCount = dailyCheck.blockers.length + sessionsToVerify.length;
  const closureReady = unresolvedCount === 0;
  const methods = ["cash", "card", "mixed", "bank_transfer"].map((method) => ({
    method,
    count: dayPayments.filter((item) => String(item.channel || "") === method).length,
    amount: dayPayments.filter((item) => String(item.channel || "") === method).reduce((sum, item) => sum + Number(item.amount || 0), 0)
  }));

  return `
    <div class="two-col">
      <section class="card">
        <div class="section-title">${t("cashdeskView.title")}</div>
        <div class="page-subtitle mt-16">${t("cashdeskView.subtitle")}</div>
        <div class="stack mt-16">
          <div class="stat-label">${t("cashdeskView.dayLabel")}</div>
          <input id="cashdesk-date" class="sh-input" type="date" value="${escapeHtml(state.cashdeskDate)}">
        </div>
        <div class="dashboard-focus-grid mt-16">
          <div class="dashboard-focus-item"><div class="stat-label">${t("cashdeskView.dayRevenue")}</div><div class="focus-value">${euro(dayRevenue)}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("cashdeskView.paymentsCount")}</div><div class="focus-value">${dayPayments.length}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("cashdeskView.linkedSessions")}</div><div class="focus-value">${linkedSessions}</div></div>
        </div>
        <div class="dashboard-focus-grid mt-16">
          <div class="dashboard-focus-item"><div class="stat-label">${t("cashdeskView.openSessions")}</div><div class="focus-value">${openSessions}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("cashdeskView.dailyCheck")}</div><div class="focus-value">${dailyCheck.label}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("aiGoldView.risk")}</div><div class="focus-value">${dailyCheck.risk}</div></div>
        </div>
        <div class="dashboard-focus-grid mt-16">
          <div class="dashboard-focus-item"><div class="stat-label">${t("cashdeskView.closureTitle")}</div><div class="focus-value">${closureReady ? t("cashdeskView.closureReady") : t("cashdeskView.closureNotReady")}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("cashdeskView.unresolvedCount")}</div><div class="focus-value">${unresolvedCount}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("cashdeskView.sessionsToVerify")}</div><div class="focus-value">${sessionsToVerify.length}</div></div>
        </div>
        <div class="module-state-grid mt-16">
          ${methods.map((item) => `
            <div class="module-state-card ${item.count ? "is-enabled" : "is-locked"}">
              <div class="module-state-badge ${item.count ? "enabled" : "locked"}">${methodLabel(item.method)}</div>
              <div class="item-title mt-16">${euro(item.amount)}</div>
              <div class="item-subtitle">${item.count} ${t("cashdeskView.paymentsCount").toLowerCase()}</div>
            </div>
          `).join("")}
        </div>
        <div class="consultation-box mt-16">
          <div class="stat-label">${t("cashdeskView.closureTitle")}</div>
          <div>${closureReady ? t("cashdeskView.closureCopyReady") : t("cashdeskView.closureCopyNotReady")}</div>
        </div>
        <div class="consultation-box mt-16">
          <div class="stat-label">${t("cashdeskView.dailyCheck")}</div>
          <div>${dailyCheck.summary}</div>
          ${dailyCheck.blockers.length ? `
            <div class="list mt-16">
              <div class="item-subtitle">${t("cashdeskView.blockersTitle")}</div>
              ${dailyCheck.blockers.map((item) => `
                <div class="list-item">
                  <div class="item-title">${escapeHtml(item)}</div>
                </div>
              `).join("")}
            </div>
          ` : ""}
        </div>
        <div class="consultation-box mt-16">
          <div class="stat-label">${t("cashdeskView.sessionsToVerify")}</div>
          <div class="item-subtitle mt-16">${t("cashdeskView.verifierHint")}</div>
          ${sessionsToVerify.length ? `
            <div class="list mt-16">
              ${sessionsToVerify.slice(0, 5).map((item) => `
                <div class="list-item">
                  <div class="item-title">${escapeHtml(item.client || t("agendaView.client"))} · ${escapeHtml(item.service || t("agendaView.service"))}</div>
                  <div class="item-subtitle">${escapeHtml(item.date)} · ${escapeHtml(item.time)} · ${escapeHtml(item.operator || "--")}</div>
                </div>
              `).join("")}
            </div>
          ` : `<div class="mt-16">${t("cashdeskView.noSessionsToVerify")}</div>`}
        </div>
        <div class="consultation-box mt-16">
          <div class="stat-label">${t("cashdeskView.paymentsOfDay")}</div>
          ${dayPayments.length ? `
            <div class="list mt-16">
              ${dayPayments.slice(0, 5).map((item) => `
                <div class="list-item">
                  <div class="item-title">${escapeHtml(item.client || t("agendaView.client"))} · ${euro(item.amount || 0)}</div>
                  <div class="item-subtitle">${escapeHtml(item.service || t("agendaView.service"))} · ${escapeHtml(methodLabel(item.channel))}</div>
                </div>
              `).join("")}
            </div>
          ` : `<div class="mt-16">${t("cashdeskView.noPayments")}</div>`}
        </div>
        <div class="section-title mt-16">${t("cashdeskView.registerPayment")}</div>
        <div class="stack mt-16">
          <select id="cashdesk-client" class="sh-select">
            <option value="">${t("cashdeskView.selectClient")}</option>
            ${state.clients.map((item) => `<option value="${escapeHtml(item.id)}" ${state.cashdeskClientId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
          </select>
          <select id="cashdesk-appointment" class="sh-select">
            <option value="">${t("cashdeskView.selectAppointment")}</option>
            ${openAppointments.map((item) => `<option value="${escapeHtml(item.id)}" ${state.cashdeskAppointmentId === item.id ? "selected" : ""}>${escapeHtml(`${item.date} · ${item.time} · ${item.client} · ${item.service}`)}</option>`).join("")}
          </select>
          <input id="cashdesk-amount" class="sh-input" type="text" inputmode="decimal" placeholder="${escapeHtml(t("cashdeskView.amount"))}" value="${escapeHtml(state.cashdeskAmount)}">
          <select id="cashdesk-method" class="sh-select">
            <option value="cash" ${state.cashdeskMethod === "cash" ? "selected" : ""}>${t("cashdeskView.cash")}</option>
            <option value="card" ${state.cashdeskMethod === "card" ? "selected" : ""}>${t("cashdeskView.card")}</option>
            <option value="mixed" ${state.cashdeskMethod === "mixed" ? "selected" : ""}>${t("cashdeskView.mixed")}</option>
            <option value="bank_transfer" ${state.cashdeskMethod === "bank_transfer" ? "selected" : ""}>${t("cashdeskView.bank")}</option>
          </select>
          <input id="cashdesk-description" class="sh-input" type="text" placeholder="${escapeHtml(t("cashdeskView.description"))}" value="${escapeHtml(state.cashdeskDescription)}">
          <button class="sh-button" data-action="save-cashdesk-payment" type="button">${t("cashdeskView.savePayment")}</button>
        </div>
        <div class="consultation-box mt-16">
          <div class="stat-label">${t("cashdeskView.openAppointmentsList")}</div>
          ${openAppointments.length ? `
            <div class="list mt-16">
              ${openAppointments.slice(0, 5).map((item) => `
                <div class="list-item">
                  <div class="item-title">${escapeHtml(item.client)} · ${escapeHtml(item.service)}</div>
                  <div class="item-subtitle">${escapeHtml(item.date)} · ${escapeHtml(item.time)} · ${escapeHtml(appointmentStatusLabel(item.status))}</div>
                </div>
              `).join("")}
            </div>
          ` : `<div class="mt-16">${t("cashdeskView.noOpenAppointments")}</div>`}
        </div>
      </section>
      <section class="card">
        <div class="row between mb-16">
          <div class="section-title">${t("cashdeskView.clientHistory")}</div>
          <div class="module-pill">${state.cashdeskClientId ? t("cashdeskView.historyScopeClient") : t("cashdeskView.historyScopeGlobal")}</div>
        </div>
        <div class="dashboard-focus-grid mb-16">
          <div class="dashboard-focus-item"><div class="stat-label">${t("cashdeskView.paymentsCount")}</div><div class="focus-value">${historySummary.count}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("cashdeskView.historyRevenue")}</div><div class="focus-value">${euro(historySummary.total)}</div></div>
          <div class="dashboard-focus-item"><div class="stat-label">${t("cashdeskView.historyLatest")}</div><div class="focus-value">${escapeHtml(historySummary.latestDate)}</div></div>
        </div>
        <div class="list">
          ${payments.map((item) => `
            <div class="list-item">
              <div class="item-title">${escapeHtml(item.client || t("agendaView.client"))} · ${euro(item.amount || 0)}</div>
              <div class="item-subtitle">${escapeHtml(item.date || "--")} · ${escapeHtml(item.service || t("agendaView.service"))} · ${escapeHtml(methodLabel(item.channel))}</div>
            </div>
          `).join("") || `<div class="settings-note">${state.cashdeskClientId ? t("cashdeskView.noClientPayments") : t("cashdeskView.noPayments")}</div>`}
        </div>
      </section>
    </div>
  `;
}
