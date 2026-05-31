export function renderAgendaView(deps) {
  const {
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
  } = deps;

  const staff = state.staff.filter((item) => item.active);
  const hours = agendaHours();
  const appointments = currentAgendaAppointments();

  const heads = staff.map((operator) => `
    <div class="agenda-col">
      <div class="agenda-head">${escapeHtml(operator.name)}<small>${escapeHtml(operator.role)}</small></div>
      <div class="agenda-track" style="height:${hours.length * 78}px;">
        ${hours.map((hour) => `<button class="agenda-slot ${state.selectedSlot?.time === hour && state.selectedSlot?.operator === operator.name ? "active" : ""}" data-action="select-slot" data-time="${hour}" data-operator="${escapeHtml(operator.name)}" type="button"></button>`).join("")}
        ${appointments.filter((item) => item.operator === operator.name).map((item) => `
          <article class="agenda-event ${state.selectedAppointmentId === item.id ? "active" : ""}" data-action="select-appointment" data-id="${escapeHtml(item.id)}" style="${appointmentStyle(item)} background:${appointmentColor(item)};">
            <div class="agenda-event-client">${escapeHtml(item.client)}</div>
            <div class="agenda-event-services">${escapeHtml(item.service)}</div>
            <div class="agenda-event-meta">${escapeHtml(item.time)} · ${escapeHtml(item.room || t("agendaView.roomFallback"))}</div>
            <div class="agenda-event-meta">${escapeHtml(appointmentStatusLabel(item.status))}</div>
          </article>
        `).join("")}
      </div>
    </div>
  `).join("");

  return `
    <div class="agenda-layout">
      <section class="card agenda-shell">
        <div class="agenda-toolbar">
          <div>
            <div class="section-title">${t("agendaView.title")}</div>
            <div class="page-subtitle">${t("agendaView.subtitle")}</div>
          </div>
          <div class="action-row">
            <button class="sh-button secondary-btn" data-action="toggle-agenda-fullscreen" type="button">${state.fullScreenAgenda ? t("agendaView.exitFullScreen") : t("agendaView.fullScreen")}</button>
            <input id="agenda-date-input" class="sh-input" type="date" value="${escapeHtml(state.agendaDate)}">
            <button class="sh-button secondary-btn" data-action="today" type="button">${t("agendaView.today")}</button>
          </div>
        </div>
        <div class="agenda-desktop">
          <div class="agenda-grid" style="--agenda-columns:${staff.length};">
            <div class="agenda-time-col">
              <div class="agenda-head">${t("agendaView.schedule")}</div>
              ${hours.map((hour) => `<div class="agenda-time">${escapeHtml(hour)}</div>`).join("")}
            </div>
            ${heads}
          </div>
        </div>
        ${renderAgendaMobile(staff, hours, appointments)}
      </section>
      ${renderAppointmentDrawer()}
    </div>
  `;
}
