export function bindAgendaViewEvents(deps) {
  const {
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
  } = deps;

  document.getElementById("agenda-date-input")?.addEventListener("change", (event) => {
    state.agendaDate = event.target.value;
    state.selectedAppointmentId = null;
    state.selectedSlot = null;
    renderView();
  });

  document.querySelectorAll('[data-action="select-slot"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSlot = { time: button.dataset.time, operator: button.dataset.operator };
      state.selectedAppointmentId = null;
      state.agendaDrawerTab = "appointment";
      renderView();
    });
  });

  document.querySelectorAll('[data-action="select-appointment"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAppointmentId = button.dataset.id;
      state.selectedSlot = null;
      state.agendaDrawerTab = "appointment";
      renderView();
    });
  });

  document.querySelector('[data-action="new-appointment-slot"]')?.addEventListener("click", () => openAppointmentDialog(state.selectedSlot));
  document.querySelector('[data-action="new-client-from-slot"]')?.addEventListener("click", () => openClientDialog());
  document.querySelectorAll('[data-action="clear-agenda-selection"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAppointmentId = null;
      state.selectedSlot = null;
      state.agendaDrawerTab = "appointment";
      renderView();
    });
  });
  document.querySelector('[data-action="today"]')?.addEventListener("click", () => {
    state.agendaDate = new Date().toISOString().slice(0, 10);
    renderView();
  });
  document.querySelector('[data-action="toggle-agenda-fullscreen"]')?.addEventListener("click", () => {
    state.fullScreenAgenda = !state.fullScreenAgenda;
    renderView();
  });
  document.querySelectorAll('[data-action="set-agenda-tab"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.agendaDrawerTab = button.dataset.tab || "appointment";
      renderView();
    });
  });
  document.querySelector('[data-action="mark-arrived"]')?.addEventListener("click", () => {
    if (state.selectedAppointmentId) {
      void updateAppointment(state.selectedAppointmentId, { status: "arrived" });
    }
  });
  document.querySelector('[data-action="checkout-appointment"]')?.addEventListener("click", () => {
    if (state.selectedAppointmentId) {
      void checkoutAppointment(state.selectedAppointmentId);
    }
  });
  document.querySelector('[data-action="mark-completed"]')?.addEventListener("click", () => {
    if (state.selectedAppointmentId) {
      void updateAppointment(state.selectedAppointmentId, { status: "completed" });
    }
  });
  document.querySelector('[data-action="mark-no-show"]')?.addEventListener("click", () => {
    if (state.selectedAppointmentId) {
      void updateAppointment(state.selectedAppointmentId, { status: "no_show" });
    }
  });
  document.querySelector('[data-action="cancel-appointment"]')?.addEventListener("click", () => {
    if (state.selectedAppointmentId) {
      void updateAppointment(state.selectedAppointmentId, { status: "cancelled" });
    }
  });
  document.querySelector('[data-action="move-appointment"]')?.addEventListener("click", () => {
    if (state.selectedAppointmentId) {
      void moveAppointment(state.selectedAppointmentId);
    }
  });
  document.querySelector('[data-action="add-technical-note"]')?.addEventListener("click", () => {
    if (state.selectedAppointmentId) {
      void addTechnicalNoteToAppointment(state.selectedAppointmentId);
    }
  });
  document.querySelector('[data-action="delete-appointment"]')?.addEventListener("click", () => {
    if (state.selectedAppointmentId) {
      void deleteAppointment(state.selectedAppointmentId);
    }
  });
  document.querySelector('[data-action="open-client-detail"]')?.addEventListener("click", () => {
    const appointment = state.appointments.find((item) => item.id === state.selectedAppointmentId);
    const client = appointment ? findClientForAppointment(appointment) : null;
    state.selectedClientId = client?.id || null;
    state.clientSearch = client?.name || appointment?.client || "";
    state.currentView = "clients";
    renderView();
  });
}

export function bindClientsViewEvents(deps) {
  const {
    state,
    renderView,
    openClientDialog,
    clientAppointments,
    copyClientMessageToClipboard
  } = deps;

  document.getElementById("client-search")?.addEventListener("input", (event) => {
    state.clientSearch = event.target.value;
    renderView();
  });
  document.querySelector('[data-action="new-client"]')?.addEventListener("click", () => openClientDialog());
  document.querySelectorAll('[data-action="select-client"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedClientId = button.dataset.id;
      renderView();
    });
  });
  document.querySelectorAll('[data-action="edit-client"]').forEach((button) => {
    button.addEventListener("click", () => {
      const client = state.clients.find((item) => item.id === button.dataset.id);
      if (client) openClientDialog(client);
    });
  });
  document.querySelector('[data-action="open-client-agenda"]')?.addEventListener("click", () => {
    const client = state.clients.find((item) => item.id === state.selectedClientId);
    if (client) {
      state.currentView = "appointments";
      const upcoming = clientAppointments(client).find((item) => String(item.status || "").toLowerCase() !== "completed" && String(item.status || "").toLowerCase() !== "cancelled");
      if (upcoming) {
        state.agendaDate = upcoming.date;
        state.selectedAppointmentId = upcoming.id;
        state.selectedSlot = null;
        state.agendaDrawerTab = "appointment";
      }
      renderView();
    }
  });
  document.querySelector('[data-action="open-client-gold"]')?.addEventListener("click", () => {
    state.currentView = "ai-gold";
    renderView();
  });
  document.querySelector('[data-action="copy-client-message"]')?.addEventListener("click", () => {
    void copyClientMessageToClipboard();
  });
}

export function bindCashdeskViewEvents(deps) {
  const {
    state,
    renderView,
    findClientForAppointment,
    saveCashdeskPayment
  } = deps;

  document.getElementById("cashdesk-date")?.addEventListener("change", (event) => {
    state.cashdeskDate = event.target.value;
    state.cashdeskAppointmentId = "";
    renderView();
  });
  document.getElementById("cashdesk-client")?.addEventListener("change", (event) => {
    state.cashdeskClientId = event.target.value;
    state.cashdeskAppointmentId = "";
    renderView();
  });
  document.getElementById("cashdesk-appointment")?.addEventListener("change", (event) => {
    state.cashdeskAppointmentId = event.target.value;
    const appointment = state.appointments.find((item) => item.id === state.cashdeskAppointmentId);
    if (appointment) {
      const client = findClientForAppointment(appointment);
      state.cashdeskClientId = client?.id || state.cashdeskClientId;
      state.cashdeskDescription = appointment.service || state.cashdeskDescription;
    }
    renderView();
  });
  document.getElementById("cashdesk-amount")?.addEventListener("input", (event) => {
    state.cashdeskAmount = event.target.value;
  });
  document.getElementById("cashdesk-method")?.addEventListener("change", (event) => {
    state.cashdeskMethod = event.target.value;
  });
  document.getElementById("cashdesk-description")?.addEventListener("input", (event) => {
    state.cashdeskDescription = event.target.value;
  });
  document.querySelector('[data-action="save-cashdesk-payment"]')?.addEventListener("click", () => {
    void saveCashdeskPayment();
  });
}
