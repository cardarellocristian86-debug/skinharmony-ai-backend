export function createSmartDeskOperations({
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
}) {
  function dialogField({ label, name, value = "", type = "text", placeholder = "", help = "", attrs = "" }) {
    return `
      <label class="smart-field">
        <span class="smart-field-label">${escapeHtml(label)}</span>
        <input name="${escapeHtml(name)}" class="sh-input" type="${escapeHtml(type)}" placeholder="${escapeHtml(placeholder || label)}" value="${escapeHtml(value)}" ${attrs}>
        ${help ? `<small class="smart-field-help">${escapeHtml(help)}</small>` : ""}
      </label>
    `;
  }

  function openClientDialog(client = null) {
    openDialog({
      title: client ? t("dialogs.editClient") : t("clientsView.newClient"),
      entity: "client",
      mode: client ? "edit" : "create",
      id: client?.id || "",
      fields: `
        <input name="firstName" class="sh-input" placeholder="${escapeHtml(t("dialogs.firstName"))}" value="${escapeHtml(client?.firstName || "")}">
        <input name="lastName" class="sh-input" placeholder="${escapeHtml(t("dialogs.lastName"))}" value="${escapeHtml(client?.lastName || "")}">
        <input name="phone" class="sh-input" placeholder="${escapeHtml(t("dialogs.phone"))}" value="${escapeHtml(client?.phone || "")}">
        <input name="email" class="sh-input" placeholder="${escapeHtml(t("dialogs.email"))}" value="${escapeHtml(client?.email || "")}">
        <input name="preferences" class="sh-input" placeholder="${escapeHtml(t("dialogs.preferences"))}" value="${escapeHtml((client?.preferences || []).join(", "))}">
        <input name="packages" class="sh-input" placeholder="${escapeHtml(t("dialogs.packages"))}" value="${escapeHtml((client?.activePlans || []).join(", "))}">
        <textarea name="notes" class="sh-textarea" placeholder="${escapeHtml(t("dialogs.notes"))}">${escapeHtml(client?.notes || "")}</textarea>
      `
    });
  }

  function openServiceDialog(service = null) {
    openDialog({
      title: service ? t("dialogs.editService") : t("servicesView.newService"),
      entity: "service",
      mode: service ? "edit" : "create",
      id: service?.id || "",
      fields: `
        ${dialogField({ label: t("dialogs.serviceName"), name: "name", value: service?.name || "", help: currentLanguage() === "en" ? "Commercial name shown in agenda and reports." : "Nome commerciale visibile in agenda e nei report." })}
        ${dialogField({ label: t("dialogs.category"), name: "category", value: service?.category || "", help: currentLanguage() === "en" ? "Example: hair, aesthetic, skin, body." : "Esempio: hair, estetica, skin, corpo." })}
        ${dialogField({ label: t("dialogs.duration"), name: "duration", type: "number", value: service?.duration || 45, help: currentLanguage() === "en" ? "Operational duration in minutes. Used for margin and agenda capacity." : "Durata operativa in minuti. Serve per margine e saturazione agenda." })}
        ${dialogField({ label: t("dialogs.price"), name: "price", type: "number", value: service?.price || 0, help: currentLanguage() === "en" ? "Sale price charged to the client for this service." : "Prezzo di vendita al cliente per questo servizio." })}
        ${dialogField({ label: t("dialogs.operatorType"), name: "operatorType", value: service?.operatorType || "", help: currentLanguage() === "en" ? "Who usually performs it: stylist, beautician, technician." : "Chi lo esegue di solito: parrucchiere, estetista, tecnico." })}
        ${dialogField({ label: t("dialogs.room"), name: "room", value: service?.room || "", help: currentLanguage() === "en" ? "Cabin, chair, room or technology used." : "Cabina, postazione, stanza o tecnologia usata." })}
      `
    });
  }

  function openStaffDialog(member = null) {
    openDialog({
      title: member ? t("dialogs.editOperator") : t("servicesView.newOperator"),
      entity: "staff",
      mode: member ? "edit" : "create",
      id: member?.id || "",
      fields: `
        ${dialogField({ label: t("dialogs.operatorName"), name: "name", value: member?.name || "", help: currentLanguage() === "en" ? "Name shown in agenda, shifts and operator reports." : "Nome visibile in agenda, turni e report operatore." })}
        ${dialogField({ label: t("dialogs.role"), name: "role", value: member?.role || "", help: currentLanguage() === "en" ? "Role in the center: hair, aesthetic, reception, support." : "Ruolo nel centro: hair, estetica, reception, supporto." })}
        ${dialogField({ label: t("dialogs.shift"), name: "shift", value: member?.shift || "", help: currentLanguage() === "en" ? "Readable working hours, for example Tue-Sat 09:00-18:00." : "Orario leggibile, esempio Mar-Sab 09:00-18:00." })}
        ${dialogField({ label: t("dialogs.target"), name: "targetProgress", type: "number", value: member?.targetProgress || 0, help: currentLanguage() === "en" ? "Monthly target/progress reference. It is not hourly cost." : "Target o avanzamento mensile. Non e il costo orario." })}
      `
    });
  }

  function openAppointmentDialog(slot = null) {
    openDialog({
      title: t("dialogs.appointmentTitle"),
      entity: "appointment",
      fields: `
        <input name="date" class="sh-input" type="date" value="${escapeHtml(state.agendaDate)}">
        <input name="time" class="sh-input" placeholder="${escapeHtml(t("dialogs.time"))}" value="${escapeHtml(slot?.time || "09:00")}">
        <select name="clientName" class="sh-select">${state.clients.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join("")}</select>
        <select name="serviceName" class="sh-select">${state.services.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join("")}</select>
        <select name="staffName" class="sh-select">${state.staff.map((item) => `<option value="${escapeHtml(item.name)}" ${slot?.operator === item.name ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select>
        <input name="resourceName" class="sh-input" placeholder="${escapeHtml(t("dialogs.resource"))}" value="">
        <input name="durationMin" class="sh-input" type="number" placeholder="${escapeHtml(t("dialogs.durationMinutes"))}" value="45">
      `
    });
  }

  function openCenterDialog() {
    const center = state.center || {};
    openDialog({
      title: t("dialogs.editCenter"),
      entity: "center",
      fields: `
        <input name="name" class="sh-input" placeholder="${escapeHtml(t("dialogs.centerName"))}" value="${escapeHtml(center.name || "")}">
        <input name="businessType" class="sh-input" placeholder="${escapeHtml(t("dialogs.businessType"))}" value="${escapeHtml(center.businessType || "")}">
        <input name="email" class="sh-input" placeholder="${escapeHtml(t("dialogs.email"))}" value="${escapeHtml(center.email || "")}">
        <input name="phone" class="sh-input" placeholder="${escapeHtml(t("dialogs.phone"))}" value="${escapeHtml(center.phone || "")}">
        <input name="hours" class="sh-input" placeholder="${escapeHtml(t("dialogs.hours"))}" value="${escapeHtml(center.hours || "")}">
        <input name="centerType" class="sh-input" placeholder="${escapeHtml(t("dialogs.centerType"))}" value="${escapeHtml(center.centerType || "")}">
      `
    });
  }

  async function submitEntity(formData) {
    const entity = entityForm.dataset.entity;
    const id = entityForm.dataset.id;
    const payload = Object.fromEntries(formData.entries());

    if (entity === "client") {
      const normalizedClient = {
        ...payload,
        firstName: payload.firstName || (currentLanguage() === "en" ? "New" : "Nuovo"),
        lastName: payload.lastName || t("agendaView.client"),
        preferences: payload.preferences || "",
        packages: payload.packages || "",
        marketingConsent: true
      };
      const url = id ? `${API_SERVER_URL}/clients/${id}` : `${API_SERVER_URL}/clients`;
      await safeJsonFetch(url, id ? `/api/clients/${id}` : "/api/clients", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedClient)
      });
      showFeedback(t("feedback.clientSaved"));
      await refreshForUserEvent("client");
    }

    if (entity === "service") {
      const url = id ? `${API_SERVER_URL}/services/${id}` : `${API_SERVER_URL}/services`;
      await safeJsonFetch(url, id ? `/api/services/${id}` : "/api/services", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      showFeedback(t("feedback.serviceSaved"));
      await refreshForUserEvent("service");
    }

    if (entity === "staff") {
      const url = id ? `${API_SERVER_URL}/staff/${id}` : `${API_SERVER_URL}/staff`;
      await safeJsonFetch(url, id ? `/api/staff/${id}` : "/api/staff", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      showFeedback(t("feedback.operatorSaved"));
      await refreshForUserEvent("staff");
    }

    if (entity === "appointment") {
      const normalizedAppointment = {
        date: payload.date || state.agendaDate,
        time: payload.time || state.selectedSlot?.time || "09:00",
        clientName: payload.clientName || "",
        serviceName: payload.serviceName || "",
        staffName: payload.staffName || state.selectedSlot?.operator || "",
        resourceName: payload.resourceName || "",
        durationMin: Number(payload.durationMin || 45),
        status: "confirmed"
      };
      await safeJsonFetch(`${API_SERVER_URL}/appointments`, "/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedAppointment)
      });
      state.selectedSlot = null;
      showFeedback(t("feedback.appointmentSaved"));
      await refreshForUserEvent("appointment");
    }

    if (entity === "center") {
      await fetch("/api/center", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      showFeedback(t("feedback.centerUpdated"));
      await refreshForUserEvent("center");
    }

    dialog.close();
    renderView();
  }

  async function deleteAppointment(id) {
    await safeJsonFetch(`${API_SERVER_URL}/appointments/${id}`, `/api/appointments/${id}`, { method: "DELETE" });
    state.selectedAppointmentId = null;
    await refreshForUserEvent("appointment");
    renderView();
    showFeedback(t("feedback.appointmentDeleted"));
  }

  async function saveCashdeskPayment() {
    const client = state.clients.find((item) => item.id === state.cashdeskClientId);
    if (!client) return;
    const appointment = state.appointments.find((item) => item.id === state.cashdeskAppointmentId) || null;
    const amount = Number(String(state.cashdeskAmount || "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return;
    await safeJsonFetch("/api/sales", null, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: state.cashdeskDate,
        service: state.cashdeskDescription || appointment?.service || t("cashdeskView.defaultDescription"),
        amount,
        channel: state.cashdeskMethod,
        client: client.name
      })
    });
    if (appointment) {
      await updateAppointment(appointment.id, { status: "completed" }, "feedback.paymentSaved");
      state.selectedAppointmentId = appointment.id;
    }
    state.cashdeskAppointmentId = "";
    state.cashdeskAmount = "";
    state.cashdeskDescription = "";
    await loadData(["sales", "appointments"]);
    renderView();
    showFeedback(t("cashdeskView.paymentRecorded"));
  }

  async function copyClientMessageToClipboard() {
    const selectedClient = state.clients.find((item) => item.id === state.selectedClientId) || null;
    if (!selectedClient) return;
    const appointments = clientAppointments(selectedClient);
    const payments = clientPayments(selectedClient);
    const upcomingAppointment = appointments.find((item) => String(item.status || "").toLowerCase() !== "completed" && String(item.status || "").toLowerCase() !== "cancelled");
    const totalPayments = payments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const continuity = clientContinuityStatus(appointments, payments);
    const goldAction = clientGoldAction(selectedClient, continuity, upcomingAppointment, totalPayments);
    if (goldAction.blocked) {
      showFeedback(goldAction.reason);
      return;
    }
    if (!navigator.clipboard?.writeText) {
      showFeedback(t("clientsView.noClipboard"));
      return;
    }
    await navigator.clipboard.writeText(goldAction.message);
    showFeedback(t("clientsView.messageCopied"));
  }

  return {
    openClientDialog,
    openServiceDialog,
    openStaffDialog,
    openAppointmentDialog,
    openCenterDialog,
    submitEntity,
    deleteAppointment,
    saveCashdeskPayment,
    copyClientMessageToClipboard
  };
}
